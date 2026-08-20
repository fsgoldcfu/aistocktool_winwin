import { strict as assert } from 'node:assert';
import { assessCatalyst } from '../lib/catalystAnalysis';

const now = new Date('2026-08-15T12:00:00Z');

const positive = assessCatalyst({
  now,
  headlines: [{
    title: 'Example Corp raises full-year guidance after revenue beats estimates',
    url: 'https://example.test/article',
    datetime: Math.floor(new Date('2026-08-15T08:00:00Z').getTime() / 1000),
  }],
});
assert.equal(positive.status, 'verified-positive');
assert.equal(positive.blockTrade, false);
assert.ok(positive.scoreAdjustment > 0);
assert.equal(positive.primaryUrl, 'https://example.test/article');

const earningsRisk = assessCatalyst({
  now,
  headlines: [],
  upcomingEarnings: { date: '2026-08-16', hour: 'am' },
});
assert.equal(earningsRisk.status, 'event-risk');
assert.equal(earningsRisk.blockTrade, true);

const neutral = assessCatalyst({
  now,
  headlines: [{ title: 'Example Corp participates in an industry conference', datetime: Math.floor(now.getTime() / 1000) }],
  upcomingEarnings: { date: '2026-08-21', hour: 'pm' },
});
assert.equal(neutral.status, 'neutral');
assert.equal(neutral.blockTrade, false);
assert.equal(neutral.scoreAdjustment, 0);
assert.ok(neutral.evidence.some((item) => item.includes('業績窗口')));

console.log('Catalyst analysis verification passed');
