"""Serve the recorded ward to many judges at once: no model, no Node, no database.

    python3 server.py --port 8750                 # 127.0.0.1; add --host 0.0.0.0 to expose
    python3 server.py --pace 0                    # explanations without the recorded wait (tests)

Prototype 2 of the demo. `record.py` recorded what the live Node API answered over
48 hours of ward time. This answers the same routes from that recording, one ward
per browser session, so one judge's Restart, Stream, Generate or review never
reaches another judge's screen. `--ui` is the SvelteKit build with
PUBLIC_PULSEMIND_REPLAY=true, served as a static SPA.

The recording is faithful because the live system is deterministic: the ward is
manufactured from (seed, tick), the booster is deterministic on CUDA and decoding
is greedy. Two things are declared rather than hidden: the UI carries a banner,
and every Server-Timing span says "recorded".

Per session, two transforms are applied to each recorded body:
  clock     every ISO timestamp moves by (session anchor - recorded seeded_at), so
            a fresh session's newest reading is "now", as a live seed makes it.
  overlays  a reading this session explained carries the explanation Node stored;
            a prompt this session reviewed carries its disposition. Reviews feed
            neither scoring nor prompt raising, so nothing else can differ.

Python 3.8+ standard library only: a server needs nothing installed.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import re
import secrets
import signal
import sys
import threading
import time
import traceback
from datetime import datetime, timedelta, timezone
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

HERE = Path(__file__).resolve().parent
COOKIE = "pm_replay"
ISO = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$")
DISPOSITIONS = ("acknowledged", "actioned", "dismissed", "escalated")
TUNNEL_CEILING_S = 90.0     # a Cloudflare tunnel answers 524 at 100 s
BODY_LIMIT = 16 * 1024
NODE_HISTORY_DEFAULT = 14   # assessmentController.js HISTORY_LIMIT
END_OF_RECORDING = "End of the recorded {hours} hours. Restart the ward to replay it."
SESSION_GONE = ("Your replay session is not on this server, which may have restarted with a new "
                "recording. Reload the page to start a new replay.")

TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
    ".gif": "image/gif", ".ico": "image/x-icon", ".webp": "image/webp",
    ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json", ".map": "application/json",
}
COMPRESSIBLE = (".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".map", ".webmanifest")


# ---- time ---------------------------------------------------------------------------------------

def now_iso() -> str:
    """The wall clock in the shape `Date.toISOString()` gives, which is what Node emits."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def iso_to_ms(value) -> int | None:
    """Epoch milliseconds. `Z` parsed by hand: Python < 3.11 `fromisoformat` rejects it."""
    match = ISO.match(value) if isinstance(value, str) else None
    if not match:
        return None
    y, mo, d, h, mi, s, frac, zone = match.groups()
    moment = datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), tzinfo=timezone.utc)
    if zone != "Z":
        sign = 1 if zone[0] == "+" else -1
        moment -= sign * timedelta(hours=int(zone[1:3]), minutes=int(zone[4:6]))
    return int(moment.timestamp()) * 1000 + (int(round(float(frac) * 1000)) if frac else 0)


def ms_to_iso(ms: int) -> str:
    moment = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def shift_iso(value: str, seconds: int) -> str:
    """Whole seconds, so the fraction and the zone suffix are carried through untouched."""
    y, mo, d, h, mi, s, frac, zone = ISO.match(value).groups()
    moved = datetime(int(y), int(mo), int(d), int(h), int(mi), int(s)) + timedelta(seconds=seconds)
    return moved.strftime("%Y-%m-%dT%H:%M:%S") + (frac or "") + zone


def shifted(value, seconds: int):
    if isinstance(value, str):
        return shift_iso(value, seconds) if ISO.match(value) else value
    if isinstance(value, list):
        return [shifted(item, seconds) for item in value]
    if isinstance(value, dict):
        return {key: shifted(item, seconds) for key, item in value.items()}
    return value


# ---- the recording ------------------------------------------------------------------------------

