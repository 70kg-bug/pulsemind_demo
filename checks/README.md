# checks/

There is no CI and no test framework here. Verification means running these and
reading the output. Each script exits non-zero on failure, so they chain.

Standard library only — no dependencies, any Python 3.12.

## Run order

```powershell
python checks/secrets_gate.py       # no stack needed
python checks/check_node.py         # needs Node + Mongo
python checks/check_conventions.py  # needs both services
python checks/check_service.py      # needs the model service too
python checks/floor_margin.py       # needs the model service; re-seeds the ward
python checks/check_llm.py          # needs ~7 GB of free VRAM
```

⚠️ **`check_service.py` and `floor_margin.py` re-seed the ward**, which wipes and rebuilds
every collection. Seeding answers **403** unless Node was started with
`PM_ALLOW_DESTRUCTIVE=true` — that guard exists precisely because one unauthenticated
request would otherwise empty the history of record. Start Node with it for a check run,
and without it the rest of the time.

```powershell
$env:PM_ALLOW_DESTRUCTIVE="true"; $env:LOG_SUBJECT_KEY="dev"; node server.js
```

## What each one proves

**`secrets_gate.py`** — nothing secret or patient-derived would be pushed. Both repositories
are public and the model was trained under a PhysioNet DUA. It reads the live values out of
the gitignored `.env` and greps tracked files and history for them, so the script itself
holds no secret. Run it before every push.

**`check_node.py`** — the API survives bad input. A malformed prompt id answers 400 rather
than killing the process (Express 4 does not forward async rejections and Node exits on
one); the board is always a list, never a 204 with a stripped body; a refusal carries no
prompt field; no cohort default carries an age; no contributor is both `documentation` and
`is_imputed`.

**`check_conventions.py`** — the API conventions, tested by their failure modes: an absurd
`backfill_ticks` is refused rather than freezing the board; an unknown field is rejected
rather than silently dropped; `/healthz` answers *while* the model thread is busy; a
saturated queue returns 503 with `Retry-After`; an upstream 422 surfaces as 4xx rather than
"the service did not respond"; a disposition ignores any clinician name in the body and
records `attributed: false`; every response carries a distinct request id; and no patient
identifier reaches the request log.

**`check_service.py`** — seed → tick → explain, 23 assertions. The one that matters most:
the explanation's dwell phrase must equal the stored assessment's `readings_in_state`. If
it does not, the service re-scored the reading instead of explaining the stored one, and
grounding cannot catch that because both sides of the check would be wrong together.

Six of the 23 cover the citation contract, and the read-back is the point rather than the
write: the passages live on the **explanation**, not the assessment, so Mongoose strict mode
will silently drop them if `explanationSchema` ever stops declaring them — which is how a
field can reach the API and vanish on save.

**`floor_margin.py`** — the bed that demonstrates the data-sufficiency floor refuses on
*every* reading, with margin. It once refused on some and published LOW on others while its
inputs were identical throughout, because the deciding share tracks where the model's
attribution landed rather than how many inputs were missing.

**`check_llm.py`** — the 7B path end to end: grounding passed, and the stored band, dwell
and score are unchanged by explaining. Cold load is ~40 s through the service, and the text is
byte-identical across runs by design.

⚠️ **This leaves ~4.7 GB of VRAM occupied until you stop the model service.** The model is
deliberately never released — releasing the CUDA context crashes the process — so once the
7B has loaded it stays loaded. Restart the service after running this, or the next thing
wanting the GPU fails with an OOM that looks unrelated. `nvidia-smi` will not attribute the
memory without elevation; find the holder by port instead:

```powershell
netstat -ano | findstr :8000
```

## Expected

`check_service.py` 23/23 · `check_llm.py` 10/10 · `floor_margin.py` silent on every reading
· `check_node.py` and `secrets_gate.py` all pass.

An assertion that silently skips reports as a pass. If a count drops, something stopped
being checked — find out what before believing the green.
