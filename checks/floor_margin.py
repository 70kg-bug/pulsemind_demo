"""Does PM-355 sit clear of the sufficiency floor on EVERY reading, not most?

A demonstration of a threshold that only fires on some ticks is worse than no
demonstration: on the ticks it misses it publishes a band.
"""
import json
import urllib.error
import urllib.request

NODE = "http://127.0.0.1:3500/api"
TICKS = 12


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        NODE + path, data=data, method=method,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=400) as response:
        return json.loads(response.read() or b"null")


call("POST", "/ward/seed", {})
worst = 1.0
published = []
for step in range(TICKS + 1):
    if step:
        call("POST", "/ward/tick", {})
    a = call("GET", "/patient/PM-355")
    margin = max(a["imputed_share"], a["documentation_share"]) - 0.30
    worst = min(worst, margin)
    scored = a["assessment_status"] == "assessed"
    if scored:
        published.append(step)
    print(f"  tick {step:>2}  imputed={a['imputed_share']:.4f} "
          f"doc={a['documentation_share']:.4f}  margin over floor {margin:+.4f}  "
          f"{'PUBLISHED A BAND' if scored else a['insufficiency_reason']}")

print(f"\nsmallest margin over the floor across {TICKS + 1} readings: {worst:+.4f}")
print("PM-355 refuses on every reading" if not published
      else f"PM-355 published a band on ticks {published}")

print("\nthe other seven beds, after the same run:")
for a in sorted(call("GET", "/ward"), key=lambda x: x["bed_code"]):
    if a["patient_id"] == "PM-355":
        continue
    print(f"  {a['bed_code']:<8} {a['patient_id']:<8} {a['risk_level']:<9} "
          f"{a['band_state']:<11} n={a['readings_in_state']:<3} "
          f"score={a['risk_score']:.4f}")

raise SystemExit(0 if not published else 1)
