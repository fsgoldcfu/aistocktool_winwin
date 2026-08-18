# 短炒系統：催化、業績事件及推介原因

**作者：Manus AI**  
**適用範圍：美股短炒 scanner、港股短炒 scanner、首頁及 dashboard**

> 本功能只把可追溯的事件資料加入篩選及解釋；它不預測業績結果，亦不保證價格、止盈位或勝率。

## 1. 本次已加入的邏輯

美股 scanner 會在原有價格、相對強度、成交量、Tradeability Score、結構風險計劃及成本後淨盈利門檻均通過後，讀取最近 48 小時內的公司新聞及業績日曆。新聞不再只靠一大堆字詞就直接加 15 分，而是只識別有限的可解釋類別：已公布業績優於預期、上調指引、股份回購或資本回報、重大合約／訂單／合作，以及監管批准或重要里程碑。

| 事件結果 | 系統行為 | 對推介的意義 |
|---|---|---|
| 已公布業績 EPS 實際高於預估，或近期新聞匹配可解釋正面類別 | 最多只加 6 個策略分數，並展示標題與原始連結 | 僅是額外佐證，不可取代價格與成交量確認 |
| 今日或明日公布業績 | 不發出美股日內交易推介 | 避免用日內模型承擔隔夜跳空風險 |
| 2–7 日內公布業績 | 顯示事件提示，但不當成利好加分 | 業績未公布，不可假設會好 |
| 無可信正面資料 | 顯示中性催化狀態 | 可保留技術合格訊號，但不把它包裝成新聞利好 |
| 港股新聞／業績資料源未接通 | 顯示「資料未接通」，不提供新聞加分 | 不虛構港股新聞或業績催化 |

美股業績日曆與公司新聞資料由 Finnhub API 提供；前者包含業績日及部分實際／預估欄位，後者提供公司新聞標題和原文連結。[1] [2]

## 2. 介面顯示

每一張短炒訊號卡新增「催化／事件資料」與「推介原因」區塊。原因逐條列出相對強度、入場／止蝕／結構目標及 R 倍數、Tradeability Score、成本後淨盈利門檻，以及催化或事件資訊。美股若有正面新聞，使用者可按「查看原始新聞」檢查來源；港股則會明確顯示目前沒有接通可信新聞與業績資料源。

## 3. 必要的 Vercel 設定

| Key | 是否必須 | 說明 |
|---|---|---|
| `FINNHUB_API_KEY` | 美股新聞／業績功能必須 | 用於 Finnhub 公司新聞及業績日曆；未設定時美股沒有正面新聞加分，且不能識別即將業績日。 |
| `MIN_NET_PROFIT_HKD` | 既有功能 | 每個訊號的成本後結構目標最低門檻。 |
| `US_ONE_WAY_SLIPPAGE_BPS` | 既有功能 | 富途逐筆已知收費以外的每邊價格差與滑點緩衝。 |

為避免 API 限速，業績日曆每個掃描流程只會下載一次，並快取一小時；新聞仍按股票取得，但結果只用最近 48 小時的標題作分類。

## 4. 尚未完成、但值得後續驗證的改良

| 優先級 | 改良 | 為何有價值 | 上線前驗證 |
|---:|---|---|---|
| P0 | 把實際成交結果寫入交易日誌 | 才能知道哪類 setup 真正有效 | 用 entry、exit、費用、滑點及持倉時間計算成本後 R 倍數 |
| P0 | Walk-forward 回測 | 防止用同一段歷史資料調參後誤以為有效 | 固定訓練／驗證視窗，包含成本、spread、滑點和不成交情境 |
| P1 | 港股官方公告／業績日曆資料源 | 令港股也能有可追溯催化與業績風險 gate | 先選可授權及穩定來源，再用歷史公告驗證時間戳 |
| P1 | 依 bid／ask 和實際成交品質動態設定滑點 | 比固定 bps 更貼近真實執行 | 收集每筆下單時的 bid／ask 與 fill price |
| P2 | 以交易級成效校準各因子權重 | 避免主觀分數過度擬合 | 在樣本外資料比較不同規則組合 |

## 5. 手動更新次序

請使用同一版本檔案，在同一個 Git commit 更新，避免新舊依賴混用：

1. `lib/catalystAnalysis.ts`
2. `lib/usScannerV3_7.ts`
3. `lib/hkScannerV1.ts`
4. `app/api/scan/route.ts` 與 `app/api/scan-hk/route.ts`
5. `app/dashboard/page.tsx` 與 `app/page.tsx`
6. `scripts/verify-catalyst-analysis.ts` 與 `package.json`

更新後執行：

```bash
npm run typecheck
npm run verify:catalysts
npm run verify:short-term-risk
npm run build
```

## References

[1] [Finnhub — Earnings Calendar API](https://finnhub.io/docs/api/earnings-calendar)

[2] [Finnhub — Company News API](https://finnhub.io/docs/api/company-news)
