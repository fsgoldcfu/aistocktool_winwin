import assert from 'node:assert/strict';
import { selectQuoteFallbackSymbols, US_QUOTE_FALLBACK_DETAIL_LIMIT } from '../lib/usScannerV3_7';

const quotes = new Map([
  ['WEAK', { price: 10, change: -0.1, changePercent: -0.01 }],
  ['ALPHA', { price: 10, change: 0.5, changePercent: 0.05 }],
  ['BETA', { price: 10, change: 0.35, changePercent: 0.035 }],
  ['GAMMA', { price: 10, change: 0.2, changePercent: 0.02 }],
  ['DELTA', { price: 10, change: 0.1, changePercent: 0.01 }],
  ['EPSILON', { price: 10, change: 0.08, changePercent: 0.008 }],
  ['ZETA', { price: 10, change: 0.04, changePercent: 0.004 }],
  ['ETA', { price: 10, change: 0.02, changePercent: 0.002 }],
]);

const selected = selectQuoteFallbackSymbols(quotes, -0.005);
assert.equal(selected.length, US_QUOTE_FALLBACK_DETAIL_LIMIT, 'fallback must cap detailed history analysis at six symbols');
assert.deepEqual(selected, ['ALPHA', 'BETA', 'GAMMA', 'DELTA', 'EPSILON', 'ZETA'], 'fallback must prioritize relative strength before consuming Twelve Data credits');
assert.ok(!selected.includes('WEAK'), 'weaker quote must not displace stronger candidates');
console.log('US quote fallback verification passed');
