"""Record the live ward so that a server with no model can replay it.

Two passes against the running stack (RUN-DEMO.txt, Node started with
PM_ALLOW_DESTRUCTIVE=true):

  reads         seed + 48 ticks, and at every hour every read the SvelteKit UI
                makes, captured BEFORE any explanation exists. Minutes; no 7B.
  explanations  the 7B explanation of each bed's newest reading at every hour,
                requested by `assessed_at` against the rows `reads` left in Mongo.
                About an hour and a half, unattended, and resumable.
  verify        re-seed and re-derive three random hours and three random
                explanations; they must match the bundle byte for byte. Run it
                last: it re-seeds, so the rows `explanations` needs are gone.

    python replay/record.py reads
    python replay/record.py explanations
    python replay/record.py verify

Why the passes are separate: an explanation is written back onto its row, so a
single pass would record every later history with explanations nobody asked
for. And a re-seed re-mints every prompt `_id`, so `reads` is atomic -- rerun it
whole -- while explanations are keyed by (bed, hour) and survive a rerun,
because the ward and the decoding are both deterministic.

Explanation text goes to the bundle and is never printed (PM-LOG-003).
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import pathlib
import random
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
BUNDLE = HERE / "bundle"
WORKSPACE = HERE.parent.parent

NODE = "http://127.0.0.1:3500/api"
MODEL = "http://127.0.0.1:8000"

HOURS = 48                # the recording, after the backfill
BACKFILL_TICKS = 24       # what the SvelteKit "Restart ward" asks for
HISTORY_LIMIT = 24        # what the SvelteKit detail screen asks for
TUNNEL_CEILING_MS = 90_000  # a Cloudflare tunnel answers 524 at 100 s
MIN_FREE_AFTER_WARMUP_MIB = 700


def call(base, method, path, body=None, timeout=400):
    """One request. Returns (status, Server-Timing header, parsed body, ms)."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw, status, headers = response.read(), response.status, response.headers
    except urllib.error.HTTPError as failure:
        raw, status, headers = failure.read(), failure.code, failure.headers
    ms = round((time.perf_counter() - started) * 1000, 1)
    try:
        parsed = json.loads(raw or b"null")
    except ValueError:
        parsed = raw.decode(errors="replace")[:300]
    return status, headers.get("Server-Timing"), parsed, ms


def captured(base, method, path, body=None, timeout=400, expect=(200,)):
    status, timing, parsed, ms = call(base, method, path, body, timeout)
    if status not in expect:
        raise SystemExit(f"{method} {path} answered {status}: {str(parsed)[:300]}")
    return {"status": status, "timing": timing, "body": parsed, "ms": ms}


