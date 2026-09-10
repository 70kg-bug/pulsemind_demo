"""Prove the replay answers what the live stack answered: every hour, every route, per session.

    python replay/check_replay.py                         # starts its own server.py --pace 0
    python replay/check_replay.py --load 50               # ... then 50 judges for 2 minutes
    python replay/check_replay.py --base URL [--load 20]  # a deployed replay: no restart check

Exits non-zero if any check fails. Deliberately independent of server.py: it reads the bundle
itself and undoes the clock shift with its own code, because a check that shares the server's
shift would also share its bugs and report them as a pass.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import http.cookiejar
import json
import random
import re
import socket
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUNDLE = HERE / "bundle"
# Inside the tarball the UI sits beside the server; on the laptop it is the SvelteKit build.
UI = HERE / "ui" if (HERE / "ui").exists() else \
    HERE.parent.parent / "frontend-and-backend-FINAL" / "front-end" / "build"
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
CLOCK_IN_PROSE = re.compile(
    r"\b([01]?\d|2[0-3]):[0-5]\d\b|\b\d{4}-\d{2}-\d{2}\b|"
    r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2}\b")

results: list[bool] = []


def show(ok: bool, label: str, detail: str = "") -> bool:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(': ' + detail) if detail and not ok else ''}")
    results.append(ok)
    return ok


# ---- the recording, read independently of server.py --------------------------------------------

def read_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


class Recording:
    def __init__(self):
        self.manifest = json.loads((BUNDLE / "manifest.json").read_text(encoding="utf-8"))
        self.hours = self.manifest["hours"]
        self.seed = read_gz(BUNDLE / "seed.json.gz")
        self.snaps = [read_gz(BUNDLE / "hours" / f"h{h:02d}.json.gz")
                      for h in range(self.hours + 1)]
        self.beds = sorted(self.snaps[0]["patients"])

    def explanation(self, pid: str, hour: int):
        path = BUNDLE / "explanations" / pid / f"h{hour:02d}.json.gz"
        return read_gz(path) if path.exists() else None

    def body(self, hour: int, pid: str, kind: str):
        return self.snaps[hour]["patients"][pid][kind]["body"]


def unshift(value, seconds: int):
    """The server's clock shift, undone with different code: fromisoformat and isoformat."""
    if isinstance(value, str) and ISO.match(value):
        moved = datetime.fromisoformat(value.replace("Z", "+00:00")) - timedelta(seconds=seconds)
        if value.endswith("Z"):
            digits = len(value.split(".")[1]) - 1 if "." in value else 0
            text = moved.isoformat(timespec="milliseconds" if digits == 3 else "seconds")
            return text.replace("+00:00", "Z")
        return moved.isoformat(timespec="seconds" if "." not in value else "microseconds")
    if isinstance(value, list):
        return [unshift(v, seconds) for v in value]
    if isinstance(value, dict):
        return {k: unshift(v, seconds) for k, v in value.items()}
    return value


def isos(value, out: list):
    if isinstance(value, str) and ISO.match(value):
        out.append(value)
    elif isinstance(value, list):
        for v in value:
            isos(v, out)
    elif isinstance(value, dict):
        for v in value.values():
            isos(v, out)
    return out


def first_difference(a, b, path=""):
    """Where two bodies part, as a path of keys. Values are never printed: they may be prose."""
    if type(a) is not type(b):
        return path or "/"
    if isinstance(a, dict):
        for key in sorted(set(a) | set(b)):
            if key not in a or key not in b:
                return f"{path}/{key} (present on one side only)"
            found = first_difference(a[key], b[key], f"{path}/{key}")
            if found:
                return found
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path} (length {len(a)} vs {len(b)})"
        for i, (x, y) in enumerate(zip(a, b)):
            found = first_difference(x, y, f"{path}/{i}")
            if found:
                return found
        return None
    return None if a == b else path or "/"


# ---- a judge ------------------------------------------------------------------------------------

class Judge:
    """One browser: its own cookie jar, so its own ward."""

    def __init__(self, base: str, cookie: str | None = None):
        self.base = base.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.raw_cookie = cookie

    def request(self, method: str, path: str, body=None, timeout=120):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json",
                                              "Accept": "application/json"})
        if self.raw_cookie is not None:
            req.add_header("Cookie", self.raw_cookie)
        opener = self.opener if self.raw_cookie is None else urllib.request.build_opener()
        started = time.perf_counter()
        try:
            with opener.open(req, timeout=timeout) as res:
                raw, status, headers = res.read(), res.status, res.headers
        except urllib.error.HTTPError as failure:
            raw, status, headers = failure.read(), failure.code, failure.headers
        ms = (time.perf_counter() - started) * 1000
        try:
            parsed = json.loads(raw) if raw else None
        except ValueError:
            parsed = raw[:200]
        return status, parsed, headers, ms

    def open_page(self):
        return self.request("GET", "/")[0]

    def api(self, method: str, path: str, body=None, timeout=120):
        return self.request(method, "/api" + path, body, timeout)[:2]


