# TQQQ 日線風險計劃模組

## 定位

此模組是 **日線分析與風險計劃工具**，並不會自動交易，亦不保證任何勝率。它把日線資料、支持／阻力與反轉條件分為「可交易」、「觀察」和「不交易」三個狀態，避免任何市況都顯示買入價。

> TQQQ 追求 Nasdaq-100 的每日 3 倍表現。日線訊號和持有期表現是不同概念；所有輸出均須連同槓桿、跳空及波動風險理解。

## 資料規則

| 項目 | 實作 |
|---|---|
| 日線資料 | Twelve Data `/time_series`，明確要求 `adjust=splits`、`order=asc`。 |
| 資料驗證 | 拒絕重複日期、缺失日期、無效／負數價格、負成交量及不合理 OHLC bar。 |
| 指標資料截點 | SMA、ATR、RSI、布林通道、趨勢與 trigger 只使用最後一根**完成日線**。 |
| 現價 | Twelve Data `/price` 只作現價顯示及時間標記，不能改變日線訊號。失敗時以最後收市價顯示。 |
| Fail closed | 資料錯誤、限流或 API 回應不完整時，API 回傳 `DATA_UNAVAILABLE`，不會產生可下單計劃。 |

## 狀態機

| 狀態 | 條件 | 前端行為 |
|---|---|---|
| `TRADEABLE` | 強勢趨勢、確認支持區、拉回 setup、完成日線反轉 trigger 與最低 1.5R 風險回報同時成立。 | 顯示 entry、initial stop、target 1／2、每股風險、最長持有日和失效規則。 |
| `WATCH` | 已在支持區形成拉回 setup，但 RSI／布林反轉未確認。 | 不顯示 order-ready 價格；列為等待確認。 |
| `NO_TRADE` | 趨勢弱／中性、支持不足、目標太近、止蝕太遠或未出現 setup。 | 不顯示交易計劃，並說明首個拒絕原因。 |

## 固定策略規格（供研究／回測）

策略名稱：`tqqq-daily-pullback-v2`。

1. 只在 `close > SMA50 > SMA200` 的強勢日線趨勢研究 long pullback。
2. setup 必須在確認支持區 2 ATR 內，且出現 RSI 超賣／布林下軌拉回跡象。
3. trigger 為 RSI 重返 30 或收市重返布林下軌內；交易計劃使用下一交易日「突破 trigger 日高位」的進場規則。
4. initial stop 以支持下方的 ATR buffer 與最低 1 ATR 風險共同設定；風險超過 2 ATR 時拒絕。
5. target 1 必須至少為 1.5R；目標二以 2.5R 或更高結構阻力為準。
6. 最長持有 5 日。回測中遇到開市跳空止蝕以開市價退出；日內同時觸及目標與止蝕採 stop 優先的保守處理。
7. 回測在每次進、出使用每邊 10 bps 成本假設。此數值只是研究假設，部署前應按實際 broker、spread 與滑點重估。

## 回測輸出與限制

模組提供一個固定規則的前 70% 研究樣本與最後 30% 時序 out-of-sample 摘要，包括交易數、勝率、平均 R、profit factor、淨回報、最大回撤、最大連敗與平均持有日。

這個 OOS 分割**不是**完整 walk-forward 或正式過擬合檢定。若更改任何策略參數，必須記錄實驗、重新執行時序驗證，並保留一段從未參與研究的 final hold-out。

## 本地驗證

```bash
npm ci
npm run typecheck
npm run verify:index-analysis
NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co' \
NEXT_PUBLIC_SUPABASE_ANON_KEY='test-anon-key' \
npm run build
```

`verify:index-analysis` 會檢查日線排序、資料品質 fail-closed、完成日線標記、回測輸出與交易計劃不變量。真正部署仍須在 Vercel 設定 `TWELVE_DATA_API_KEY`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY` 及現有系統所需的其他資料供應商環境變數。
