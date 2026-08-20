# 成本後 HK$500 淨盈利推薦門檻

> **這是一個推薦資格門檻，不是獲利保證。** 系統只會在結構性目標價被觸及、實際可交易股數、以及已設定的估計交易成本之下，計算出至少 HK$500 的估計淨盈利時，才產生 short-term recommendation。

## 新規則

每個美股及港股 setup 現在必須依序通過：

1. 正規交易時段、資料品質、相對強度、風險計劃及 Tradeability Score。
2. 結構阻力目標至少為 1.5R，初始止蝕不超過 3%。
3. 以可買入整數股數或港股完整 board lot 計算目標毛利。
4. 以買入及賣出的名義金額各自扣除估計成本。
5. 只有以下條件成立才輸出推薦：

```text
估計成本後淨盈利 >= MIN_NET_PROFIT_HKD
```

預設 `MIN_NET_PROFIT_HKD` 為 `500`。此門檻套用到**每個個別推薦**，不是將多隻未達標 setup 加總後才達標；它不代表每日賺錢保證。

## 計算方式

```text
gross profit = (structure target - entry) × actual shares
estimated costs = (entry × actual shares + target × actual shares) × one-way cost bps / 10,000
estimated net profit = gross profit - estimated costs
```

美股再以系統的 USD/HKD 換算值轉成港元。前端會分開顯示「配置參考」、「結構目標成本後淨盈利」及已扣除的估計買賣成本，避免再把毛利當成淨盈利。

## 必須設定的 Vercel environment variables

| 變數 | 預設 | 用途 |
|---|---:|---|
| `MIN_NET_PROFIT_HKD` | `500` | 每個推薦的最低估計成本後淨盈利門檻。 |
| `US_ONE_WAY_COST_BPS` | `12` | 美股每邊成本假設（佣金、費用、spread、滑點的可調整合計）。 |
| `HK_ONE_WAY_COST_BPS` | `20` | 港股每邊成本假設（佣金、交易費、spread、滑點的可調整合計）。 |
| `HK_BOARD_LOT_MAP_JSON` | 無預設 | 港股每個股票代碼的真實一手股數。未設定時，港股 scanner fail closed，不會產生推薦。 |

成本 bps 的預設值只是保守起點，不是你的實際 broker 收費。請用實際成交紀錄，包括佣金、平台費、交易徵費、印花稅、bid-ask spread 與滑點，重新校準後才可把「估計成本後」理解為接近實盤結果。

## 港股 board-lot 設定

港股每手股數並不一致，原本把一手當一股會令倉位、毛利與淨盈利全都不可靠。因此本次更新要求設定 `HK_BOARD_LOT_MAP_JSON`，格式如下：

```json
{
  "0700": 100,
  "9988": 100,
  "3690": 100
}
```

以上只示範 JSON 格式；請以你的 broker 或交易所資料核實整個固定港股池的每手股數，並輸入所有需要掃描的代碼。缺少某一代碼時，該代碼不會推薦，而不是以錯誤的一手股數估算。

## 結果解讀

通過這個 gate 代表：「在當前報價、結構目標、可交易股數和已設定成本假設下，目標價若被觸及，估計淨盈利可達門檻。」它**不代表**目標價必然會被觸及，也不代表當日一定能賺 HK$500。市場跳空、滑點擴大、流動性改變、部分成交、資料延遲和提前 time stop 都可能令實際結果不同。
