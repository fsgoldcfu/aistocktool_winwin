# AISTOCKTOOL WINWIN — 唯一完整更新版本

## 重要說明

這個版本是由目前專案重新整理的**完整一致版本**。請不要再使用之前任何 partial patch、HK$50 版本、HK$500 patch 或 export-fix patch；只使用與本文件一同提供的完整 ZIP。

本版本在本地已通過 `typecheck`、全部 verification scripts 和 production build。Vercel 的 Browserslist、`metadataBase` 和沒有真實資料 API key 的提示屬於 warning，不是 compile error。

## 一、備份目前 repository

在 GitHub Codespaces 先執行：

```bash
git status
git checkout -b backup-before-aistocktool-full-release
git add -A
git commit -m "backup before full consistent release" || true
```

如果目前有未完成的私人改動，先另行備份，不要直接混入本版本。

## 二、覆蓋完整專案

解壓本 ZIP 後，將 ZIP 內的專案內容直接覆蓋 repository root。不要把整個 ZIP 資料夾再放入 repository 內，也不要逐個從舊 ZIP 揀檔案。

這次完整版本必須包括目前專案的 `app/`、`components/`、`lib/`、`scripts/`、`docs/`、`data/`、`supabase/`、`package.json` 和 `package-lock.json`。最重要的是必須同時更新：

```text
lib/shortTermRisk.ts
lib/usScannerV3_7.ts
lib/hkScannerV1.ts
lib/capitalSettings.ts
lib/todayPicks.ts
app/api/index-scanner/route.ts
app/api/today-picks/route.ts
app/api/scan/route.ts
app/api/scan-hk/route.ts
app/page.tsx
app/dashboard/page.tsx
components/CapitalSettingsPanel.tsx
components/TodayPicksPanel.tsx
```

這樣可以避免只更新 route、但留下舊 `shortTermRisk.ts` 或舊 `hkScannerV1.ts`。`lib/todayPicks.ts` 已加入兼容邊界，但完整版本仍必須整包覆蓋，避免資金設定在舊 scanner 中被忽略。這樣可以避免再次出現 `evaluateFutuUsStockNetProfit is not exported` 或 `Expected 0-1 arguments, but got 2`。

## 三、先執行 Supabase migration

在 Supabase Dashboard 的 SQL Editor 執行完整檔案：

```text
supabase/migrations/20260815040000_create_trade_journal.sql
```

不要關閉 Row Level Security。交易日誌需要有效 Supabase user session 才能保存。

## 四、設定 Vercel Environment Variables

在 Vercel 的 Development、Preview 和 Production 按實際需要設定：

```text
MIN_NET_PROFIT_HKD=500
DEFAULT_TOTAL_CAPITAL_HKD=180000
DEFAULT_DAILY_ALLOCATION_PERCENT=55.5556
DEFAULT_MAX_OPEN_POSITIONS=2
US_ONE_WAY_SLIPPAGE_BPS=5
HK_ONE_WAY_SLIPPAGE_BPS=5
HK_PLATFORM_FEE_PER_ORDER=15
HK_COMMISSION_RATE=0
FINNHUB_API_KEY=<你的 Finnhub key>
TWELVE_DATA_API_KEY=<你的 Twelve Data key>
ITICK_API_KEY=<你的 iTick key>
HK_BOARD_LOT_MAP_JSON={"0700":100,"9988":100,"3690":100,"9618":100,"1810":200,"0005":400,"2318":500,"1299":1000,"0388":100,"0939":1000,"0883":1000,"0857":2000,"2628":1000,"1088":1000,"0386":2000,"1211":500,"9866":100,"2015":200,"0175":1000,"1958":1000,"0941":500,"0762":2000,"0006":500,"0002":500,"1038":500}
NEXT_PUBLIC_SUPABASE_URL=<你的 Supabase URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<你的 Supabase anon key>
```

`DEFAULT_*` 只是在瀏覽器尚未保存資金設定時的 fallback。登入網站後，請在「資金設定」輸入你自己的本金、每日最多投入比例和最多持倉數，再按「保存資金設定」。

## 五、Codespaces 驗證

在 repository root 執行：

```bash
npm ci
npm run typecheck
npm run verify:capital-settings
npm run verify:short-term-risk
npm run verify:index-analysis
npm run verify:today-picks
npm run verify:catalysts
npm run verify:trade-journal
grep -RIn "runHKScannerV1\|runUSScannerV3_7" lib app/api
grep -RIn "evaluateFutuUsStockNetProfit" app/api lib scripts
NEXT_PUBLIC_SUPABASE_URL=https://example.invalid NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder npm run build
```

所有指令都成功後，才可以提交：

```bash
git status
git add -A
git commit -m "apply complete consistent stock scanner release"
git push origin HEAD
```

## 六、Vercel Redeploy

在 Vercel 只 Redeploy 最新 commit。不要從舊 deployment 重新部署，也不要只按重新執行而不先確認最新 commit 已經 push。

部署後先測試：

```text
/api/index-scanner
/api/today-picks
```

如果資料 API key 未設定，系統應顯示資料不可用或沒有合格訊號，而不是虛構價格。

## 七、網站首次設定

網站載入後先輸入：

```text
實際本金：你的本金
每日最多投入：例如 50
最多同時持倉數：例如 2
```

例如本金 HK$100,000、每日投入 50%、最多 2 注，系統會用每日 HK$50,000、每筆 HK$25,000 計算可買股數和成本後盈利。港股會按完整 board lot 向下取整，美股和 ETF 會按整股向下取整；估計成本後盈利不足 HK$500 時不會推薦。

## 版本驗收標準

只有以下條件全部滿足，才算完成更新：

| 驗收項目 | 標準 |
|---|---|
| GitHub | 所有完整版本檔案已在同一個 commit。 |
| Supabase | Trade Journal migration 成功執行，RLS 保留。 |
| Vercel | 最新 commit production build 成功。 |
| API | 指數和今日心水可以返回資料或明確 fail-closed。 |
| 資金設定 | 保存本金後，推薦卡的配置金額和可買股數會改變。 |
| 盈利門檻 | `MIN_NET_PROFIT_HKD=500`，不是 50，也不是 1,000。 |
| 程式依賴 | `lib/shortTermRisk.ts`、`lib/hkScannerV1.ts`、`lib/usScannerV3_7.ts`、`lib/todayPicks.ts` 是同一版本，且 build 沒有 import／參數錯誤。 |
