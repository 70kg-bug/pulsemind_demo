# PulseMind — demo

Clinical decision support for **ICU mechanical ventilation**: stream ventilator telemetry,
score it for respiratory deterioration within 6 hours, and show a clinician why. Read-only
and clinician-in-the-loop. It never controls a ventilator and never recommends treatment.

This repository is the **live demo** — the only place the trained model reaches a screen.

```
back-end/    Node :3500    Express + Mongoose -> MongoDB Atlas. The history of record.
             FastAPI :8000 pythonService/. The only process that touches the model.
front-end/   Vite :5174    React. The ENGINEERING view: simulation bar, ward stream, telemetry.
contract/                  The shared data contract, as TypeScript types.
checks/                    Executable end-to-end verification.
```

**There are two front-ends now, and only one of them is the clinical demo.** Since 2026-08-29
the screen a clinician or a judge looks at is the finalized SvelteKit UI in the sibling
repository `frontend-and-backend-FINAL/`, on **:5173**. This repository's React app moved to
**:5174** and is kept as the engineering view. Both read the same `/api` on :3500, so the
backend is the single source of truth for both and neither can drift from the model.

Setting up the clinical UI is [its own section](#4-the-clinical-ui--sveltekit-5173) below. If you
only want to see the pipeline work, the React app alone is still enough.

The model itself lives in a separate repository and is imported as a package; this one owns
the serving path and the screen.

## First-time setup

⚠️ **This repository does not stand alone.** A clone of it by itself cannot run the demo —
the model, its fitted artifacts and the Python environment all live outside it. It expects
to sit in a workspace:

```
<workspace>/
  .venv/            Python 3.12, shared by both repositories
  bki/              the model repository -- REQUIRED, see step 1
  models/           fitted artifacts, ~103 MB (the 15 GB of 7B weights were deleted 2026-09-16)
  pulsemind_demo/   this repository
```

### 1. The model repository, as a sibling directory

`back-end/pythonService/requirements.txt` begins with `-e ../../../bki[llm]` — an editable
install from a **local checkout**, not from PyPI. `bki/` must sit beside this directory, or
the install fails on its first line and nothing else gets installed.

### 2. The Python environment

```powershell
uv venv --python 3.12 ..\.venv
cd back-end\pythonService
uv pip install --python ..\..\..\.venv\Scripts\python.exe -r requirements.txt
```

⚠️ **The workspace venv is a `uv venv` and contains no pip** — `python -m pip` answers
`No module named pip`, and there is no `Scripts\pip.exe`. Use `uv pip`; a plain `pip`
command will either fail or, worse, silently hit a different interpreter's pip.

⚠️ **Run the install from `pythonService/`.** The relative `../../../bki` path is resolved
against the **working directory**, not against the requirements file. Verified — from
anywhere else it fails outright:

```
error: Couldn't parse requirement ... at position 655
  Caused by: path could not be normalized: D:\Temp\../../../bki
```

⚠️ **Torch is deliberately unpinned there.** The Blackwell `sm_120` GPU needs the cu128
build, which comes from PyTorch's own index rather than PyPI:

```powershell
uv pip install --python ..\..\..\.venv\Scripts\python.exe torch --index-url https://download.pytorch.org/whl/cu128
```

Dropping the `[llm]` extra is a legitimate choice — the service still scores and bands, and
explanations fall back to the deterministic template.

### 3. The fitted artifacts

`models/serving_assets.json` and its companions — booster, calibrator, band table,
operating point, `evidence_map.json` — are loaded at startup (`model_runtime.py:26`,
redirectable with `PM_MODELS_ROOT`). **They are in neither repository and cannot be:** they
are derived from MIMIC-IV under a PhysioNet DUA. Without them the service will not start.
The 7B weights under `models/llm` are a further 15 GB and are needed only for generated
explanations, not for scoring. ⚠️ **They were deleted on 2026-09-16**, so generation is dormant
here; `core/generate.py` passes no `local_files_only`, so a warmup request starts a ~15 GB
download instead of failing. Set `HF_HUB_OFFLINE=1` on the FastAPI process unless that is what
you want.

### 4. JavaScript dependencies — three installs, two package managers

```powershell
# each line from THIS directory, so they can be pasted one at a time
npm  install --prefix back-end                                  # package-lock.json
pnpm install --dir    front-end                                 # pnpm-lock.yaml
pnpm install --dir    ..\frontend-and-backend-FINAL\front-end   # its own pnpm-lock.yaml
```

Do not cross them. `back-end/` is the only npm project here; running `pnpm` in it, or `npm` in
either front-end, writes a competing lockfile.

The third is the clinical UI and lives in a different repository. Skip it if you only want the
engineering view.

### 5. `back-end/.env`

Copy `back-end/.env.example` and fill it in — it documents every key, including the
percent-encoding rule that makes an Atlas password with reserved characters parse. Two of
its keys are optional and change behaviour rather than connectivity:

- **`PM_ALLOW_DESTRUCTIVE`** — leaving it *out* of `.env` and setting it per-shell instead
  is the safer habit, since it unlocks a seed that deletes all three collections.
- **`LOG_SUBJECT_KEY`** — if you do put it in `.env`, the run commands below need no
  environment prefix at all.

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
startup — the fix is to redo **First-time setup step 2**, not to set the variable. Use the
requirements file rather than a bare `pip install -e ..\bki`, which would miss the `[llm]`
extra and the service's own dependencies.

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

Both are also valid `.env` keys — `.env.example` lists them. Put them there and the prefix
above is unnecessary; the shell form is shown because it keeps the destructive one scoped
to a single session.

Ready when it prints `Connected to MongoDB` then `Server running on port 3500`.

### 3. Engineering view — Vite :5174

```powershell
pnpm dev                # from front-end/
```

⚠️ **:5174, not :5173.** The clinical UI took 5173 on 2026-08-29 and this app moved. The port
is set in `front-end/vite.config.ts`; `back-end/config/allowedOrigins.js` already lists both.

⚠️ Open **`http://localhost:5174`**, not `127.0.0.1:5174`. Vite binds IPv6 `[::1]` only and
the IPv4 address is refused.

`pnpm` is the package manager — `pnpm-lock.yaml` is the lockfile. Do not run `npm install`
here; it writes a competing `package-lock.json`.

This is where the simulation bar, the ward stream driver and the original telemetry dock live.
Everything here still works; it is simply no longer the screen the demo is given on.

### 4. The clinical UI — SvelteKit :5173

⚠️ **A DIFFERENT REPOSITORY.** It is not under this one and it has its own lockfile, its own
package manager and its own tests:

```
<workspace>/
  pulsemind_demo/              this repository
  frontend-and-backend-FINAL/  the finalized UI
    front-end/                 the SvelteKit app  <- pnpm runs HERE
    back-end/                  a scaffold this demo does not use. Ignore it.
```

```powershell
cd ..\frontend-and-backend-FINAL\front-end
pnpm install
pnpm dev
```

Node 22 and pnpm 10. `pnpm install` also runs `svelte-kit sync`, which generates the types
`pnpm check` needs; a fresh clone that skips it fails type-checking for a reason unrelated to
its code.

**`front-end/.env` is what points the app at this backend, and it is NOT in the repository.**
Copy the example and edit if you need to:

```powershell
cp .env.example .env    # from frontend-and-backend-FINAL/front-end
```

The defaults in `.env.example` are already correct for this demo, so a straight copy is enough.
The four keys:

```ini
PUBLIC_PULSEMIND_DATA_SOURCE=pulsemind   # selects the live pipeline over the fixtures
PUBLIC_PULSEMIND_API_BASE=/api           # same origin, through the Vite proxy
PUBLIC_PULSEMIND_DEMO_CONTROLS=true      # the operator strip; off by default
PUBLIC_PULSEMIND_REQUIRE_AUTH=false      # this backend has no /auth surface
```

⚠️ **No `.env` is committed, here or in the model repository, whatever is in it.** These four
are `PUBLIC_*` variables, so they are compiled into the client bundle and are already readable
by anyone who loads the page: their VALUES are harmless. That is not a reason to track the
file. A committed `.env` is where somebody later adds a real credential, and GitHub's push
protection flags the filename without reading the contents. `.gitignore` covers `.env` and
`*.env` and makes a single exception for `*.env.example`.

⚠️ **`pulsemind` is matched as an exact string, never as a truthiness test.** Mis-spell it and
the app silently falls back to its own 30-patient fixture set, which renders perfectly and is
not this ward. The board says which source it is on; read it rather than assuming.

⚠️ **`PUBLIC_PULSEMIND_API_BASE=/api` is not a convenience.** Same-origin is what makes
`Server-Timing` readable to the pipeline panel at all, and what keeps a session cookie
first-party if authentication is ever switched on.

⚠️ **The Vite proxy does NOT rewrite the path.** It forwards `/api` verbatim, because this
service mounts everything under `/api`. The upstream design shipped a
`path.replace(/^\/api/, '')` for a root-mounted backend; leaving it in place 404s every
request in the app.

Everything else the app needs comes from this repository unchanged. It talks to the same Node
API, so the model service, Atlas and the seed are shared.

### Seed the ward

The board is empty until the ward exists. Any of three ways, and they do the same thing:
**Restart ward** in the SvelteKit demo strip, **Restart** in the React feed bar, or
`POST http://127.0.0.1:3500/api/ward/seed`. Destructive by design — seeding twice gives the
same ward, not two — so skip it if the previous session's ward is still in Atlas.

⚠️ **Seed 24 ticks for the clinical UI.** Its risk-history chart windows to 24 hours, and a
tick is one hour of ward time, so a shorter backfill leaves the chart nearly empty. The demo
strip's Restart already asks for 24; a hand-rolled `POST` should send
`{"backfill_ticks": 24}`.

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

### Showing the pipeline

Both front-ends have one, reading the same headers off the same requests.

- **Clinical UI (:5173)** — `Show pipeline` in the demonstration strip along the bottom.
- **Engineering view (:5174)** — `Pipeline` in the feed bar.

Either opens a dock listing every API call that app makes, with the time each stage of the
pipeline actually took — feature assembly, scoring, the band decision, generation, the Mongo
write. Closed, it costs the board no height at all, which is why the control lives in an
existing bar rather than in a second one.

Every figure is measured by the tier that did the work and returned on a W3C
`Server-Timing` header. **A stage that did not run shows as absent, never as `0 ms`** — the
two are indistinguishable on screen, so a failed measurement would read as a successful
one. The spans are indented as they nest: the model service's stages sit inside the Node
hop, which sits inside the browser round trip, so their durations are not meant to be added
up.

A tick, measured on 2026-08-22: **~43 ms** to score each reading, **14.9 ms** to assemble its
109-column feature row, **12 µs** for the band machine, and **1.16 s** writing the results to
Atlas. The database, not the model, is most of a tick.

⚠️ Scoring is a **range**, not a constant: seven samples gave 31.6 · 42.5 · 43.1 · 43.4 ·
43.9 · 60.4 · 64.7 ms, and the first tick after an idle period is consistently ~50% slower
than the rest. Read it off the panel rather than quoting one of these.

⚠️ The "~66 ms to score" that appears in several comments here had never been computed by
anything — `model_runtime` contained no clock at all. The `assess` span is the first real
measurement. It came out close, which is luck rather than evidence; quote the span.

### Confirming the services are up

```powershell
curl.exe http://127.0.0.1:8000/healthz     # {"status":"pass", ...}
curl.exe http://127.0.0.1:3500/api/ward    # array of 8 beds
Get-NetTCPConnection -LocalPort 8000,3500,5173,5174 -State Listen | Select-Object LocalPort, OwningProcess
```

### Stopping

```powershell
Get-NetTCPConnection -LocalPort 8000,3500,5173,5174 -State Listen |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Nothing is lost: the services are stateless and MongoDB Atlas holds the ward.

**Local only.** The model service needs a GPU and a 7B language model, so there is no
deployed backend. A static deploy of either front-end renders the shell and then shows its
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

⚠️ **The clinical UI has sign-in SCREENS, and they guard nothing here.** It ships a complete
password, TOTP and passkey surface, but this backend serves no `/auth`, so the gate is off
(`PUBLIC_PULSEMIND_REQUIRE_AUTH=false`) and `/login` renders its own "demonstration build"
notice. Screens are not the blocker; the missing surface is. Do not read them as authentication.

**A clinician's review IS recorded now**, against the reading's prompt, with the disposition and
the time. It records no clinician, because nothing signs the action, and both the panel and the
review history say so in words. Attribution is still a blocker.
