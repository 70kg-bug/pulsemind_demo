"""Seed -> tick -> explain, end to end, and assert the A4 property.

A4: the explanation must describe the STORED reading. The template floor is used
rather than the 7B because it is deterministic and needs no VRAM -- and because
the property under test is which record reached the generator, not which words
came back.
"""
import json
import re
import urllib.error
import urllib.request

NODE = "http://127.0.0.1:3500/api"
MODEL = "http://127.0.0.1:8000"


def call(base, method, path, body=None, timeout=400):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as failure:
        raw = failure.read()
        try:
            return failure.code, json.loads(raw or b"null")
        except Exception:
            return failure.code, raw.decode(errors="replace")[:300]


results = []


def show(label, expected, got, extra=""):
    ok = got == expected
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: expected {expected}, got {got} {extra}")
    results.append(ok)
    return ok


print("healthz")
status, health = call(MODEL, "GET", "/healthz")
show("model service up", 200, status)
print(f"       device={health.get('scoring_device')} "
      f"features={health.get('features')} band_table={health.get('band_table_version')}")

print("\nseed")
status, seeded = call(NODE, "POST", "/ward/seed", {})
if status == 403:
    raise SystemExit(
        "\nThis check re-seeds the ward, and seeding is guarded.\n"
        "Restart Node with PM_ALLOW_DESTRUCTIVE=true, then run it again.")
show("POST /api/ward/seed", 200, status, str(seeded)[:110])

print("\ntick")
status, ticked = call(NODE, "POST", "/ward/tick", {})
show("POST /api/ward/tick", 200, status, str(ticked)[:80])

print("\nboard")
status, ward = call(NODE, "GET", "/ward")
show("GET /api/ward", 200, status)
scored = [a for a in ward if a["assessment_status"] == "assessed"]
print(f"       {len(ward)} beds, {len(scored)} scored")
for a in sorted(ward, key=lambda x: x["bed_code"]):
    if a["assessment_status"] == "assessed":
        print(f"       {a['bed_code']:<8} {a['patient_id']:<8} {a['risk_level']:<9} "
              f"{a['band_state']:<12} n={a['readings_in_state']:<3} "
              f"score={a['risk_score']:.4f} prompt="
              f"{(a.get('prompt') or {}).get('status')}")
    else:
        print(f"       {a['bed_code']:<8} {a['patient_id']:<8} REFUSED   "
              f"{a['insufficiency_reason']}")

print("\nA3 -- every contributor carries its machine name")
missing = [c["feature_name"] for a in scored for c in a["contributors"]
           if "parameter" not in c]
show("`parameter` on every contributor", [], missing[:4])
named = sorted({c["parameter"] for a in scored for c in a["contributors"]
                if c.get("parameter")})
print(f"       parameters appearing as drivers: {named}")
show("at least one parameter driver exists", True, len(named) > 0)

print("\nC1 -- a cohort default never carries an age")
bad = [(a["patient_id"], p["parameter_name"], p["age_minutes"])
       for a in ward for p in a["parameters"]
       if p["source"] == "population_reference" and p["age_minutes"] is not None]
show("population_reference => age_minutes null", [], bad[:4])

print("\nC2 -- no contributor is both documentation and imputed")
impossible = [(a["patient_id"], c["feature_name"]) for a in scored
              for c in a["contributors"] if c["kind"] == "documentation" and c["is_imputed"]]
show("documentation + is_imputed never co-occur", [], impossible[:4])

print("\nA4 -- the explanation describes the STORED reading")
# Not a bed that withholds by policy: its explanation is a fixed string and
# there is nothing to compare against.
explainable = [a for a in scored
               if (a.get("explanation") or {}).get("status") != "unavailable"]
show("at least one explainable bed", True, len(explainable) > 0,
     f"({len(scored) - len(explainable)} withholding)")
target = max(explainable, key=lambda a: a["readings_in_state"])
patient = target["patient_id"]
print(f"       {patient}: stored band {target['risk_level']} "
      f"{target['band_state']}, readings_in_state={target['readings_in_state']}")

status, record = call(MODEL, "GET", f"/healthz")   # keep the connection warm
# Ask the service directly, with the template floor, using the record Node holds.
status, board_one = call(NODE, "GET", f"/patient/{patient}")
show(f"GET /api/patient/{patient}", 200, status)

status, explained = call(NODE, "POST", f"/patient/{patient}/explain",
                         {"use_llm": False})
show("POST explain", 200, status, str(explained)[:60])
if status == 200:
    text = explained.get("explanation_text", "")
    print(f"       grounding={explained.get('grounding_status')} "
          f"generator={explained.get('generator')} status={explained.get('status')}")
    print(f"       {text[:300]}")
    numbers = [int(n) for n in
               re.findall(r"\b(\d+)\s+(?:\w+\s+)?readings?\b", text)]
    show("a dwell phrase is present at all", True, bool(numbers))
    if numbers:
        show("dwell in the text matches the stored reading",
             target["readings_in_state"], numbers[0])
    show("band named in the text matches the stored band", True,
         target["risk_level"] in text, f"({target['risk_level']})")

print("\nA1/A2 -- a disposition round-trips")
prompted = [a for a in scored if (a.get("prompt") or {}).get("status") == "open"]
if not prompted:
    print("       no open prompt on this ward; skipping")
else:
    p = prompted[0]
    status, reviewed = call(NODE, "POST", f"/prompt/{p['prompt']['_id']}/review",
                            {"disposition": "escalated", "note": "verification"})
    show("POST review", 200, status)
    status, again = call(NODE, "GET", f"/patient/{p['patient_id']}")
    show("review readable back", "escalated", (again.get("review") or {}).get("disposition"))
    show("prompt now reviewed", "reviewed", (again.get("prompt") or {}).get("status"))

print(f"\n{sum(results)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
