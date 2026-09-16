"""Node-layer regression checks. No GPU, no model service required for B1/B3."""
import json
import re
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3500/api"


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=310) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as failure:
        raw = failure.read()
        try:
            return failure.code, json.loads(raw or b"null")
        except Exception:
            return failure.code, raw.decode(errors="replace")[:200]


def call_headers(method, path, headers=None):
    """As `call`, but keeps the response headers. Server-Timing lives there."""
    request = urllib.request.Request(BASE + path, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=310) as response:
            return response.status, dict(response.headers)
    except urllib.error.HTTPError as failure:
        return failure.code, dict(failure.headers)


def spans(header):
    """Parse W3C Server-Timing into {name: dur-or-None}.

    `None` means the entry carried no `dur` -- an observation, not a timing.
    Distinct from 0.0, which would be a measured duration of zero.
    """
    out = {}
    for entry in re.findall(r'(?:[^,"]|"(?:\\.|[^"\\])*")+', header or ""):
        parts = entry.strip().split(";")
        name = parts[0].strip()
        if not name:
            continue
        dur = None
        for part in parts[1:]:
            key, _, value = part.partition("=")
            if key.strip().lower() == "dur":
                try:
                    dur = float(value.strip())
                except ValueError:
                    dur = None
        out[name] = dur
    return out


def show(label, expected, got, extra=""):
    ok = "PASS" if got == expected else "FAIL"
    print(f"  [{ok}] {label}: expected {expected}, got {got} {extra}")
    return got == expected


results = []

print("B1 -- a malformed id must not kill the process")
status, body = call("POST", "/prompt/notanid/review", {"disposition": "acknowledged"})
results.append(show("POST /prompt/notanid/review", 400, status, str(body)[:70]))
status, _ = call("GET", "/ward")
results.append(show("server still answering afterwards", 200, status))

print("\nB1 -- an invalid disposition is a 400, a well-formed unknown id a 404")
status, body = call("POST", "/prompt/000000000000000000000000/review",
                    {"disposition": "nonsense"})
results.append(show("invalid disposition", 400, status, str(body)[:70]))
status, _ = call("POST", "/prompt/000000000000000000000000/review",
                 {"disposition": "acknowledged"})
results.append(show("unknown prompt id", 404, status))

print("\nB3 -- the board is a list, never a 204")
status, body = call("GET", "/ward")
results.append(show("GET /ward status", 200, status))
results.append(show("GET /ward body is a list", True, isinstance(body, list),
                    f"({len(body) if isinstance(body, list) else '?'} beds)"))

if isinstance(body, list) and body:
    print("\nA4/C3 -- shape of what the board ships")
    leaked = [a["patient_id"] for a in body if "record" in a]
    results.append(show("no internal record on the board", [], leaked))
    refused = [a for a in body if a["assessment_status"] != "assessed"]
    grafted = [a["patient_id"] for a in refused if "prompt" in a or "review" in a]
    results.append(show("refusals carry no prompt/review key", [], grafted,
                        f"({len(refused)} refused)"))

    print("\nA3 -- every contributor carries its machine name")
    scored = [a for a in body if a["assessment_status"] == "assessed"]
    missing = [f'{a["patient_id"]}:{c["feature_name"]}'
               for a in scored for c in a["contributors"] if "parameter" not in c]
    results.append(show("`parameter` present on every contributor", [], missing[:5]))
    named = {c["parameter"] for a in scored for c in a["contributors"]
             if c.get("parameter")}
    print(f"       parameters appearing as drivers: {sorted(named)}")

    print("\nC1 -- a cohort default never carries an age")
    bad = [(a["patient_id"], p["parameter_name"], p["age_minutes"])
           for a in body for p in a["parameters"]
           if p["source"] == "population_reference" and p["age_minutes"] is not None]
    results.append(show("population_reference rows have age_minutes null", [], bad[:5]))

    print("\nC2 -- no contributor is both documentation and imputed")
    impossible = [(a["patient_id"], c["feature_name"])
                  for a in body if a["assessment_status"] == "assessed"
                  for c in a["contributors"]
                  if c["kind"] == "documentation" and c["is_imputed"]]
    results.append(show("documentation + is_imputed never co-occur", [], impossible[:5]))

print("\nB4 -- the telemetry contract: measured, correlated, and not invented")
# GET /ward reads Mongo and never touches the model service, so this whole
# section runs without a GPU.
status, headers = call_headers("GET", "/ward", {"X-Request-Id": "check-node-b4"})
results.append(show("GET /ward answers", 200, status))
timing = spans(headers.get("Server-Timing", ""))
print(f"       Server-Timing: {headers.get('Server-Timing', '(absent)')}")

results.append(show("Server-Timing header is present", True, "Server-Timing" in headers))
results.append(show("`total` span present with a duration", True,
                    isinstance(timing.get("total"), float)))

# ⚠️ THE ONE THAT IS NOT A FORMALITY. `mongo` is recorded by a Mongoose plugin
# that resolves the current response out of an AsyncLocalStorage store. If that
# context did not survive the driver's async boundary the plugin would find
# nothing and record nothing -- silently, with every other check still green.
# This is the assertion that distinguishes "it works" from "it did not throw".
results.append(show("`mongo` span present -- ALS survived the driver", True,
                    isinstance(timing.get("mongo"), float)))

results.append(show("the supplied request id is echoed", "check-node-b4",
                    headers.get("X-Request-Id")))

# ⚠️ CONTAINMENT. The panel indents `mongo` inside `total` to show what nests in
# what, so a child larger than its parent is not an overstated number, it is a
# tree that is not one. This fired for real on 2026-08-22: `GET /ward` issues its
# eight reads concurrently and summing them reported mongo 1326ms inside a 578ms
# request. The middleware unions the intervals now; this is what would catch a
# return to summing.
mongo, total = timing.get("mongo"), timing.get("total")
results.append(show("mongo is contained by total", True,
                    isinstance(mongo, float) and isinstance(total, float)
                    and mongo <= total + 1.0,
                    f"(mongo {mongo}, total {total})"))

# A duration of exactly zero for a stage that ran is not credible at millisecond
# resolution, and it is what a broken measurement looks like. Absent is fine --
# a stage that did not run has no span at all -- but present-and-zero is not.
zeroed = [name for name, dur in timing.items() if dur == 0.0]
results.append(show("no span reports a duration of exactly zero", [], zeroed))

print(f"\n{sum(results)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
