"""Node-layer regression checks. No GPU, no model service required for B1/B3."""
import json
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

print(f"\n{sum(results)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
