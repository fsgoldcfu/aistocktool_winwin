# 富途美港動態成本模型更新

> 本次更新以用戶的富途香港帳戶收費、每注約 HK$50,000，及 TQQQ、TSM、MU 等不同美股價格為設計基礎。它是成本與推薦資格模型，不保證目標價會觸及或每日能獲利。

## 為何取代固定 bps

固定 `US_ONE_WAY_COST_BPS=12` 不能準確反映不同股價的富途美股成本。例如約 HK$50,000 的倉位，在 TQQQ 約 USD70 時可買較多股，而 MU 約 USD900 時可買很少股；每股收費、每單最低費用及賣出監管費的有效成本比例不同。因此美股改為逐筆依入場價、結構目標價及完整股數計算。

港股也不再使用單一 20 bps。模型會按實際每手股數、平台費、印花稅、交易費、徵費與可調滑點計算。因港股一手股數不同，未設定 board-lot map 的股票會 fail closed，不會推薦。

## 美股普通正股／ETF模型

每一筆推薦會依序計算：

```text
買入：max(佣金每股 × 股數, 每單最低) + max(平台費每股 × 股數, 每單最低) + 結算費每股 + 滑點
賣出：同上 + SEC fee + FINRA TAF + CAT fee + 滑點
成本後淨盈利：(target − entry) × 股數 − 買入成本 − 賣出成本
```

富途官方 fixed plan 的佣金、平台費、結算費及賣出監管費已直接寫入程式；只有 spread／market impact 仍由 `US_ONE_WAY_SLIPPAGE_BPS` 表示。

## 港股普通正股模型

```text
每邊已知成本：佣金 + HK$15 平台費 + 印花稅 + settlement fee + trading fee + SFC levy + FRC levy
每邊估計成本：已知成本 + 名義金額 × HK_ONE_WAY_SLIPPAGE_BPS
```

用戶截圖顯示佣金免費期，因此預設 `HK_COMMISSION_RATE=0`。如免費期結束，請把這個值設定為實際小數費率，例如 0.0003 代表 0.03%。ETF、窩輪、牛熊證等未必適用印花稅規則；本 scanner 的推薦目標是普通正股，故預設收取印花稅。

## Vercel 環境變數

| Key | 建議起點 | 作用 |
|---|---:|---|
| `MIN_NET_PROFIT_HKD` | `500` | 每個推薦的最低成本後結構目標淨盈利。 |
| `US_ONE_WAY_SLIPPAGE_BPS` | `5` | 美股每邊 spread／滑點緩衝；富途已知費用由程式按股數計算。 |
| `HK_ONE_WAY_SLIPPAGE_BPS` | `5` | 港股每邊 spread／滑點緩衝；已知費用由程式按成交金額計算。 |
| `HK_COMMISSION_RATE` | `0` | 富途港股佣金率；目前按截圖的免費期設定為 0。 |
| `HK_PLATFORM_FEE_PER_ORDER` | `15` | 富途港股每單平台費。 |
| `HK_BOARD_LOT_MAP_JSON` | 必填 | 每個港股代碼的真實每手股數。 |

## 驗證情景

驗證腳本包含以下代表性情景：TQQQ 約 USD70、每注約 HK$50,000；MU 約 USD900、低股數；港股 HK$50,000 普通正股。它確認高價低股數的毛利不足時會被拒絕，以及港股名義毛利在扣除富途及交易所成本後會按 HK$500 門檻判斷。

## 限制與定期校準

程式仍只能估計 spread 及滑點；市價單、急速行情、跳空、部分成交及流動性不足可令實際成本高於模型。每月應抽樣富途實際成交單，將「實際總交易成本 − 程式已知費用」除以雙邊成交名義金額，更新兩個 `*_ONE_WAY_SLIPPAGE_BPS` 變數。任何通過門檻的推薦都不是目標價必達或日利潤保證。

## 來源

富途香港官方美股收費：[US stock fees](https://www.futuhk.com/en/support/topic2_283)。

富途香港官方港股收費：[HK stock fees](https://www.futuhk.com/en/support/topic2_335)。
