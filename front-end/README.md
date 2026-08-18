# PulseMind UI

Clinician-facing prototype for **ICU mechanical-ventilation risk monitoring**. Read-only,
clinician-in-the-loop: it never controls a ventilator, never recommends treatment, and
never acts without a clinician.

React 19 · Vite · TypeScript · Tailwind v4.

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # type-check, then production build
pnpm type-check
```

## Screens

| Route | Screen |
|---|---|
| `/` | Triage board — ranked patients, plus a separate unranked data-limited list |
| `/patient/:patientId` | Prompt, score, hysteresis state, ranked factors, explanation, all eleven parameters |
| `/patient/:patientId/parameter/:parameterName` | One parameter's charting provenance over time |

## Layout

The data contract is **not** in here. It lives at `../contract/clinical.ts`, aliased
`@contract`, because this app is scheduled to be replaced and the contract has to outlive it.

```
src/
  data/
    feed.ts             the ONLY boundary between screens and the API
    WardProvider.tsx    holds the ward; every selector in feed.ts reads it synchronously
    bands.ts            band table and calibrated cut points
    parameters.ts       the eleven frozen parameters
  lib/                  formatting, class merging, band and provenance style maps
  hooks/                useApi · useClock · useTheme
  components/           ui · charts · board · detail · chrome
  screens/              one per route
```

`src/data/feed.ts` is the seam, and it now reads a live API — `fetch('/api/...')`, proxied
to the Node service. It was a fixture module once; the swap touched that one file and no
component changed, which is what the seam is for.

## Before changing anything visual

Read **[DESIGN.md](./DESIGN.md)**. It carries the token system and the rules behind it —
including several that are patient-safety constraints rather than preferences: no trend
language anywhere, no flashing indicators, red reserved for the CRITICAL band alone, and
provenance travelling with every value it belongs to.

## Deploying

⚠️ **A deployed build has no backend.** The board is served entirely from the Node API,
which talks to MongoDB and to the local model service — and the model service holds a
7 B language model and a GPU-pinned booster, so it runs on a workstation, not on Vercel.
A static deploy renders the shell and then shows the error state on every fetch. That is
the intended behaviour for now; the demo is **local-only**.

`vercel.json` configures a static SPA deploy. Vercel needs no dashboard settings beyond
connecting the repo.

The routing rewrite is the load-bearing part: the app uses `BrowserRouter`, so without it
a direct load or refresh of `/patient/PM-204` returns 404. `/assets/*` is deliberately
excluded from the rewrite so a missing chunk 404s rather than returning `index.html`
with a 200 — and `/api/*` is excluded for the same reason. Rewriting an API call to
`index.html` returns HTML with a 200, `.json()` then throws on `<`, and the board reads
as broken rather than as backendless.

Because `pnpm build` runs `tsc --noEmit` first, **a type error fails the deploy** rather
than shipping.

`X-Robots-Tag: noindex, nofollow` is set — this is a prototype showing patient-shaped
data and should not appear in search results. Remove that header if the deployment is
ever meant to be public.

## Data

All data is simulated. No MIMIC-IV or other credentialed data appears in this repo, and
none may be added to it.
