import assert from 'node:assert/strict';
import { getTodayPicksMarket } from '../lib/todayPicks';

const date = (iso: string) => new Date(iso);
assert.equal(getTodayPicksMarket(date('2026-08-17T02:00:00Z')), 'HK'); // HKT 10:00
assert.equal(getTodayPicksMarket(date('2026-08-17T05:00:00Z')), 'HK'); // HKT 13:00
assert.equal(getTodayPicksMarket(date('2026-08-17T14:00:00Z')), 'US'); // NY 10:00 during EDT
assert.equal(getTodayPicksMarket(date('2026-08-15T03:00:00Z')), 'CLOSED'); // Saturday HKT
console.log('today picks verification passed');