def offset_of(judge: Judge, rec: Recording, hour: int) -> int:
    """This session's shift, derived from what it serves: its newest reading against the recording."""
    status, ward = judge.api("GET", "/ward")
    served = datetime.fromisoformat(ward[0]["assessed_at"].replace("Z", "+00:00"))
    recorded = datetime.fromisoformat(
        rec.snaps[hour]["ward"]["body"][0]["assessed_at"].replace("Z", "+00:00"))
    return round((served - recorded).total_seconds())


# ---- the checks ---------------------------------------------------------------------------------

def check_equality(base: str, rec: Recording, hours: int) -> Judge:
    print(f"\nE  every route equals the recording, hours 0..{hours}")
    judge = Judge(base)
    show(judge.open_page() == 200, "the page mints a session")
    status, _ = judge.api("POST", "/ward/seed", {"backfill_ticks": rec.manifest["backfill_ticks"]})
    show(status == 200, "seed answers 200")
    offset = offset_of(judge, rec, 0)
    recorded_seed = datetime.fromisoformat(rec.seed["body"]["seeded_at"].replace("Z", "+00:00"))
    lag = abs((datetime.now(timezone.utc) - recorded_seed).total_seconds() - offset)
    show(lag < 30, "a fresh ward's newest reading is now", f"{lag:.0f}s off")

    mismatches, compared, stamps = [], 0, []
    for hour in range(hours + 1):
        if hour:
            status, tick = judge.api("POST", "/ward/tick", {})
            compared += 1
            if status != 200 or unshift(tick, offset) != rec.snaps[hour]["tick"]["body"]:
                mismatches.append(f"tick->h{hour}")
        status, ward = judge.api("GET", "/ward")
        isos(ward, stamps)
        compared += 1
        where = first_difference(unshift(ward, offset), rec.snaps[hour]["ward"]["body"])
        if status != 200 or where:
            mismatches.append(f"h{hour} /ward {where}")
        for pid in rec.beds:
            for kind, path in (("patient", f"/patient/{pid}"),
                               ("history", f"/patient/{pid}/history?limit=24"),
                               ("context", f"/patient/{pid}/context")):
                status, body = judge.api("GET", path)
                isos(body, stamps)
                compared += 1
                where = first_difference(unshift(body, offset), rec.body(hour, pid, kind))
                if status != 200 or where:
                    mismatches.append(f"h{hour} {kind} {pid} {where}")
    show(not mismatches, f"{compared} responses equal the recording after the shift",
         "; ".join(mismatches[:3]))

    anchor = recorded_seed + timedelta(seconds=offset)
    low, high = anchor - timedelta(hours=26), anchor + timedelta(hours=hours + 2)
    outside = [s for s in stamps
               if not low <= datetime.fromisoformat(s.replace("Z", "+00:00")) <= high]
    show(not outside, f"all {len(stamps)} timestamps fall inside the session's window",
         f"{len(outside)} outside, e.g. {outside[:1]}")
    if hours == rec.hours:
        status, end = judge.api("POST", "/ward/tick", {})
        show(status == 409 and "End of the recorded" in str(end), "the ward ends with a named 409")
    return judge


def check_prose(rec: Recording):
    print("\nT  no explanation quotes a clock time or a date the shift would contradict")
    hits, count = [], 0
    for pid in rec.beds:
        for hour in range(rec.hours + 1):
            e = rec.explanation(pid, hour)
            text = ((e or {}).get("response", {}).get("body") or {}).get("explanation_text")
            if isinstance(text, str):
                count += 1
                if CLOCK_IN_PROSE.search(text):
                    hits.append(f"{pid} h{hour:02d}")
    show(not hits, f"{count} explanation texts scanned", f"{len(hits)} quote a time: {hits[:5]}")


