import assert from 'node:assert/strict';

process.env.TWELVE_DATA_API_KEY = 'test-key';
process.env.TWELVE_DATA_MIN_INTERVAL_MS = '0';
process.env.TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW = '8';
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
    assert.ok(remainingPool.every((result) => result.source === 'network'), 'an obsolete 8-request environment value must not block the 44-stock fixed pool');
    assert.equal(twelveDataCalls, 44, '44 unique symbols must consume exactly 44 provider calls');

    yfinanceData.hydratePersistentHistory('PERSIST', dailyValues().map((value) => ({
      date: value.datetime,
      open: Number(value.open),
      high: Number(value.high),
      low: Number(value.low),
      close: Number(value.close),
      volume: Number(value.volume),
    })), '3mo');
    const persistent = await yfinanceData.fetchHistoricalDataWithMeta('PERSIST', '3mo');
    assert.equal(persistent.source, 'persistent-cache', 'hydrated Supabase daily history must be identifiable and must not call Twelve Data');
    assert.equal(twelveDataCalls, 44, 'hydrating persistent history must not consume provider credit');

    const healthAfterPool = yfinanceData.getTwelveDataHistoryHealth();
    assert.equal(healthAfterPool.windowRequestBudget, 48, 'the 8-request environment value must be raised to the safe 48-request budget');
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
