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

Three processes, in this order. Full commands in [`back-end/README.md`](back-end/README.md).

```powershell
..\.venv\Scripts\python.exe -m uvicorn app:app --app-dir back-end/pythonService
node server.js          # from back-end/, needs .env
pnpm dev                # from front-end/
```

Then `POST /api/ward/seed` — the board is empty until you do.

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
