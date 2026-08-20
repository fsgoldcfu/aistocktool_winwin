import assert from 'node:assert/strict';

process.env.TWELVE_DATA_API_KEY = 'test-key';
process.env.TWELVE_DATA_MIN_INTERVAL_MS = '0';
delete process.env.TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW;
process.env.TWELVE_DATA_429_COOLDOWN_MS = '60000';

const originalFetch = global.fetch;
let twelveDataCalls = 0;

function dailyValues() {
  return Array.from({ length: 30 }, (_, index) => {
    const close = 100 + index;
    const date = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
    return { datetime: date, open: String(close - 0.5), high: String(close + 1), low: String(close - 1), close: String(close), volume: '1000000' };
  });
}

global.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (!url.includes('api.twelvedata.com/time_series')) throw new Error(`unexpected URL ${url}`);
  twelveDataCalls += 1;
  return new Response(JSON.stringify({ values: dailyValues() }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

async function main() {
  try {
    const { yfinanceData } = await import('../lib/yfinanceData');
    const first = await yfinanceData.fetchHistoricalDataWithMeta('AAA', '3mo');
    const repeated = await yfinanceData.fetchHistoricalDataWithMeta('AAA', '3mo');
    const remainingPool = await Promise.all(
      Array.from({ length: 43 }, (_, index) => yfinanceData.fetchHistoricalDataWithMeta(`POOL${index}`, '3mo')),
    );

    assert.equal(first.source, 'network', 'first uncached symbol must use one network request');
    assert.equal(repeated.source, 'fresh-cache', 'same symbol must use the 15-minute history cache');
    assert.ok(remainingPool.every((result) => result.source === 'network'), 'default request budget must cover all 44 fixed-pool symbols');
    assert.equal(twelveDataCalls, 44, '44 unique symbols must consume exactly 44 provider calls');

    const healthAfterPool = yfinanceData.getTwelveDataHistoryHealth();
    assert.equal(healthAfterPool.windowRequestBudget, 48, 'default budget must leave headroom above the 44-stock pool');
    assert.equal(healthAfterPool.windowRequestsUsed, 44, 'health must expose the full fixed-pool request count');

    await Promise.all(Array.from({ length: 4 }, (_, index) => yfinanceData.fetchHistoricalDataWithMeta(`HEADROOM${index}`, '3mo')));
    const overBudget = await yfinanceData.fetchHistoricalDataWithMeta('OVER_BUDGET', '3mo');
    assert.equal(overBudget.source, 'budget-exhausted', 'provider protection must still block the 49th uncached request');
    assert.equal(twelveDataCalls, 48, 'budget-exhausted request must not call the provider');
    console.log('US history cache verification passed');
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