class Recorded:
    """One recorded response. The body is kept as text: every request parses a fresh copy, so a
    session's transforms can never leak into another's."""
    __slots__ = ("status", "timing", "text", "ms")

    def __init__(self, raw: dict):
        self.status = int(raw["status"])
        self.timing = raw.get("timing")
        self.text = json.dumps(raw["body"], ensure_ascii=False, separators=(",", ":"))
        self.ms = float(raw.get("ms") or 0.0)

    def body(self):
        return json.loads(self.text)


def read_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


class Bundle:
    def __init__(self, root: Path):
        manifest_text = (root / "manifest.json").read_text(encoding="utf-8")
        self.manifest = json.loads(manifest_text)
        self.digest = hashlib.sha256(manifest_text.encode()).hexdigest()
        self.hours = int(self.manifest["hours"])
        self.backfill = int(self.manifest["backfill_ticks"])

        seed = read_gz(root / "seed.json.gz")
        self.seed = Recorded(seed)
        self.seeded_s = iso_to_ms(seed["body"]["seeded_at"]) // 1000

        self.snapshots = []   # per hour: {"tick", "ward", "patients": {pid: {...}}}
        self.reading_hour = {}  # (pid, recorded ms of the hour's newest reading) -> hour
        self.newest = {}        # (pid, hour) -> that reading's recorded assessed_at
        self.prompts = {}       # prompt _id -> (pid, first hour attached, recorded doc as text)
        for hour in range(self.hours + 1):
            snap = read_gz(root / "hours" / f"h{hour:02d}.json.gz")
            self.snapshots.append({
                "tick": Recorded(snap["tick"]) if snap.get("tick") else None,
                "ward": Recorded(snap["ward"]),
                "patients": {pid: {kind: Recorded(fetched[kind]) for kind in fetched}
                             for pid, fetched in snap["patients"].items()},
            })
            for pid, fetched in snap["patients"].items():
                body = fetched["patient"]["body"]
                self.newest[(pid, hour)] = body["assessed_at"]
                self.reading_hour[(pid, iso_to_ms(body["assessed_at"]))] = hour
            for row in snap["ward"]["body"] + [f["patient"]["body"]
                                               for f in snap["patients"].values()]:
                prompt = row.get("prompt")
                if isinstance(prompt, dict) and prompt.get("_id") not in self.prompts:
                    self.prompts[prompt["_id"]] = (row["patient_id"], hour,
                                                   json.dumps(prompt, ensure_ascii=False))
        self.beds = sorted(self.snapshots[0]["patients"])

        self.explanations = {}  # (pid, hour) -> (Recorded response, stored explanation as text)
        missing = []
        for hour in range(self.hours + 1):
            for pid in self.beds:
                path = root / "explanations" / pid / f"h{hour:02d}.json.gz"
                if not path.exists():
                    missing.append((pid, hour))
                    continue
                raw = read_gz(path)
                stored = raw.get("stored")
                self.explanations[(pid, hour)] = (
                    Recorded(raw["response"]),
                    None if stored is None else json.dumps(stored, ensure_ascii=False))
        self.missing = missing


# ---- sessions -----------------------------------------------------------------------------------

class Session:
    __slots__ = ("anchor", "hour", "reviews", "explained")

    def __init__(self, anchor: int, hour=0, reviews=None, explained=None):
        self.anchor = anchor          # epoch seconds this session's ward was seeded at
        self.hour = hour
        self.reviews = reviews or {}  # prompt _id -> review, as Node stores it
        self.explained = set(explained or ())  # "pid|hour"

    def offset(self, bundle: Bundle) -> int:
        return self.anchor - bundle.seeded_s

    def as_json(self):
        return {"anchor": self.anchor, "hour": self.hour, "reviews": self.reviews,
                "explained": sorted(self.explained)}


