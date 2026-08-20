# PulseMind — demo

Clinical decision support for **ICU mechanical ventilation**: stream ventilator telemetry,
score it for respiratory deterioration within 6 hours, and show a clinician why. Read-only
and clinician-in-the-loop. It never controls a ventilator and never recommends treatment.

This repository is the **live demo** — the only place the trained model reaches a screen.

```
front-end/   Vite :5173    React dashboard. Reads /api, never derives a band from a score.
back-end/    Node :3500    Express + Mongoose -> MongoDB Atlas. The history of record.
             FastAPI :8000 pythonService/. The only process that touches the model.
contract/                  The shared data contract, as TypeScript types.
checks/                    Executable end-to-end verification.
```

The model itself lives in a separate repository and is imported as a package; this one owns
the serving path and the screen.

## Running it

Three processes, in this order, each in its own terminal. Paths are relative to this
directory (`pulsemind_demo/`) unless stated; the workspace root is its parent.

### 1. Model service — FastAPI :8000

```powershell
..\.venv\Scripts\python.exe -m uvicorn app:app --app-dir back-end/pythonService
```

The venv lives at the **workspace root** — the parent of this directory — and must not be
moved, because its absolute paths are baked in. Ready when
`http://127.0.0.1:8000/healthz` returns `"status":"pass"`.

**No `PYTHONPATH` is needed**, despite appearances. The service imports `pipeline.core`
from the model repository, which is installed into that venv as an **editable package** —
`pulsemind_bki 1.2.0`, resolved through a `.pth` finder rather than the path variable.
Verified with `PYTHONPATH` explicitly unset: `pipeline.core.features` resolves to
`..\bki\pipeline\core\features.py`.

It matters only if you rebuild the venv, where forgetting it breaks every import at
startup:

```powershell
..\.venv\Scripts\pip.exe install -e ..\bki
```

⚠️ The workspace-root `.env` carries `PYTHONPATH="..\bki"` and looks load-bearing. It is
not read by anything: Python does not parse `.env` files, and the variable is set neither
in the environment nor in `HKCU\Environment`. Treat it as a fallback for the rebuild case
above, not as a prerequisite.

### 2. API — Node :3500

```powershell
$env:PM_ALLOW_DESTRUCTIVE="true"; $env:LOG_SUBJECT_KEY="dev"; node back-end/server.js
```

Runs from **any** directory: `server.js` resolves `.env` against its own folder rather than
the working directory. `back-end/.env` must exist — copy `back-end/.env.example`. It holds
the Atlas URI and is gitignored.

- `PM_ALLOW_DESTRUCTIVE` unlocks `POST /api/ward/seed` and the **Restart** button; without
  it they answer 403. Seeding **deletes every assessment, prompt and stay state**.
- `LOG_SUBJECT_KEY` is the HMAC salt that pseudonymises patient ids in logs. Unset, they
  record `unkeyed` — fail-visible, never the raw id.

Ready when it prints `Connected to MongoDB` then `Server running on port 3500`.

### 3. Dashboard — Vite :5173

```powershell
pnpm dev                # from front-end/
```

⚠️ Open **`http://localhost:5173`**, not `127.0.0.1:5173`. Vite binds IPv6 `[::1]` only and
the IPv4 address is refused.

`pnpm` is the package manager — `pnpm-lock.yaml` is the lockfile. Do not run `npm install`
here; it writes a competing `package-lock.json`.

### Seed the ward

The board is empty until the ward exists: the **Restart** button in the prototype feed bar,
or `POST http://127.0.0.1:3500/api/ward/seed`. Destructive by design — seeding twice gives
the same ward, not two — so skip it if the previous session's ward is still in Atlas.

### Warm the explainer before demonstrating

**Warm explainer** in the feed bar → `POST /api/ward/warmup`. Cold load measured at 27.9 s.

⚠️ **Gated on free VRAM.** The 7B needs **6700 MiB** free (`MIN_FREE_VRAM_MIB` in
`back-end/pythonService/explanation.py`) of this card's 8151. Below that the route returns
**503** naming the measured figure instead of segfaulting the service. Check first:

```powershell
nvidia-smi --query-gpu=memory.free --format=csv,noheader
```

⚠️ **Keep the card free after the load, too.** The model holds ~6079 MiB resident and
generation time scales hard with what remains: **13.7 s at 642 MiB free, 77.3 s at 60 MiB**.
Screen recording on an NVENC encoder competes for exactly that memory — record with a CPU
encoder (x264) while demonstrating.

### Confirming all three are up

```powershell
curl.exe http://127.0.0.1:8000/healthz     # {"status":"pass", ...}
curl.exe http://127.0.0.1:3500/api/ward    # array of 8 beds
Get-NetTCPConnection -LocalPort 8000,3500,5173 -State Listen | Select-Object LocalPort, OwningProcess
```

### Stopping

```powershell
Get-NetTCPConnection -LocalPort 8000,3500,5173 -State Listen |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Nothing is lost: the services are stateless and MongoDB Atlas holds the ward.

**Local only.** The model service needs a GPU and a 7B language model, so there is no
deployed backend. A static deploy of the frontend renders the shell and then shows its
error state on every fetch; that is intended.

## Two things worth knowing before reading the code

**Mongo is not a cache.** Each stored reading carries the risk band that the hysteresis
machine *published* at the time. That band is not a function of the reading's own score, so
it cannot be recomputed later — losing the collection changes what the ward says, not how
fast it says it.

**One bed publishes no score at all.** None of its eleven parameters arrive, so every input
is a population default and the reading falls below the data-sufficiency floor. That is a
designed demonstration, not a bug: the system declines to answer rather than answering from
statistics about other people.

## Verification

`checks/` holds the end-to-end tests. There is no CI — verification means running them and
reading the output. See [`checks/README.md`](checks/README.md).

## Data

Everything on screen is manufactured. The model was trained on MIMIC-IV under a PhysioNet
DUA; **no credentialed or patient-derived data appears in this repository and none may be
added to it.** `.gitignore` blocks CSVs outright for that reason.

## Status

No authentication, no RBAC, no audit log, and no HL7 feed — all named blockers before any
shadow or pilot deployment, all deliberately visible rather than stubbed.