def check_sessions(base: str, rec: Recording, a: Judge, a_hour: int, restart=None):
    """`a` is a judge already standing at `a_hour`."""
    print("\nS  sessions are isolated, named when unknown, and survive a restart")
    b = Judge(base)
    b.open_page()
    offset_b = offset_of(b, rec, 0)
    status, ward = b.api("GET", "/ward")
    show(unshift(ward, offset_b) == rec.snaps[0]["ward"]["body"], "a new judge starts at hour 0")
    b.api("POST", "/ward/tick", {})
    offset_a = offset_of(a, rec, a_hour)
    status, ward = a.api("GET", "/ward")
    show(unshift(ward, offset_a) == rec.snaps[a_hour]["ward"]["body"],
         "another judge's tick does not move this ward")
    for label, cookie in (("an unknown session", "pm_replay=not-a-session"), ("no session", "")):
        status, body = Judge(base, cookie=cookie).api("GET", "/ward")
        show(status == 409 and "Reload the page" in str(body), f"{label} is refused by name")
    status, _ = Judge(base, cookie="").api("GET", "/auth/session")
    show(status == 404, "/api/auth/session answers 404 without a session")
    if restart is not None:
        restart()
        status, ward = a.api("GET", "/ward")
        show(status == 200 and unshift(ward, offset_a) == rec.snaps[a_hour]["ward"]["body"],
             "a judge's ward survives a server restart")
        status, ward = b.api("GET", "/ward")
        show(status == 200 and unshift(ward, offset_b) == rec.snaps[1]["ward"]["body"],
             "and so does the other judge's")


