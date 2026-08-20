import assert from 'node:assert/strict';
import { analyzeSymbol, fetchStaticIndexHistory, WATCHLIST, type DailyBar } from '../lib/indexAnalysis';

function makeBars(): DailyBar[] {
  return Array.from({ length: 280 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
    // Deterministic upward daily series with periodic controlled pullbacks.
    const close = 40 + index * 0.22 - (index % 37 === 0 ? 1.5 : 0);
    return {
      date,
      open: close - 0.15,
      high: close + 0.55,
      low: close - 0.65,
      close,
      volume: 1_000_000 + index * 1_000,
    };
  });
}

const bars = makeBars();
const analysis = analyzeSymbol([...bars].reverse(), {
  symbol: 'TQQQ',
  direction: 'long',
  livePrice: bars[bars.length - 1].close + 0.1,
  priceSource: 'twelve_data_price',
  priceTimestamp: '2025-01-01T00:00:00.000Z',
  analysisAsOf: '2025-01-01T00:00:00.000Z',
});

assert.equal(WATCHLIST.map((item) => item.symbol).join(','), 'TQQQ,VOO,SPY,SSO', 'index watchlist must contain all four ETFs');
for (const item of WATCHLIST) {
  const staticBars = fetchStaticIndexHistory(item.symbol);
  assert.ok(staticBars.length >= 210, `${item.symbol} static history must satisfy the daily strategy minimum`);
  assert.match(staticBars[staticBars.length - 1].date, /^\d{4}-\d{2}-\d{2}$/, `${item.symbol} static history must retain ISO dates`);
}
assert.equal(analysis.symbol, 'TQQQ', 'symbol must be preserved in analysis output');
assert.equal(analysis.latestDate, bars[bars.length - 1].date, 'input bars must be normalized in date order');
assert.equal(analysis.data.signalUsesCompletedDailyBar, true, 'signals must declare completed-bar use');
assert.equal(analysis.data.priceSource, 'twelve_data_price', 'price source must be preserved');
assert.ok(analysis.strategyBacktest.inSample.trades >= 0, 'backtest must return a trade count');
assert.ok(analysis.strategyBacktest.outOfSample.trades >= 0, 'OOS backtest must return a trade count');

if (analysis.recommendation.status === 'TRADEABLE') {
  assert.ok(analysis.recommendation.tradePlan, 'TRADEABLE status requires a complete trade plan');
  assert.ok(
    (analysis.recommendation.tradePlan?.initialStop ?? Infinity) < (analysis.recommendation.tradePlan?.entry ?? -Infinity),
    'long trade stop must sit below entry'
  );
} else {
  assert.equal(analysis.recommendation.tradePlan, null, 'WATCH / NO_TRADE must never expose an order-ready plan');
}

const invalidBars = makeBars();
invalidBars[10] = { ...invalidBars[10], high: invalidBars[10].close - 1 };
assert.throws(
  () => analyzeSymbol(invalidBars, { direction: 'long' }),
  /OHLC 邏輯無效/,
  'invalid OHLC data must fail closed'
);

console.log('indexAnalysis verification passed');
