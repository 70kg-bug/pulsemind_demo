# PulseMind demo API

Express + Mongoose in front of MongoDB Atlas, and a FastAPI service in
`pythonService/` that owns the model. The dashboard talks only to this layer.

```
front-end (Vite)  ->  this API :3500  ->  MongoDB Atlas
                          |
                          +---------->  pythonService :8000  ->  XGBoost + 7B
```

**This layer stores; the model service scores.** Reads never reach the model service —
everything the board shows comes out of Mongo, which is what makes the history durable and
a restart harmless. Only `/api/ward/seed`, `/api/ward/tick`, `/api/ward/warmup` and
`/api/patient/:id/explain` cross the boundary.

Mongo is not a cache. Each stored reading carries the band the hysteresis machine
*published* at the time, which is not a function of that reading's score and cannot be
recomputed later.

## Running it

First-time setup — the sibling `bki/` checkout, the venv, the fitted artifacts and the two
package managers — is in [`../README.md`](../README.md). A clone of this repository alone
cannot run the demo.

```powershell
# 1  the model service, from pulsemind_demo/  (needs the GPU)
..\.venv\Scripts\python.exe -m uvicorn app:app --app-dir back-end/pythonService

# 2  this API, from ANY directory   (needs back-end/.env -- copy .env.example)
node back-end/server.js

# 3  the dashboard, from front-end/
pnpm dev
```

⚠️ **No `PYTHONPATH` is needed** — this block used to set it. `pipeline.core` resolves
through the editable install of `pulsemind_bki`, verified with the variable unset.

⚠️ **`server.js` resolves `.env` against its own directory**, not the working directory, so
the cwd no longer matters. Before that fix, launching it from anywhere but `back-end/`
loaded no `.env` at all and mongoose rejected an undefined `MONGODB_URI` — an error that
reads like a malformed URI and is actually a missing file.

The board is empty until `POST /api/ward/seed`.

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/api/ward` | every bed's latest assessment |
| POST | `/api/ward/seed` | build the ward and backfill `backfill_ticks` hourly readings (default 24) |
| POST | `/api/ward/tick` | advance every bed by one reading, an hour on the ward's clock |
| POST | `/api/ward/warmup` | load the 7B ahead of the first explanation (~40 s, stores nothing) |
| GET | `/api/patient/:id` | one patient's current assessment |
| GET | `/api/patient/:id/history` | recent assessments, oldest first |
| GET | `/api/patient/:id/context` | borrowed demographics and comorbidities |
| GET | `/api/patient/:id/parameter/:name` | one parameter's charting history |
| POST | `/api/patient/:id/explain` | generate the explanation (slow; `assessed_at` names the reading, `use_llm: false` picks the template) |
| POST | `/api/patient/:id/device` | switch an input source off or on |
| POST | `/api/prompt/:id/review` | record a clinician's disposition |

## No auth

None is mounted. `middleware/verifyJWT` and `verifyRoles` are kept and deliberately left
unmounted — SR001 and SR005 require RBAC before a clinician sees a prompt, and its absence
is a listed blocker before any pilot. An unmounted guard is visible in the route file; a
permissive one is not.

## Data

Nothing here is patient data. The eight-bed ward in `pythonService/synthetic_ward.py` is
manufactured, and no MIMIC-IV or other credentialed data may enter this repository.
`.env` holds a live connection string and is gitignored twice over.