class Sessions:
    """In memory, flushed to disk half a second after anything changes, and never expired: a
    session that vanished mid-event would rewind a judge's ward without a word. SIGTERM flushes
    on the way out; only a hard kill can lose the last half second."""

    def __init__(self, path: Path, cap: int, digest: str):
        self.path, self.cap, self.digest = path, cap, digest
        self.lock = threading.Lock()
        self.items: dict[str, Session] = {}
        self.dirty = False
        if path.exists():
            try:
                saved = json.loads(path.read_text(encoding="utf-8"))
                if saved.get("bundle") == digest:
                    for sid, s in saved.get("sessions", {}).items():
                        self.items[sid] = Session(s["anchor"], s["hour"], s["reviews"],
                                                  s["explained"])
            except (ValueError, KeyError, TypeError):
                pass  # a corrupt file costs the sessions, never the server
        threading.Thread(target=self._flusher, daemon=True).start()

    def get(self, sid):
        with self.lock:
            return self.items.get(sid) if sid else None

    def mint(self):
        with self.lock:
            if len(self.items) >= self.cap:
                return None, None
            sid = secrets.token_urlsafe(18)
            self.items[sid] = Session(int(time.time()))
            self.dirty = True
            return sid, self.items[sid]

    def changed(self):
        self.dirty = True

    def flush(self):
        with self.lock:
            if not self.dirty:
                return
            payload = {"bundle": self.digest,
                       "sessions": {sid: s.as_json() for sid, s in self.items.items()}}
            self.dirty = False
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(self.path)

    def _flusher(self):
        while True:
            time.sleep(0.5)
            try:
                self.flush()
            except OSError as failure:
                print(f"sessions not saved: {failure}", file=sys.stderr, flush=True)


# ---- the static UI ------------------------------------------------------------------------------

class Static:
    """The SvelteKit build, read once. A request is a dictionary lookup, so a path can never
    escape the build directory."""

    def __init__(self, root: Path):
        self.files = {}
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            rel = "/" + path.relative_to(root).as_posix()
            data = path.read_bytes()
            suffix = path.suffix.lower()
            packed = gzip.compress(data, 6) if suffix in COMPRESSIBLE and len(data) > 1024 else None
            self.files[rel] = (data, packed, TYPES.get(suffix, "application/octet-stream"))
        if "/index.html" not in self.files:
            raise SystemExit(f"{root} has no index.html; is --ui the SvelteKit build?")

    @staticmethod
    def cache_policy(rel: str) -> str:
        if rel.startswith("/_app/immutable/"):
            return "public, max-age=31536000, immutable"
        # env.js carries the PUBLIC_* flags and version.json the build id: never let an edge cache
        # hold an old copy across a redeploy.
        return "no-cache"


# ---- Server-Timing ------------------------------------------------------------------------------

SPAN = re.compile(r'(?:[^,"]|"(?:\\.|[^"\\])*")+')


def timing(recorded: str | None, own_ms: float) -> str:
    """Every recorded span keeps its duration and gets "recorded" appended to its desc; the
    replay's own work is a span of its own. Nothing recorded is presented as measured now."""
    out = []
    for entry in SPAN.findall(recorded or ""):
        parts = [p.strip() for p in entry.strip().split(";")]
        name = parts[0]
        if not name:
            continue
        dur, desc = None, None
        for part in parts[1:]:
            key, _, value = part.partition("=")
            key, value = key.strip().lower(), value.strip()
            if value.startswith('"'):
                value = value[1:-1].replace('\\"', '"').replace("\\\\", "\\")
            if key == "dur":
                dur = value
            elif key == "desc":
                desc = value
        desc = f"{desc}, recorded" if desc else "recorded"
        piece = name + (f";dur={dur}" if dur is not None else "")
        out.append(piece + ';desc="' + desc.replace("\\", "\\\\").replace('"', '\\"') + '"')
    out.append(f'replay;dur={own_ms:.1f};desc="this server"')
    return ", ".join(out)


# ---- the handler --------------------------------------------------------------------------------

class Problem(Exception):
    def __init__(self, status: int, body: dict, headers=()):
        super().__init__(status)
        self.status, self.body, self.headers = status, body, headers


def problem(status: int, title: str, detail: str) -> Problem:
    return Problem(status, {"type": "about:blank", "title": title, "status": status,
                            "detail": detail})


