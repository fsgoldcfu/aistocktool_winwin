# TQQQ Module Manual Update Order

## Important rule

Use **only this TQQQ package** for these files. Do not mix `lib/indexAnalysis.ts`, API routes, pages or verification scripts from older ZIP packages.

## Update order

### Step 1 — TQQQ engine

First, replace the complete file below:

```text
lib/indexAnalysis.ts
```

This file defines the TQQQ data types, completed-daily-bar logic, `TRADEABLE` / `WATCH` / `NO_TRADE` state machine, fixed-rule backtest and all API exports. It must be updated before the API route.

### Step 2 — TQQQ API route

Then replace:

```text
app/api/index-scanner/route.ts
```

The route imports `WATCHLIST`, `fetchDailyHistory`, `fetchLivePrice` and `analyzeSymbol` from the engine. It returns `DATA_UNAVAILABLE` with HTTP 503 if data is missing; it must not manufacture a trade plan.

### Step 3 — active TQQQ UI consumers

Replace both files as one step:

```text
app/dashboard/page.tsx
app/page.tsx
```

These pages consume the TQQQ API result and display status, risk plan and backtest summary. Do not update one page but leave the other page on an old result shape.

### Step 4 — verification command

Replace both:

```text
scripts/verify-index-analysis.ts
package.json
```

The package file must retain all existing project dependencies and scripts. The TQQQ validation command is:

```bash
npm run verify:index-analysis
```

## Required validation before Vercel

From the repository root, run the following commands after all five groups are replaced:

```bash
npm ci
npm run typecheck
npm run verify:index-analysis
npm run build
```

Do not create a Vercel deployment until these commands pass locally. The current consistent package passes all three checks.

## Vercel settings

For TQQQ production data, set these Vercel environment variables for the target environment:

```text
TWELVE_DATA_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

`TWELVE_DATA_API_KEY` is required for live TQQQ data. If it is absent or the provider data is invalid, `/api/index-scanner` will correctly return `DATA_UNAVAILABLE` and will not create a trade plan.

## If a Vercel build still fails

Open the deployment's **Source** tab and confirm all files above belong to the same commit. If an error names `indexAnalysis.ts`, replace the whole file rather than pasting a fragment. Do not paste Markdown markers such as ```` ``` ```` or `**` into TypeScript files. If an error names a field that is missing in `AnalysisResult`, it normally means one UI/API file is newer than `lib/indexAnalysis.ts`; repeat Steps 1–3 from this package in the same commit.
