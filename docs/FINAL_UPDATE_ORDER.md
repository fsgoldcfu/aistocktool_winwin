# 最終一致版本更新次序

## 一、先套用程式檔案

請以今次更新包內的檔案覆蓋 repository 相同路徑，**不要把幾個舊 ZIP 的檔案混合使用**。建議一次過建立一個 commit。

核心新增或修改如下：

| 類別 | 檔案 |
|---|---|
| 指數及資金可行性 | `lib/indexAnalysis.ts`、`lib/capitalSettings.ts`、`app/api/index-scanner/route.ts`、`scripts/verify-index-analysis.ts` |
| 今日心水及資金設定 | `lib/todayPicks.ts`、`app/api/today-picks/route.ts`、`components/TodayPicksPanel.tsx`、`components/CapitalSettingsPanel.tsx`、`app/page.tsx`、`app/dashboard/page.tsx` |
| 美股／港股規則與催化 | `lib/usScannerV3_7.ts`、`lib/hkScannerV1.ts`、`lib/shortTermRisk.ts`、`lib/catalystAnalysis.ts`、`lib/earningsCalendar.ts`、相關 API route 和 verification scripts |
| 交易日誌 | `supabase/migrations/20260815040000_create_trade_journal.sql`、`lib/tradeJournalMath.ts`、`components/TradeJournalPanel.tsx`、trade journal verification 和 setup 文件 |
| 歷史研究資料 | `data/index-history/*.csv`、`data/index-history/summary.json`、`data/index-history/regime-analysis.json`、`scripts/analyze-index-history.py`、`scripts/analyze-index-regimes.py` |

## 二、先在 Supabase 執行 migration

在 Supabase Dashboard 的 SQL Editor 執行更新包內的完整 migration：

```text
supabase/migrations/20260815040000_create_trade_journal.sql
```

執行後才可使用交易日誌。不要為了方便而關閉 Row Level Security。

## 三、Vercel Environment Variables

以下項目應按 Vercel 的 Development、Preview、Production 實際需要設定。敏感 key 不要放入 GitHub。

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

`MIN_NET_PROFIT_HKD=500` 是每筆交易成本後最低可接受收益門檻，並不會取消 1.5R、止蝕、催化／業績事件、流動性、信心或 Tradeability Score 閘門。Tradeability Score 預設仍為 60，目的是避免為了增加訊號而犧牲穩定性。

## 四、部署前檢查

```bash
npm ci
npm run typecheck
npm run verify:capital-settings
npm run verify:index-analysis
npm run verify:today-picks
npm run verify:short-term-risk
npm run verify:catalysts
npm run verify:trade-journal
npm run build
```

完成後 push，於 Vercel Redeploy。登入網站後先在「資金設定」輸入你的實際本金、每日最多投入比例和最多同時持倉數，再按保存；短炒、指數和今日心水會共用這些設定。部署後分別測試 `/api/index-scanner` 和 `/api/today-picks`；若資料 key 未設定，系統應 fail closed，而不是顯示虛構價格。

## 五、使用限制

港股新聞目前仍依賴可用的新聞供應，iTick 本身沒有完整新聞時，系統會把催化狀態標記為 unavailable／neutral，不能當成「沒有壞消息」。指數歷史數據報告是研究資料，不是自動把歷史高低位轉成保證盈利的預測。交易日誌需要登入 Supabase user 才能保存，且不會自動落單。