def check_overlays(base: str, rec: Recording):
    print("\nO  explanations and reviews belong to the session that made them")
    choice = None
    for hour in range(1, rec.hours + 1):
        prompts = [r for r in rec.snaps[hour]["ward"]["body"]
                   if isinstance(r.get("prompt"), dict) and r["prompt"].get("status") == "open"]
        generated = [p for p in rec.beds
                     if ((rec.explanation(p, hour) or {}).get("response", {}).get("body") or {})
                     .get("status") == "generated"]
        if prompts and generated:
            choice = (hour, generated[0], prompts[0])
            break
    if not show(choice is not None, "the recording has an hour with a prompt and an explanation"):
        return
    hour, pid, prompt_row = choice
    c, d = Judge(base), Judge(base)
    for judge in (c, d):
        judge.open_page()
        for _ in range(hour):
            judge.api("POST", "/ward/tick", {})
    off_c = offset_of(c, rec, hour)
    recorded_patient = rec.body(hour, pid, "patient")
    stamp = (datetime.fromisoformat(recorded_patient["assessed_at"].replace("Z", "+00:00"))
             + timedelta(seconds=off_c)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    expl = rec.explanation(pid, hour)

    status, body = c.api("POST", f"/patient/{pid}/explain", {"assessed_at": stamp, "use_llm": True})
    same = hashlib.sha256(str(body.get("explanation_text")).encode()).hexdigest() == \
        hashlib.sha256(str(expl["response"]["body"]["explanation_text"]).encode()).hexdigest()
    show(status == 200 and same, "explain returns the recorded text for that reading")
    status, row = c.api("GET", f"/patient/{pid}")
    show(row.get("explanation") == expl["stored"], "the reading now carries what Node stored")
    status, rows = c.api("GET", f"/patient/{pid}/history?limit=24")
    show(rows[-1].get("explanation") == expl["stored"], "and so does its history row")
    status, row = d.api("GET", f"/patient/{pid}")
    show(row.get("explanation") == recorded_patient.get("explanation"),
         "another judge's copy of that reading is untouched")

    later = (datetime.fromisoformat(stamp.replace("Z", "+00:00")) + timedelta(hours=1))
    status, _ = c.api("POST", f"/patient/{pid}/explain",
                      {"assessed_at": later.isoformat(timespec="milliseconds").replace("+00:00", "Z")})
    show(status == 404, "a reading this ward has not reached is 404")
    show(c.api("POST", f"/patient/{pid}/explain", {"use_llm": False})[0] == 409,
         "the unrecorded template path is a named 409")
    show(c.api("POST", f"/patient/{pid}/explain", {"extra": 1})[0] == 400, "unknown fields are 400")
    show(c.api("POST", "/ward/tick", {"x": 1})[0] == 400, "tick refuses a body")
    show(c.api("POST", "/ward/seed", {"seed": 7})[0] == 409, "seed refuses another ward")

    prompt_id = prompt_row["prompt"]["_id"]
    status, doc = c.api("POST", f"/prompt/{prompt_id}/review", {"disposition": "acknowledged"})
    show(status == 200 and doc.get("status") == "reviewed"
         and doc["review"].get("attributed") is False and doc["review"].get("clinician") is None,
         "a review is recorded, and declared unattributed")
    status, ward = c.api("GET", "/ward")
    mine = next(r for r in ward if (r.get("prompt") or {}).get("_id") == prompt_id)
    show(mine["prompt"]["status"] == "reviewed" and mine["review"]["disposition"] == "acknowledged",
         "the board shows it to the judge who made it")
    status, ward = d.api("GET", "/ward")
    theirs = next(r for r in ward if (r.get("prompt") or {}).get("_id") == prompt_id)
    show(theirs["prompt"]["status"] == "open" and theirs.get("review") is None,
         "and to nobody else")
    c.api("POST", "/ward/seed", {"backfill_ticks": rec.manifest["backfill_ticks"]})
    status, row = c.api("GET", f"/patient/{pid}")
    show(row.get("assessed_at") and unshift(row, offset_of(c, rec, 0)) == rec.body(0, pid, "patient"),
         "Restart ward clears both and returns to hour 0")


def load(base: str, rec: Recording, judges: int, seconds: int):
    print(f"\nL  {judges} judges streaming at the UI's cadence for {seconds}s")
    deadline = time.time() + seconds
    samples: dict[str, list] = {}
    errors: list[str] = []
    lock = threading.Lock()
    generating = [p for p in rec.beds
                  if ((rec.explanation(p, 0) or {}).get("response", {}).get("body") or {})
                  .get("status") == "generated"]

    def note(kind, status, ms, ok_statuses=(200,)):
        with lock:
            samples.setdefault(kind, []).append(ms)
            if status not in ok_statuses:
                errors.append(f"{kind} {status}")

    def judge_loop(n: int):
        judge = Judge(base)
        status, _, _, ms = judge.request("GET", "/")
        note("page", status, ms)
        rng = random.Random(n)
        explains = n % 5 == 0
        next_explain = time.time() + rng.uniform(5, 20)
        while time.time() < deadline:
            status, body, _, ms = judge.request("POST", "/api/ward/tick", {})
            note("tick", status, ms, (200, 409))
            if status == 409:
                status, _, _, ms = judge.request("POST", "/api/ward/seed", {})
                note("seed", status, ms)
            for path in ("/api/ward",) + tuple(
                    f"/api/patient/{rng.choice(rec.beds)}{s}" for s in ("", "/history?limit=24",
                                                                         "/context")):
                status, _, _, ms = judge.request("GET", path)
                note("read", status, ms)
            if explains and generating and time.time() >= next_explain:
                pid = rng.choice(generating)
                status, body, _, ms = judge.request("POST", f"/api/patient/{pid}/explain",
                                                    {"use_llm": True}, timeout=150)
                note("explain", status, ms, (200, 409))
                next_explain = time.time() + rng.uniform(15, 30)
            time.sleep(3)

    threads = [threading.Thread(target=judge_loop, args=(n,), daemon=True) for n in range(judges)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    for kind, values in sorted(samples.items()):
        values.sort()
        p95 = values[min(len(values) - 1, int(len(values) * 0.95))]
        print(f"       {kind:8s} n={len(values):5d}  p50 {statistics.median(values):7.1f} ms  "
              f"p95 {p95:7.1f} ms")
    show(not errors, f"{sum(len(v) for v in samples.values())} requests, no errors",
         f"{len(errors)} errors, e.g. {errors[:3]}")


# ---- a server of our own ------------------------------------------------------------------------

def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class OwnServer:
    def __init__(self, pace: str):
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.state = HERE / f".check-sessions-{self.port}.json"
        self.pace = pace
        self.proc = None
        self.start()

    def start(self):
        self.proc = subprocess.Popen(
            [sys.executable, str(HERE / "server.py"), "--port", str(self.port), "--pace", self.pace,
             "--state", str(self.state), "--ui", str(UI)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                with urllib.request.urlopen(self.base + "/healthz", timeout=1):
                    return
            except OSError:
                time.sleep(0.1)
        raise SystemExit("server.py did not start")

    def restart(self):
        # Windows' terminate() is a hard kill, so the SIGTERM flush that run.sh/stop.sh rely on on
        # Linux never runs here. Waiting out the flusher models a stop after the last write landed.
        time.sleep(1.0)
        self.proc.terminate()
        self.proc.wait(timeout=15)
        self.start()

    def stop(self):
        self.proc.terminate()
        self.proc.wait(timeout=15)
        self.state.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", help="a running replay, e.g. https://x.trycloudflare.com")
    parser.add_argument("--load", type=int, default=0, help="judges for the load check")
    parser.add_argument("--seconds", type=int, default=120)
    args = parser.parse_args()
    rec = Recording()

    if args.base:
        a = check_equality(args.base, rec, hours=3)
        check_prose(rec)
        check_sessions(args.base, rec, a, 3)
        if args.load:
            load(args.base, rec, args.load, args.seconds)
    else:
        own = OwnServer(pace="0")
        try:
            a = check_equality(own.base, rec, hours=rec.hours)
            check_prose(rec)
            check_sessions(own.base, rec, a, rec.hours, restart=own.restart)
            check_overlays(own.base, rec)
        finally:
            own.stop()
        if args.load:
            paced = OwnServer(pace="recorded")
            try:
                load(paced.base, rec, args.load, args.seconds)
            finally:
                paced.stop()

    failed = results.count(False)
    print(f"\n{len(results) - failed}/{len(results)} checks passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