def write(path: pathlib.Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    tmp.replace(path)


def read(path: pathlib.Path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def hour_file(hour: int) -> pathlib.Path:
    return BUNDLE / "hours" / f"h{hour:02d}.json.gz"


def explanation_file(patient_id: str, hour: int) -> pathlib.Path:
    return BUNDLE / "explanations" / patient_id / f"h{hour:02d}.json.gz"


def git_sha(repo: pathlib.Path) -> str | None:
    out = subprocess.run(["git", "-C", str(repo), "rev-parse", "--short", "HEAD"],
                         capture_output=True, text=True)
    return out.stdout.strip() or None


def free_vram_mib() -> int | None:
    """The driver's figure, never torch's (hardware.md: torch overstates it)."""
    out = subprocess.run(["nvidia-smi", "--query-gpu=memory.free",
                          "--format=csv,noheader,nounits"], capture_output=True, text=True)
    try:
        return int(out.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return None


def require_stack() -> None:
    status, _, health, _ = call(MODEL, "GET", "/healthz", timeout=10)
    if status != 200:
        raise SystemExit(f"model service not answering on {MODEL} ({status})")
    status, _, _, _ = call(NODE, "GET", "/ward", timeout=30)
    if status != 200:
        raise SystemExit(f"Node API not answering on {NODE} ({status})")
    print(f"stack up: model service {health.get('status')}, Node answering")


def record_hour(hour: int, tick) -> dict:
    ward = captured(NODE, "GET", "/ward")
    patients = {}
    for row in ward["body"]:
        pid = row["patient_id"]
        patients[pid] = {
            "patient": captured(NODE, "GET", f"/patient/{pid}"),
            "history": captured(NODE, "GET", f"/patient/{pid}/history?limit={HISTORY_LIMIT}"),
            "context": captured(NODE, "GET", f"/patient/{pid}/context"),
        }
    return {"hour": hour, "tick": tick, "ward": ward, "patients": patients}


def reads(_args) -> None:
    require_stack()
    seed = captured(NODE, "POST", "/ward/seed", {"backfill_ticks": BACKFILL_TICKS},
                    timeout=400, expect=(200, 403))
    if seed["status"] == 403:
        raise SystemExit("seeding is locked: start Node with PM_ALLOW_DESTRUCTIVE=true")
    write(BUNDLE / "seed.json.gz", seed)
    print(f"seeded: {seed['body'].get('assessments')} assessments, "
          f"{seed['body'].get('prompts')} prompts, seeded_at {seed['body'].get('seeded_at')}")

    for hour in range(HOURS + 1):
        tick = None
        if hour:
            tick = captured(NODE, "POST", "/ward/tick", {}, timeout=400)
        snapshot = record_hour(hour, tick)
        write(hour_file(hour), snapshot)
        bands = " ".join(f"{r['patient_id']}:{r.get('risk_level') or '-'}"
                         for r in snapshot["ward"]["body"])
        print(f"  h{hour:02d}  {bands}")

    manifest(seed_body=seed["body"])
    print("reads recorded. Next: record.py explanations")


def targets():
    """(hour, patient_id, newest row) for every bed at every hour, from pass 1."""
    for hour in range(HOURS + 1):
        snapshot = read(hour_file(hour))
        for pid, fetched in snapshot["patients"].items():
            yield hour, pid, fetched["patient"]["body"]


def stored_explanation(pid: str, assessed_at: str):
    """What Node persisted onto the row, read back rather than reconstructed."""
    rows = captured(NODE, "GET", f"/patient/{pid}/history?limit=200")["body"]
    for row in rows:
        if row.get("assessed_at") == assessed_at:
            return row.get("explanation")
    raise SystemExit(f"row {pid} @ {assessed_at} is not in Mongo -- was the ward re-seeded "
                     "after `reads`? Rerun `reads`; recorded explanations are kept.")


def explanations(_args) -> None:
    require_stack()
    last = read(hour_file(HOURS))
    for pid, fetched in last["patients"].items():
        live = captured(NODE, "GET", f"/patient/{pid}")["body"]
        if live.get("assessed_at") != fetched["patient"]["body"].get("assessed_at"):
            raise SystemExit("the ward in Mongo is not the one `reads` recorded. Rerun `reads`; "
                             "explanations already recorded are kept.")

    pending = [(h, p, row) for h, p, row in targets() if not explanation_file(p, h).exists()]
    if not pending:
        print("every explanation is already recorded")
        manifest()
        return
    print(f"{len(pending)} explanations to record")

    warm = captured(NODE, "POST", "/ward/warmup", {}, timeout=400, expect=(200, 503))
    if warm["status"] != 200:
        raise SystemExit(f"the 7B would not load: {warm['body']}")
    free = free_vram_mib()
    print(f"7B warm; {free} MiB free on the card")
    if free is not None and free < MIN_FREE_AFTER_WARMUP_MIB:
        raise SystemExit(f"only {free} MiB free after the load. Generation slows ~5x on a full "
                         "card, and real-pace replay inherits the recorded times. Close "
                         "GPU-heavy apps (browsers, games, overlays), then rerun.")

    slow = []
    for done, (hour, pid, row) in enumerate(pending, 1):
        response = captured(NODE, "POST", f"/patient/{pid}/explain",
                            {"assessed_at": row["assessed_at"], "use_llm": True},
                            timeout=400, expect=(200, 404, 409))
        body = response["body"] if isinstance(response["body"], dict) else {}
        stored = None
        if response["status"] == 200 and body.get("stored"):
            stored = stored_explanation(pid, row["assessed_at"])
        write(explanation_file(pid, hour), {
            "hour": hour, "patient_id": pid, "assessed_at": row["assessed_at"],
            "response": response, "stored": stored,
        })
        if body.get("status") == "generated" and response["ms"] > TUNNEL_CEILING_MS:
            slow.append((pid, hour, response["ms"]))
        print(f"  [{done}/{len(pending)}] {pid} h{hour:02d} -> {response['status']} "
              f"{body.get('status', '-')} {body.get('generator') or ''} "
              f"{body.get('grounding_status') or ''} {response['ms'] / 1000:.1f}s")

    manifest()
    if slow:
        for pid, hour, ms in slow:
            print(f"  SLOW {pid} h{hour:02d}: {ms / 1000:.1f}s > {TUNNEL_CEILING_MS / 1000:.0f}s")
        raise SystemExit("some generations exceed the tunnel ceiling; delete those files, free "
                         "the card and rerun `explanations`")
    print("explanations recorded. Next: record.py verify")


def normalised(value):
    """Drop what legitimately differs between two seeds of the same ward."""
    if isinstance(value, dict):
        return {k: normalised(v) for k, v in value.items()
                if k not in ("_id", "__v", "createdAt", "updatedAt", "assessed_at", "raised_at",
                             "last_signal_at", "seeded_at", "at", "stored")}
    if isinstance(value, list):
        return [normalised(v) for v in value]
    return value


def verify(args) -> None:
    require_stack()
    rng = random.Random(args.seed)
    hours = sorted(rng.sample(range(1, HOURS + 1), 3))
    captured(NODE, "POST", "/ward/seed", {"backfill_ticks": BACKFILL_TICKS}, timeout=400)
    failures = 0
    for hour in range(1, max(hours) + 1):
        captured(NODE, "POST", "/ward/tick", {}, timeout=400)
        if hour not in hours:
            continue
        recorded = read(hour_file(hour))
        live_ward = captured(NODE, "GET", "/ward")["body"]
        same = normalised(live_ward) == normalised(recorded["ward"]["body"])
        failures += not same
        print(f"  [{'PASS' if same else 'FAIL'}] board at h{hour:02d} matches the recording")

        generated = [p for p in recorded["patients"]
                     if explanation_file(p, hour).exists()
                     and (read(explanation_file(p, hour))["response"]["body"] or {}).get("status")
                     == "generated"]
        if not generated:
            continue
        pid = rng.choice(generated)
        want = read(explanation_file(pid, hour))["response"]["body"]["explanation_text"]
        newest = captured(NODE, "GET", f"/patient/{pid}")["body"]["assessed_at"]
        got = captured(NODE, "POST", f"/patient/{pid}/explain",
                       {"assessed_at": newest, "use_llm": True}, timeout=400)["body"]
        a, b = (hashlib.sha256((t or "").encode()).hexdigest()[:12]
                for t in (want, got.get("explanation_text")))
        failures += a != b
        print(f"  [{'PASS' if a == b else 'FAIL'}] {pid} h{hour:02d} explanation sha256 "
              f"{a} vs {b}")
    if failures:
        raise SystemExit(f"{failures} check(s) failed: the recording is not the live system")
    print("verify: the recording reproduces")


def manifest(seed_body=None) -> None:
    path = BUNDLE / "manifest.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    seed_body = seed_body or read(BUNDLE / "seed.json.gz")["body"]
    sample = next((row for row in read(hour_file(0))["ward"]["body"]
                   if row.get("assessment_status") == "assessed"), {})
    files = {}
    for file in sorted(BUNDLE.rglob("*.json.gz")):
        files[file.relative_to(BUNDLE).as_posix()] = hashlib.sha256(file.read_bytes()).hexdigest()
    payload = {
        "format": 1,
        "hours": HOURS,
        "backfill_ticks": BACKFILL_TICKS,
        "history_limit": HISTORY_LIMIT,
        "seeded_at": seed_body.get("seeded_at"),
        "recorded_at": previous.get("recorded_at") or time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                                                    time.gmtime()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "versions": {k: sample.get(k) for k in
                     ("schema_version", "model_version", "band_table_version", "scoring_device")},
        "git": {name: git_sha(WORKSPACE / name)
                for name in ("pulsemind_demo", "bki", "frontend-and-backend-FINAL")},
        "files": files,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("reads")
    sub.add_parser("explanations")
    check = sub.add_parser("verify")
    check.add_argument("--seed", type=int, default=20260910)
    args = parser.parse_args()
    {"reads": reads, "explanations": explanations, "verify": verify}[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
