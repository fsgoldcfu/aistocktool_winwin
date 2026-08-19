import assert from 'node:assert/strict';

process.env.TWELVE_DATA_API_KEY = 'test-key';
process.env.TWELVE_DATA_MIN_INTERVAL_MS = '0';
process.env.TWELVE_DATA_MAX_HISTORY_REQUESTS_PER_WINDOW = '1';
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
    const overBudget = await yfinanceData.fetchHistoricalDataWithMeta('BBB', '3mo');

    assert.equal(first.source, 'network', 'first uncached symbol must use one network request');
    assert.equal(repeated.source, 'fresh-cache', 'same symbol must use the 15-minute history cache');
    assert.equal(twelveDataCalls, 1, 'repeated same-symbol request must not consume another provider call');
    assert.equal(overBudget.source, 'budget-exhausted', 'new symbol after request budget is reached must not call provider');
    assert.equal(yfinanceData.getTwelveDataHistoryHealth().windowRequestsUsed, 1, 'health must expose used request budget');
    console.log('US history cache verification passed');
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