class Handler(BaseHTTPRequestHandler):
    server_version = "pulsemind-replay"
    protocol_version = "HTTP/1.1"
    timeout = 120  # an idle keep-alive connection gives its thread back

    # set by main()
    bundle: Bundle
    sessions: Sessions
    ui: Static
    pace: float
    waits: threading.BoundedSemaphore

    def log_request(self, code="-", size="-"):  # replaced by the one line in _finish
        pass

    def log_message(self, fmt, *args):
        print(f"{time.strftime('%H:%M:%S')} {fmt % args}", file=sys.stderr, flush=True)

    def do_GET(self):
        self._dispatch("GET")

    def do_HEAD(self):
        self._dispatch("HEAD")

    def do_POST(self):
        self._dispatch("POST")

    # -- plumbing --

    def _dispatch(self, method: str) -> None:
        self.started = time.perf_counter()
        self.rid = "rpl-" + secrets.token_hex(6)
        self.route = "?"
        self.sid_tag = "-"
        self.status_sent = 0
        try:
            path = urlsplit(self.path).path
            if path == "/healthz":
                self.route = "/healthz"
                self._json(200, self._health())
            elif path.startswith("/api/"):
                self._api(method, path)
            elif method == "POST":
                self.close_connection = True  # its body was never read; do not reuse the socket
                raise problem(405, "Method Not Allowed", "only /api accepts POST")
            else:
                self._static(path)
        except Problem as failure:
            body = dict(failure.body)
            if "type" in body:
                body["instance"] = self.rid
            self._json(failure.status, body, headers=failure.headers,
                       ctype="application/problem+json" if "type" in body else None)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:  # the stack goes to the log, never to a judge (PM-ERR-003)
            traceback.print_exc()
            try:
                self._json(500, {"type": "about:blank", "title": "Internal Server Error",
                                 "status": 500, "detail": "the replay server failed",
                                 "instance": self.rid}, ctype="application/problem+json")
            except OSError:
                return
        ms = (time.perf_counter() - self.started) * 1000
        # Route TEMPLATE and a session hash only: URLs carry patient ids (PM-LOG-001), and no body
        # is ever logged, explanation text least of all (PM-LOG-003).
        self.log_message("%s %s %s %.1fms s=%s", method, self.route, self.status_sent, ms,
                         self.sid_tag)

    def _send(self, status, data: bytes, ctype: str, headers=(), cache="no-store", packed=None):
        accepts = "gzip" in (self.headers.get("Accept-Encoding") or "")
        if packed is None and accepts and len(data) > 1024 and (
                "json" in ctype or ctype.startswith("text/")):
            packed = gzip.compress(data, 5)
        body = packed if (packed is not None and accepts) else data
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        if body is packed:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Vary", "Accept-Encoding")
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        self.status_sent = status
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, payload, headers=(), ctype=None, recorded_timing=None):
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        own = (time.perf_counter() - self.started) * 1000
        extra = [("X-Request-Id", self.rid), ("Server-Timing", timing(recorded_timing, own))]
        self._send(status, data, ctype or "application/json; charset=utf-8",
                   headers=list(headers) + extra)

    def _cookie(self):
        try:
            jar = SimpleCookie(self.headers.get("Cookie") or "")
        except CookieError:
            return None
        return jar[COOKIE].value if COOKIE in jar else None

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > BODY_LIMIT:
            self.close_connection = True
            raise problem(413, "Content Too Large", f"request bodies are limited to {BODY_LIMIT} bytes")
        raw = self.rfile.read(length) if length else b""
        if not raw.strip():
            return {}
        try:
            body = json.loads(raw)
        except ValueError:
            raise Problem(400, {"message": "the request body is not JSON"})
        if not isinstance(body, dict):
            raise Problem(400, {"message": "the request body must be a JSON object"})
        return body

    @staticmethod
    def _only(body: dict, allowed: tuple) -> None:
        """Unknown fields are refused, never ignored (PM-LIMIT-002): a 200 for a field nothing read
        tells a caller it did something."""
        extra = sorted(set(body) - set(allowed))
        if extra:
            raise Problem(400, {"message": f"unexpected field(s): {', '.join(extra)}"})

    # -- routes --

    def _health(self):
        # From memory only: it touches no session and waits on nothing (PM-HEALTH-001).
        return {"status": "ok", "hours": self.bundle.hours, "beds": len(self.bundle.beds),
                "sessions": len(self.sessions.items),
                "explanations_missing": len(self.bundle.missing),
                "pace": self.pace, "bundle": self.bundle.digest[:12]}

    def _static(self, path: str) -> None:
        rel = unquote(path) or "/"
        if rel != "/" and rel in self.ui.files:
            self.route = "/_app/*" if rel.startswith("/_app/") else "/(static)"
            data, packed, ctype = self.ui.files[rel]
            self._send(200, data, ctype, cache=self.ui.cache_policy(rel), packed=packed)
            return
        if rel.startswith("/_app/"):
            self.route = "/_app/*"
            self._send(404, b"not found", "text/plain; charset=utf-8", cache="no-cache")
            return
        self._index()

    def _index(self) -> None:
        """The only response that mints a session. The page's first `/api` calls go out in
        parallel, and minting there would give one browser several wards."""
        self.route = "/(spa)"
        headers = []
        sid = self._cookie()
        if self.sessions.get(sid) is None:
            sid, _ = self.sessions.mint()
            if sid is None:
                self._send(503, b"The replay is at capacity. Try again in a few minutes.",
                           "text/plain; charset=utf-8", headers=[("Retry-After", "60")])
                return
            secure = "; Secure" if self.headers.get("X-Forwarded-Proto") == "https" else ""
            headers.append(("Set-Cookie",
                            f"{COOKIE}={sid}; Path=/; Max-Age=172800; HttpOnly; SameSite=Lax{secure}"))
        self.sid_tag = hashlib.sha256(sid.encode()).hexdigest()[:8]
        data, packed, ctype = self.ui.files["/index.html"]
        self._send(200, data, ctype, headers=headers, cache="no-store", packed=packed)

    def _api(self, method: str, path: str) -> None:
        body = self._read_body() if method == "POST" else {}
        parts = [p for p in path[len("/api/"):].split("/") if p]
        if parts[:1] == ["auth"]:
            # Node has no /auth either. The layout asks on every load, so answer fast and mint
            # nothing: a 404 here is how the header learns it is signed out.
            self.route = "/api/auth/*"
            raise Problem(404, {"message": "this server has no sign-in"})

        sid = self._cookie()
        session = self.sessions.get(sid)
        self.route = self._template(method, parts)
        if session is None:
            raise problem(409, "Conflict", SESSION_GONE)
        self.sid_tag = hashlib.sha256(sid.encode()).hexdigest()[:8]
        b = self.bundle
        offset = session.offset(b)

        if method == "GET" and parts == ["ward"]:
            recorded = b.snapshots[session.hour]["ward"]
            rows = [self._overlaid_row(r, session, offset) for r in recorded.body()]
            return self._json(200, rows, recorded_timing=recorded.timing)

        if len(parts) >= 2 and parts[0] == "patient":
            pid = parts[1]
            fetched = b.snapshots[session.hour]["patients"].get(pid)
            if method == "GET" and len(parts) == 2:
                if fetched is None:
                    raise Problem(404, {"message": f"no assessment for {pid}"})
                recorded = fetched["patient"]
                return self._json(200, self._overlaid_row(recorded.body(), session, offset),
                                  recorded_timing=recorded.timing)
            if method == "GET" and parts[2:] == ["history"]:
                recorded = fetched["history"] if fetched else None
                rows = recorded.body() if recorded else []
                limit = self._history_limit()
                rows = rows[-limit:] if limit < len(rows) else rows
                return self._json(200, [self._overlaid_row(r, session, offset) for r in rows],
                                  recorded_timing=recorded.timing if recorded else None)
            if method == "GET" and parts[2:] == ["context"]:
                if fetched is None:
                    raise Problem(404, {"message": f"no context for {pid}"})
                recorded = fetched["context"]
                return self._json(200, shifted(recorded.body(), offset),
                                  recorded_timing=recorded.timing)
            if method == "GET" and len(parts) == 4 and parts[2] == "parameter":
                raise Problem(404, {"message": "per-parameter history is not part of the replay"})
            if method == "POST" and parts[2:] == ["explain"]:
                return self._explain(pid, body, session, offset)

        if method == "POST" and len(parts) == 3 and parts[0] == "prompt" and parts[2] == "review":
            return self._review(parts[1], body, session, offset)

        if method == "POST" and parts == ["ward", "seed"]:
            self._only(body, ("seed", "backfill_ticks"))
            if "seed" in body:
                raise problem(409, "Conflict", "This replay holds one recorded ward; it cannot "
                                               "seed another.")
            if "backfill_ticks" in body and body["backfill_ticks"] != b.backfill:
                raise problem(409, "Conflict", f"This replay was recorded with "
                                               f"backfill_ticks={b.backfill}.")
            with self.sessions.lock:
                session.anchor, session.hour = int(time.time()), 0
                session.reviews, session.explained = {}, set()
            self.sessions.changed()
            return self._json(200, shifted(b.seed.body(), session.offset(b)),
                              recorded_timing=b.seed.timing)

        if method == "POST" and parts == ["ward", "tick"]:
            self._only(body, ())
            with self.sessions.lock:
                if session.hour >= b.hours:
                    raise problem(409, "Conflict", END_OF_RECORDING.format(hours=b.hours))
                session.hour += 1
                hour = session.hour
            self.sessions.changed()
            recorded = b.snapshots[hour]["tick"]
            return self._json(200, shifted(recorded.body(), offset),
                              recorded_timing=recorded.timing)

        if method == "POST" and parts == ["ward", "warmup"]:
            self._only(body, ())
            return self._json(200, {"explainer": None, "was_loaded": False,
                                    "detail": "This server runs no model; explanations are "
                                              "replayed from the recording."})

        raise problem(404, "Not Found", "no such route")

    @staticmethod
    def _template(method: str, parts: list) -> str:
        if len(parts) >= 2 and parts[0] in ("patient", "prompt"):
            return "/api/" + "/".join([parts[0], ":id"] + parts[2:3])
        return "/api/" + "/".join(parts)

    def _history_limit(self) -> int:
        raw = parse_qs(urlsplit(self.path).query).get("limit", [None])[0]
        try:
            n = float(raw) if raw is not None else 0.0
        except ValueError:
            n = 0.0
        # As Node: `Number(limit) || 14`, capped at 200.
        if not math.isfinite(n) or n == 0:
            n = NODE_HISTORY_DEFAULT
        return int(min(abs(n), 200))

    def _overlaid_row(self, row: dict, session: Session, offset: int) -> dict:
        """Explanation first, on the recorded instant (its content carries no timestamp); then the
        clock; then the review, whose `reviewed_at` is real wall time and must not move."""
        if isinstance(row, dict):
            hour = self.bundle.reading_hour.get((row.get("patient_id"), iso_to_ms(row.get("assessed_at"))))
            key = f"{row.get('patient_id')}|{hour}"
            if hour is not None and key in session.explained:
                stored = self.bundle.explanations.get((row["patient_id"], hour), (None, None))[1]
                if stored is not None:
                    row["explanation"] = json.loads(stored)
        row = shifted(row, offset)
        prompt = row.get("prompt") if isinstance(row, dict) else None
        if isinstance(prompt, dict):
            review = session.reviews.get(prompt.get("_id"))
            if review is not None:
                prompt["status"] = "reviewed"
                prompt["review"] = review
                prompt["updatedAt"] = review["reviewed_at"]
                row["review"] = review
        return row

    def _explain(self, pid: str, body: dict, session: Session, offset: int) -> None:
        self._only(body, ("assessed_at", "use_llm"))
        b = self.bundle
        if pid not in b.beds:
            raise Problem(404, {"message": f"no assessment for {pid}"})
        if body.get("use_llm") is False:
            raise problem(409, "Conflict", "Only the 7B's explanations were recorded; the "
                                           "deterministic template is not part of the replay.")
        hour = session.hour
        if body.get("assessed_at") is not None:
            at = iso_to_ms(body["assessed_at"])
            if at is None:
                raise Problem(400, {"message": "assessed_at is not a date"})
            hour = b.reading_hour.get((pid, at - offset * 1000))
            if hour is None or hour > session.hour:
                raise Problem(404, {"message": f"no reading for {pid} at {ms_to_iso(at)}"})
        recorded, stored = b.explanations.get((pid, hour), (None, None))
        if recorded is None:
            raise problem(503, "Service Unavailable", "This explanation was not recorded.")

        if recorded.status == 200 and self.pace > 0:
            # Real pace: the time this reading took on the on-site card, capped under the tunnel's
            # 100 s. Waiting costs a sleeping thread and nothing else, so the bound is generous.
            if not self.waits.acquire(blocking=False):
                raise Problem(503, {"type": "about:blank", "title": "Service Unavailable",
                                    "status": 503, "detail": "too many explanations in flight"},
                              headers=[("Retry-After", "5")])
            try:
                time.sleep(min(recorded.ms / 1000.0, TUNNEL_CEILING_S) * self.pace)
            finally:
                self.waits.release()
        if recorded.status == 200 and stored is not None:
            with self.sessions.lock:
                session.explained.add(f"{pid}|{hour}")
            self.sessions.changed()
        self._json(recorded.status, shifted(recorded.body(), offset),
                   recorded_timing=recorded.timing)

    def _review(self, prompt_id: str, body: dict, session: Session, offset: int) -> None:
        self._only(body, ("disposition", "note"))
        disposition = body.get("disposition")
        if disposition not in DISPOSITIONS:
            raise Problem(400, {"message": f"disposition must be one of {', '.join(DISPOSITIONS)}"})
        known = self.bundle.prompts.get(prompt_id)
        if known is None or known[1] > session.hour:
            raise Problem(404, {"message": "no such prompt"})
        pid, _, doc_text = known
        reviewed_at = now_iso()
        ward_time = shift_iso(self.bundle.newest[(pid, session.hour)], offset)
        same = iso_to_ms(ward_time) == iso_to_ms(reviewed_at)
        # As Node (assessmentController.js reviewPrompt): two true times, and attribution declared
        # absent rather than invented, because no principal exists (PM-CLIN-001).
        review = {"disposition": disposition, "note": body.get("note") or None,
                  "reviewed_at": reviewed_at, "ward_time_at_review": None if same else ward_time,
                  "clinician": None, "attributed": False}
        with self.sessions.lock:
            session.reviews[prompt_id] = review
        self.sessions.changed()
        doc = shifted(json.loads(doc_text), offset)
        doc.update({"status": "reviewed", "review": review, "updatedAt": reviewed_at})
        self._json(200, doc)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8750)
    parser.add_argument("--bundle", type=Path, default=HERE / "bundle")
    parser.add_argument("--ui", type=Path, default=HERE / "ui")
    parser.add_argument("--state", type=Path, default=HERE / "sessions.json")
    parser.add_argument("--pace", choices=("recorded", "0"), default="recorded",
                        help="explanations wait their recorded time, or not at all")
    parser.add_argument("--max-sessions", type=int, default=5000)
    parser.add_argument("--max-waits", type=int, default=256)
    args = parser.parse_args()

    bundle = Bundle(args.bundle)
    Handler.bundle = bundle
    Handler.sessions = Sessions(args.state, args.max_sessions, bundle.digest)
    Handler.ui = Static(args.ui)
    Handler.pace = 1.0 if args.pace == "recorded" else 0.0
    Handler.waits = threading.BoundedSemaphore(args.max_waits)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True

    def stop(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    missing = f", {len(bundle.missing)} explanations MISSING" if bundle.missing else ""
    print(f"replay: {bundle.hours} h x {len(bundle.beds)} beds, bundle {bundle.digest[:12]}, "
          f"{len(Handler.sessions.items)} saved sessions, pace {args.pace}{missing}; "
          f"http://{args.host}:{args.port}/", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        Handler.sessions.flush()
        print("replay stopped; sessions saved", flush=True)


if __name__ == "__main__":
    main()
