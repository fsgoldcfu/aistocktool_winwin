# 美股與港股短炒系統：審閱與改動交接

## 核心結論

本次改動不宣稱提高或保證任何勝率。它的目標是移除會**虛增訊號品質**、產生未定義風險或以不一致資料計算相對強度的設計，令「不交易」成為正常且可顯示的結果。

| 類別 | 發現 | 已實作改動 |
|---|---|---|
| 風險回報 | 原美港 scanner 使用 `0.5 × ATR` 目標、約 `0.7 × ATR` 止蝕，沒有最低 R 倍數；很多情況目標小於風險。 | `lib/shortTermRisk.ts` 只接受至少 **1.5R** 的最近結構阻力；不合格便不產生 recommendation。 |
| 止蝕 | `maxStopLossPercent` 原本寫成 `3`，但既沒有用作 3% gate，亦沒有保證不被 ATR 超過。 | 統一改為小數 `0.03`；初始 ATR 風險大於 3% 時 fail closed。 |
| 時間退出 | 原系統有過時的固定 HKT 清倉訊息，卻沒有寫入 recommendation。 | 美股為 90 分鐘、港股為 120 分鐘的明確 time stop；API 和 UI 均展示。 |
| 策略分數 | 板塊共振會直接把 `confidence` 設為 100，容易被理解成 100% 勝率。 | 改為有限加分；前端標示為「策略分數（非勝率）」。 |
| 排序 | 原來先按目標利潤排序，可能優先選擇 capital 大或價格高、而非結構較合理的股票。 | 先以 Tradeability Score 硬性過濾；跌市仍優先逆市股；其後按 Score、R 倍數、策略分數、目標毛利排序，最多 5 隻。 |
| 美股市場時間 | 舊程式把 HKT 時段硬編碼為 EST，夏令時間會錯位。 | 以 `America/New_York` 判定 regular session；只在 09:30–16:00 產生可交易訊號。 |
| 港股相對強度 | HK quote 原來以開市價當前收市價，與美股使用 prior close 的定義不一致。 | 嘗試 `pc`、`preClose`、`yc` 作前收市欄位，最後才退回 `o`；需以真實 iTick payload 確認欄位。 |
| 日線／快取 | HK 歷史快取只用股票代碼，`1mo` 和 `3mo` 可混用。 | 改為 `${code}:${period}` 快取鍵；日線 parser 拒絕無效 OHLCV／重複日期。 |
| 美股供應商安全 | 美股資料層存有 fallback API key，公開 repository 後尤其危險。 | 移除硬編碼 key；只有 Vercel environment variables 存在時才掃描。 |
| 資料失敗 | API 可能將錯誤掃描理解成空訊號。 | API 返回 503 與「未產生交易訊號」訊息；成功回應加 no-store header。 |

## 每日 Tradeability Score 選股

固定股票池只代表候選宇宙，不代表每隻股票每日都值得交易。每次掃描會先為通過基本風險計劃的候選計算 Tradeability Score，滿分 100，預設最低門檻為 60。分數由成交活躍度、相對大市強度、可交易 ATR、回報／風險比及逆市背景組成；它是「今日是否較可執行」的排序分數，**不是勝率，也不是盈利保證**。

美股及港股均會先以 Score 過濾，再按 Score、R 倍數、策略確認分數及目標毛利排序，最後最多輸出 5 隻。若只有 3 隻通過，就只輸出 3 隻；若沒有候選達到 60，就輸出零隻並顯示原因。系統不會為湊足 5 隻而降低門檻。

## 新的短炒計劃狀態

掃描只在相應市場的**正規交易時段**輸出 active signal。休市、午休、收市分析、資料不足、沒有至少 1.5R 結構目標、止蝕超過 3% 或策略分數低於 60 時，系統返回空訊號和原因，而不是勉強湊五隻。

每個 active signal 包含：entry reference、target、initial stop、回報／風險、time stop、entry rule、invalidation rule、配置參考與 target gross-profit reference。`expectedProfitHKD` 只屬於未扣 spread、滑點、交易費及稅項的研究參考，不應理解為承諾。

## 檔案清單與手動套用

如果 GitHub 寫入權限仍未修好，請把下列檔案從本次交付附件覆蓋到同名路徑。這些檔案彼此有引用關係，**不要只改其中一部分**。

| 優先度 | 檔案 | 用途 |
|---|---|---|
| 必須 | `lib/shortTermRisk.ts` | 新增共用風險計劃與 1.5R gate。 |
| 必須 | `lib/usScannerV3_7.ts` | 美股時間、風險、排序及 score gate。 |
| 必須 | `lib/hkScannerV1.ts` | 港股風險、時間、排序及 score gate。 |
| 必須 | `lib/yfinanceData.ts` | 移除公開 key、split-adjusted 日線與資料驗證。 |
| 必須 | `lib/hkStockData.ts` | HK 變幅基準、日線驗證與快取鍵修正。 |
| 必須 | `app/api/scan/route.ts` | 美股風險欄位、503 fail closed 和 no-store。 |
| 必須 | `app/api/scan-hk/route.ts` | 港股風險欄位、503 fail closed 和 no-store。 |
| 建議 | `app/dashboard/page.tsx` | dashboard 顯示 R、time stop、失效規則。 |
| 建議 | `app/page.tsx` | 首頁的重複短炒介面同步更新。 |
| 建議 | `scripts/verify-short-term-risk.ts` | 核心風險計劃驗證。 |
| 建議 | `package.json` | 增加 `verify:short-term-risk` 指令。 |

## Vercel environment variables

部署前請於 Vercel 設定以下 environment variables；不要把 key 寫進 GitHub。舊有硬編碼 key 已移除。

| 變數 | 用途 | 必須性 |
|---|---|---|
| `FINNHUB_API_KEY` | 美股即市報價及美股新聞。 | 美股短炒必須。 |
| `TWELVE_DATA_API_KEY` 或 `TWELVE_DATA_KEY` | 美股 split-adjusted 日線；TQQQ 模組建議使用前者。 | 美股／TQQQ 必須。 |
| `ITICK_API_KEY` | 港股報價及日線。 | 港股短炒必須。 |
| `NEXT_PUBLIC_SUPABASE_URL` | 現有登入／資料功能。 | 現有站點必須。 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 現有登入／資料功能。 | 現有站點必須。 |

## 必須在真實資料再確認的項目

iTick API 沒有在本次環境提供可驗證 key／payload。因此 `pc`、`preClose`、`yc` 哪一個是它的 prior-close 欄位，必須在 non-production log 檢查一次。若全部不存在，parser 會退回 `o`，但那只是一個兼容 fallback，不應當成正式驗證的 prior-close relative strength。

港股 `lotSize` 現有邏輯仍把一手當一股。這是原系統遺留限制，會令「可買股數／預期利潤」只可當概算。正式落單前應建立每個 symbol 的 board-lot table，然後將 `sharesCanBuy` 向下取整至一手倍數；此功能需要先取得你實際使用 broker 與股票池的 lot-size 資料。

## 本地驗證

```bash
npm ci
npm run typecheck
npm run verify:index-analysis
npm run verify:short-term-risk
NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co' \
NEXT_PUBLIC_SUPABASE_ANON_KEY='test-anon-key' \
npm run build
```

本次工作環境已通過上述三個邏輯／型別檢查及 placeholder Supabase production build。實際 API response 無法在此環境驗證，因為沒有部署環境的 `FINNHUB_API_KEY`、`TWELVE_DATA_API_KEY` 與 `ITICK_API_KEY`。
