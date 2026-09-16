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


def headers_of(base, method, path, body=None, timeout=400):
    """As `call`, but keeps the response headers. Server-Timing lives there."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        base + path, data=data, method=method,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers)
    except urllib.error.HTTPError as failure:
        return failure.code, dict(failure.headers)


def spans(header):
    """Parse W3C Server-Timing into {name: dur-or-None}.

    `None` means the entry carried no `dur` -- an observation, not a timing.
    Distinct from 0.0, which would be a measured duration of zero, which is why
    the checks below test `isinstance(..., float)` rather than truthiness.
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

    # A5 -- the citations belong to the EXPLANATION, and survive the round-trip.
    #
    # `use_llm=False` is the template floor, which does not consult the guideline
    # library: an empty list here is the CORRECT answer, and `generator` is the
    # only field that says so rather than leaving it read as a shortfall.
    #
    # The read-back is the point. Mongoose strict mode drops undeclared keys, so
    # a field the API returns can still vanish on save -- that has cost a full
    # verification round before, on `RiskContributor.parameter`.
    print()
    show("the explanation names its generator", "template", explained.get("generator"))
    show("the template floor cites nothing", [], explained.get("citations"))
    show("the write was actually stored", True, explained.get("stored"))

    status, reloaded = call(NODE, "GET", f"/patient/{patient}")
    stored_expl = reloaded.get("explanation") or {}
    show("generator survives the round-trip", "template", stored_expl.get("generator"))
    show("citations survive as a declared field", True, "citations" in stored_expl,
         f"({stored_expl.get('citations')!r})")
    # Moved off the assessment: the passages are a property of the explanation
    # they grounded, and a field left there with no writer reads as "RAG is dead".
    show("the assessment carries no citations of its own", False, "citations" in reloaded)

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

print("\nA5 -- the pipeline stages are MEASURED, not asserted")
# The scoring latency this project quotes in three docstrings was never computed
# anywhere; these spans are the first time it is. So the check is not "is there a
# number" but "did the tier that did the work produce it".
_, tick_headers = headers_of(NODE, "POST", "/ward/tick")
timing = spans(tick_headers.get("Server-Timing", ""))
print(f"       {tick_headers.get('Server-Timing', '(absent)')}")

for stage in ("collect", "order", "assess", "decide", "rank"):
    show(f"`{stage}` measured on a tick", True, isinstance(timing.get(stage), float))
show("`upstream` measured at the Node hop", True, isinstance(timing.get("upstream"), float))
show("`queue` wait measured on the model thread", True, isinstance(timing.get("queue"), float))

# NESTING. `upstream` contains every model-service stage, so it can only be
# larger. Inverted, the panel would be drawing a tree that is not one -- and the
# indentation is what stops a reader adding a 26 s generation to a 26 s request.
inner = sum(timing[s] for s in ("collect", "order", "assess", "decide", "rank", "queue")
            if isinstance(timing.get(s), float))
show("upstream >= the stages it contains", True,
     isinstance(timing.get("upstream"), float) and timing["upstream"] >= inner,
     f"(upstream {timing.get('upstream')}, stages {inner:.1f})")

# The whole point of PM-CLIN-001 here: a stage that did not run must be ABSENT.
# `/ward/tick` never explains, so these must not appear at all -- not as zero.
absent = [s for s in ("explain", "ground", "load", "baseline", "floor") if s in timing]
show("stages that did not run are absent, not zero", [], absent)

print("\nA5 -- the template path reports its own generation time")
_, expl_headers = headers_of(
    NODE, "POST", f"/patient/{patient}/explain", {"use_llm": False})
expl_timing = spans(expl_headers.get("Server-Timing", ""))
print(f"       {expl_headers.get('Server-Timing', '(absent)')}")
show("`baseline` measured on the template path", True,
     isinstance(expl_timing.get("baseline"), float))
show("`ground` measured on the template path", True,
     isinstance(expl_timing.get("ground"), float))
show("the 7B was not loaded for a template explanation", [],
     [s for s in ("load", "explain") if s in expl_timing])

print(f"\n{sum(results)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
