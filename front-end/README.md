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

```
src/
  types/clinical.ts     the frontend data contract, as types
  data/
    feed.ts             the ONLY boundary between screens and the data source
    mockFeed.ts         simulated ward — eight patients covering every contract state
    bands.ts            band table and calibrated cut points
    parameters.ts       the eleven frozen parameters
    history.ts          simulated assessment and charting history
  lib/                  formatting, class merging, band and provenance style maps
  hooks/                useClock
  components/           ui · charts · board · detail · chrome
  screens/              one per route
```

`src/data/feed.ts` is the seam. Replacing the mock with a real transport is a change to
that one file; no component imports `mockFeed` directly.

## Before changing anything visual

Read **[DESIGN.md](./DESIGN.md)**. It carries the token system and the rules behind it —
including several that are patient-safety constraints rather than preferences: no trend
language anywhere, no flashing indicators, red reserved for the CRITICAL band alone, and
provenance travelling with every value it belongs to.

## Deploying

`vercel.json` configures a static SPA deploy. Vercel needs no dashboard settings beyond
connecting the repo.

The routing rewrite is the load-bearing part: the app uses `BrowserRouter`, so without it
a direct load or refresh of `/patient/PM-204` returns 404. `/assets/*` is deliberately
excluded from the rewrite so a missing chunk 404s rather than returning `index.html`
with a 200.

Because `pnpm build` runs `tsc --noEmit` first, **a type error fails the deploy** rather
than shipping.

`X-Robots-Tag: noindex, nofollow` is set — this is a prototype showing patient-shaped
data and should not appear in search results. Remove that header if the deployment is
ever meant to be public.

## Data

All data is simulated. No MIMIC-IV or other credentialed data appears in this repo, and
none may be added to it.

## `legacy/`

The original vanilla HTML/CSS/JS demo, kept for reference during the port. It is not
built or served.
