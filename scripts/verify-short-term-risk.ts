import assert from 'node:assert/strict';
import { buildLongIntradayRiskPlan, calculateTradeabilityScore, evaluateFutuHkStockNetProfit, evaluateFutuUsStockNetProfit } from '../lib/shortTermRisk';

const qualifyingCandles = [
  { high: 100, low: 96 },
  { high: 102, low: 97 },
  { high: 105, low: 99 },
  { high: 107, low: 100 },
  { high: 110, low: 102 },
];

const planResult = buildLongIntradayRiskPlan({
  currentPrice: 100,
  atr: 2,
  candles: qualifyingCandles,
  tickSize: 0.01,
  maxStopLossPercent: 0.03,
  minimumRewardRisk: 1.5,
  maxHoldingMinutes: 90,
});

assert.ok(planResult.plan, 'a valid structural target should generate a plan');
assert.ok((planResult.plan?.stopLossPrice ?? Infinity) < (planResult.plan?.entryPrice ?? -Infinity), 'long stop must be below entry');
assert.ok((planResult.plan?.takeProfitPrice ?? -Infinity) > (planResult.plan?.entryPrice ?? Infinity), 'target must be above entry');
assert.ok((planResult.plan?.riskRewardRatio ?? 0) >= 1.5, 'plan must respect minimum reward/risk');
assert.equal(planResult.plan?.maxHoldingMinutes, 90, 'time stop must be retained');

const rejectedResult = buildLongIntradayRiskPlan({
  currentPrice: 100,
  atr: 2,
  candles: [{ high: 101, low: 98 }, { high: 102, low: 99 }, { high: 102.2, low: 99 }],
  tickSize: 0.01,
  maxStopLossPercent: 0.03,
  minimumRewardRisk: 1.5,
  maxHoldingMinutes: 90,
});
assert.equal(rejectedResult.plan, null, 'insufficient structural reward must fail closed');
assert.match(rejectedResult.reason || '', /結構阻力/, 'rejection must explain the risk-plan failure');

const stopTooWideResult = buildLongIntradayRiskPlan({
  currentPrice: 100,
  atr: 8,
  candles: qualifyingCandles,
  tickSize: 0.01,
  maxStopLossPercent: 0.03,
  minimumRewardRisk: 1.5,
  maxHoldingMinutes: 90,
});
assert.equal(stopTooWideResult.plan, null, 'ATR risk beyond configured cap must fail closed');

const passingScore = calculateTradeabilityScore({
  volumeRatio: 1.8,
  relativeStrength: 0.015,
  atrPercent: 2,
  riskRewardRatio: 2,
});
assert.equal(passingScore.passed, true, 'liquid, relatively strong, tradable volatility and 2R setup should pass');
assert.ok(passingScore.score >= passingScore.threshold, 'passing score must meet its configured threshold');

const rejectedScore = calculateTradeabilityScore({
  volumeRatio: 0.8,
  relativeStrength: 0.002,
  atrPercent: 0.4,
  riskRewardRatio: 1.2,
});
assert.equal(rejectedScore.passed, false, 'weak liquidity and insufficient R must fail closed');

const tqqqSizedAtHk50k = evaluateFutuUsStockNetProfit({
  entryPrice: 70,
  targetPrice: 72,
  shares: 91, // floor(HK$50,000 / 7.8 / US$70)
  oneWaySlippageBps: 5,
  fxToHKD: 7.8,
  minimumNetProfitHKD: 500,
});
assert.equal(tqqqSizedAtHk50k.feasible, true, 'TQQQ-sized position must clear HK$500 only after Futu fees and slippage');
assert.ok(tqqqSizedAtHk50k.costBreakdown.totalEstimatedCosts > 0, 'US model must include explicit Futu fees');

const highPricedMuRejected = evaluateFutuUsStockNetProfit({
  entryPrice: 900,
  targetPrice: 908,
  shares: 7, // floor(HK$50,000 / 7.8 / US$900)
  oneWaySlippageBps: 5,
  fxToHKD: 7.8,
  minimumNetProfitHKD: 500,
});
assert.equal(highPricedMuRejected.feasible, false, 'high-priced low-share position must not pass on gross profit alone');

const hk50kPassesAfterFutuFees = evaluateFutuHkStockNetProfit({
  entryPrice: 50,
  targetPrice: 52,
  shares: 1000,
  oneWaySlippageBps: 5,
  minimumNetProfitHKD: 500,
  commissionRate: 0,
  platformFeePerOrder: 15,
});
assert.equal(hk50kPassesAfterFutuFees.feasible, true, 'HK$50,000 HK stock position must include platform, stamp and exchange fees');
assert.ok(hk50kPassesAfterFutuFees.costBreakdown.totalEstimatedCosts > 140, 'HK model must include known Futu/HKEX costs before slippage');

const hk50kRejectedAfterFutuFees = evaluateFutuHkStockNetProfit({
  entryPrice: 50,
  targetPrice: 50.5,
  shares: 1000,
  oneWaySlippageBps: 5,
  minimumNetProfitHKD: 500,
  commissionRate: 0,
  platformFeePerOrder: 15,
});
assert.equal(hk50kRejectedAfterFutuFees.feasible, false, 'HK gross HK$500 must fail against the HK$500 gate after costs when actual known fees and slippage reduce net profit below target');

console.log('shortTermRisk verification passed');
