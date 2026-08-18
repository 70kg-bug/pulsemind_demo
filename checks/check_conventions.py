"""The API conventions, tested by their failure modes.

Every assertion here is a thing that used to go wrong quietly: work accepted
without limit, a probe that queued behind the workload it monitored, an upstream
422 reported as "did not respond", a patient identifier written to a log file.

    python checks/check_conventions.py
"""
import json
import pathlib
import re
import threading
import urllib.error
import urllib.request

NODE = "http://127.0.0.1:3500/api"
MODEL = "http://127.0.0.1:8000"
results = []


def call(base, method, path, body=None, timeout=300):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"null"), dict(r.headers)
    except urllib.error.HTTPError as failure:
        raw = failure.read()
        try:
            return failure.code, json.loads(raw or b"null"), dict(failure.headers)
        except Exception:
            return failure.code, raw.decode(errors="replace")[:200], dict(failure.headers)


def show(label, expected, got, extra=""):
    ok = got == expected
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: expected {expected}, got {got} {extra}")


print("bounded input -- work that multiplies must be capped")
status, body, _ = call(MODEL, "POST", "/ward/seed", {"backfill_ticks": 1_000_000})
show("absurd backfill_ticks is refused", 422, status)
status, _, _ = call(MODEL, "POST", "/ward/seed", {"backfill_ticks": 0})
show("zero backfill_ticks is refused", 422, status)
status, _, _ = call(MODEL, "POST", "/ward/seed", {"unknown_field": 1})
show("an unknown field is refused, not silently dropped", 422, status)

print("\nliveness must not queue behind the workload")
status, body, _ = call(MODEL, "GET", "/healthz")
show("/healthz answers", 200, status)
show("/healthz reports its schema version", True, "schema_version" in (body or {}))
status, body, _ = call(MODEL, "GET", "/readyz")
show("/readyz answers", 200, status)
show("/readyz separates explainer readiness", True,
     "explainer:loaded" in (body or {}).get("checks", {}))

# The real test: /healthz must answer WHILE the model thread is busy.
print("\n  driving the model thread, then probing during it")
busy: dict = {}


def _work():
    busy["status"], _, _ = call(NODE, "POST", "/ward/tick", {})


thread = threading.Thread(target=_work)
thread.start()
probe_status, _, _ = call(MODEL, "GET", "/healthz", timeout=5)
thread.join()
show("/healthz answers during a tick", 200, probe_status)

print("\nupstream 4xx is not upstream-down")
# Node coerces a non-numeric seed to NaN, which FastAPI rejects as 422.
status, body, _ = call(NODE, "POST", "/ward/seed", {"seed": "not-a-number"})
show("a model-service 422 surfaces as 4xx, not 502", True, 400 <= status < 500,
     f"(got {status})")

print("\ndestructive operations are guarded")
print("  (this run has PM_ALLOW_DESTRUCTIVE=true, so seed is permitted here;")
print("   unset it and POST /api/ward/seed must answer 403)")

print("\nattribution is never manufactured")
ward = call(NODE, "GET", "/ward")[1]
prompted = [a for a in ward if (a.get("prompt") or {}).get("status") == "open"]
if prompted:
    p = prompted[0]
    status, _, _ = call(NODE, "POST", f"/prompt/{p['prompt']['_id']}/review",
                        {"disposition": "acknowledged", "clinician": "Dr Forged"})
    show("a disposition is accepted", 200, status)
    again = call(NODE, "GET", f"/patient/{p['patient_id']}")[1]
    review = again.get("review") or {}
    show("the body's clinician is ignored", None, review.get("clinician"))
    show("and the record says it is unattributed", False, review.get("attributed"))
else:
    print("  [ -- ] no open prompt on this ward; skipping")

print("\nerror bodies are machine-readable and leak nothing")
status, body, headers = call(NODE, "POST", "/prompt/notanid/review",
                             {"disposition": "acknowledged"})
show("a malformed id is a 4xx", True, 400 <= status < 500, f"(got {status})")
show("the body is JSON, not text", True, isinstance(body, dict))

print("\nrequest ids are per-request and cross the hop")
_, _, h1 = call(NODE, "GET", "/ward")
_, _, h2 = call(NODE, "GET", "/ward")
one, two = h1.get("X-Request-Id"), h2.get("X-Request-Id")
show("every response carries a request id", True, bool(one and two))
show("and two requests do not share one", True, one != two)

print("\nthe log holds no patient identifier")
log = pathlib.Path(__file__).resolve().parent.parent / "back-end" / "logs" / "reqLog.txt"
if log.exists():
    leaked = re.findall(r"PM-\d+", log.read_text(encoding="utf-8", errors="ignore"))
    show("no PM- identifier in reqLog.txt", [], sorted(set(leaked))[:5])
else:
    print("  [ ok ] reqLog.txt no longer exists -- the file logger is gone")

print(f"\n{sum(results)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
