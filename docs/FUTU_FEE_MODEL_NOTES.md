# 富途成本模型依據

資料來源為富途香港官方收費頁面，讀取日期為 2026-08-15。

## 美股普通正股／ETF（Fixed plan）

富途官方列示：佣金為每股 USD0.0049、每單最低 USD0.99；平台費為每股 USD0.005、每單最低 USD1；結算費為每股 USD0.003。賣出時另有 SEC regulatory fee（成交金額 × 0.0000206，最低 USD0.01）、FINRA trading activity fee（每股 USD0.000195，最低 USD0.01，最高 USD9.79）及 CAT fee（NMS 每股 USD0.000003）。

模型因此應按 entry/target 價格與完整股數逐邊計算，不能以單一固定 bps 取代。另以環境變數保留可調滑點 bps。

來源：[FUTU HK — US stock fees](https://www.futuhk.com/en/support/topic2_283)

## 港股普通正股（commission-free period）

用戶的富途帳戶截圖顯示普通訂單佣金為免費、平台費為每單 HKD15。富途官方頁列示股份印花稅為每次成交金額 0.1%（按港元進位規則）、HKEX settlement fee 0.0042%、trading fee 0.00565%、SFC levy 0.0027%、FRC levy 0.00015%。正股每邊 HKD50,000 的已知費用約為 HKD142.70／雙邊，以後仍需加入可調 spread/slippage 緩衝。

來源：[FUTU HK — HK stock fees](https://www.futuhk.com/en/support/topic2_335)

## 設計限制

此模型估計成本後的結構目標盈利，不預測目標價必然觸及。用戶應以富途實際成交紀錄（尤其市價單、部分成交與 bid-ask spread）定期校準滑點假設。
