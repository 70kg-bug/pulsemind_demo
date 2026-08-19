"""The 7B explanation path, through the real endpoint the dashboard uses.

The A4 property again, but against the generated text rather than the
template: whatever the model writes must describe the STORED reading, and the
grounding checker must have been able to verify it.
"""
import json
import re
import time
import urllib.error
import urllib.request

NODE = "http://127.0.0.1:3500/api"


def call(method, path, body=None, timeout=600):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        NODE + path, data=data, method=method,
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


ward = call("GET", "/ward")[1]
scored = [a for a in ward if a["assessment_status"] == "assessed"]
explainable = [a for a in scored
               if (a.get("explanation") or {}).get("status") != "unavailable"]
# The most interesting bed: highest band with the largest dwell.
order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
target = max(explainable, key=lambda a: (order[a["risk_level"]], a["readings_in_state"]))
patient = target["patient_id"]

print(f"target {patient} ({target['bed_code']}): {target['risk_level']} "
      f"{target['band_state']}, readings_in_state={target['readings_in_state']}, "
      f"score={target['risk_score']:.4f}")
print(f"stored contributors: "
      f"{[c['feature_name'] for c in target['contributors'][:3]]}")

print("\ngenerating with the 7B (cold load is ~23 s before the first token)")
started = time.perf_counter()
status, out = call("POST", f"/patient/{patient}/explain", {})
elapsed = time.perf_counter() - started
print(f"  returned {status} after {elapsed:.1f} s")

show("explain returns 200", 200, status)
if status != 200:
    print(f"  body: {out}")
    raise SystemExit(1)

print(f"\n  status           {out.get('status')}")
print(f"  generator        {out.get('generator')}")
print(f"  grounding        {out.get('grounding_status')}")
print(f"  fell back        {out.get('fell_back_to_template')}")
if out.get("generator_error"):
    print(f"  generator_error  {out['generator_error']}")
print(f"  seconds          {out.get('seconds')}")
warnings = out.get("warnings") or []
rejected = out.get("rejected_generation") or []
print(f"  warnings         {len(warnings)}   rejected {len(rejected)}")
for w in warnings[:3]:
    print(f"     warning: {w}")
for r in rejected[:3]:
    print(f"     REJECTED: {r}")

text = out.get("explanation_text", "")
print(f"\n  --- text ---\n  {text}\n")

show("the 7B actually ran", True, out.get("generator") not in (None, "template"),
     f"(generator={out.get('generator')})")
show("grounding was checked", True, out.get("grounding_status") in ("passed", "violations_found"))
show("no grounding violations", "passed", out.get("grounding_status"))

# A4 against generated prose: the band and dwell must be the stored ones.
# Case-insensitive: the generator writes "a critical band", the template writes
# "CRITICAL.". Either names the stored band; only the band itself is the claim.
show("names the STORED band", True,
     target["risk_level"].lower() in text.lower(), f"({target['risk_level']})")
# Word boundaries, or "followed" reads as the LOW band and "higher" as HIGH.
show("names NO OTHER band", [],
     [b for b in ("LOW", "MEDIUM", "HIGH", "CRITICAL")
      if b != target["risk_level"]
      and re.search(rf"\b{b}\b", text, re.IGNORECASE)])
dwell = [int(n) for n in re.findall(r"\b(\d+)\s+(?:\w+\s+)?readings?\b", text)]
if dwell:
    show("dwell matches the stored reading", target["readings_in_state"], dwell[0])
else:
    print("  [ -- ] no dwell phrase in the generated text")

# It must not have been re-scored: the stored assessment is unchanged.
after = call("GET", f"/patient/{patient}")[1]
show("stored band unchanged by explaining", target["risk_level"], after["risk_level"])
show("stored dwell unchanged by explaining",
     target["readings_in_state"], after["readings_in_state"])
show("stored score unchanged by explaining",
     target["risk_score"], after["risk_score"])
show("explanation persisted", "generated", (after.get("explanation") or {}).get("status"))

print(f"\n{sum(results)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
