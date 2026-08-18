# Manual Update Order

## Why the previous build failed

`lib/hkScannerV1.ts` imports `calculateTradeabilityScore` from `lib/shortTermRisk.ts`. Therefore, updating the scanner before updating the shared risk module creates a mixed-version build and produces `has no exported member 'calculateTradeabilityScore'`.

## Required update order

### 1. Start from a clean base

Use the same Git branch and the same repository root for every file. Do not mix files from earlier ZIP packages. If possible, create a new branch such as `fix/tradeability-sync` from the current deployment branch.

### 2. Update the dependency root first

Replace the complete file:

```text
lib/shortTermRisk.ts
```

This file must export both `buildLongIntradayRiskPlan` and `calculateTradeabilityScore`. Do not paste only the function body. Do not paste Markdown fences or explanatory `**` characters into the TypeScript file.

Commit this step with a message such as `sync shared tradeability risk module`.

### 3. Update the scanner implementations

After Step 2 is committed, replace both complete files:

```text
lib/usScannerV3_7.ts
lib/hkScannerV1.ts
```

These files import the function from Step 2 and add the score to each recommendation. They also return at most five recommendations after the score gate; fewer than five and zero are valid outputs.

Commit this step with a message such as `apply tradeability score to US and HK scanners`.

### 4. Update API consumers

Replace the complete files:

```text
app/api/scan/route.ts
app/api/scan-hk/route.ts
```

These routes pass `tradeabilityScore`, `tradeabilityReason`, `tradeabilityThreshold`, and `qualifiedCandidates` to the frontend.

Commit this step with a message such as `expose tradeability metadata in scan APIs`.

### 5. Update frontend consumers

Replace the complete files:

```text
app/dashboard/page.tsx
app/page.tsx
```

The UI displays the daily threshold and qualified-candidate count. It labels the score as an execution score, not a win rate.

Commit this step with a message such as `show dynamic qualified candidate count`.

### 6. Update verification files

Replace or merge:

```text
scripts/verify-short-term-risk.ts
package.json
```

The verification script checks both an accepted and a rejected Tradeability Score. Do not overwrite unrelated scripts in `package.json`; preserve existing dependencies and scripts.

## Verification after each step

Run the following from the repository root after Steps 2–5:

```bash
npm ci
npm run typecheck
```

The build must not be attempted until `npm run typecheck` passes. After all files are updated, run:

```bash
npm run verify:short-term-risk
npm run build
```

For Vercel, set the real project environment variables before the final deployment, including Supabase variables and `ITICK_API_KEY` for Hong Kong data. A local build may show warnings about missing `ITICK_API_KEY`; that warning is not a TypeScript error, but the production Hong Kong scanner cannot fetch data without the variable.

## Vercel deployment procedure

Push one commit containing the complete consistent set, rather than creating separate Vercel Agent edits that can leave the repository half-updated. Let Vercel build the commit. If the build still says `shortTermRisk has no exported member`, open the deployed commit's Source tab and confirm that `lib/shortTermRisk.ts` contains the exact line:

```ts
export function calculateTradeabilityScore(
```

If it does not, the wrong branch or an incomplete file was deployed. If it does, then check that the import path in `lib/hkScannerV1.ts` is exactly `"./shortTermRisk"` and that the file name casing matches.
