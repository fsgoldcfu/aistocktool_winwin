import assert from 'node:assert/strict';
import { buildCapitalPlan, resolveCapitalSettings } from '../lib/capitalSettings';

const plan = buildCapitalPlan({ totalCapitalHKD: 100000, dailyAllocationPercent: 50, maxOpenPositions: 2 });
assert.equal(plan.dailyCapitalHKD, 50000, 'daily capital must equal principal times allocation percentage');
assert.equal(plan.capitalPerPositionHKD, 25000, 'per-position capital must divide daily capital by max positions');

assert.throws(() => resolveCapitalSettings({ totalCapitalHKD: 0 }), /本金/);
assert.throws(() => resolveCapitalSettings({ totalCapitalHKD: 100000, dailyAllocationPercent: 101 }), /每日投入比例/);
assert.throws(() => resolveCapitalSettings({ totalCapitalHKD: 100000, dailyAllocationPercent: 50, maxOpenPositions: 6 }), /最多同時持倉數/);

console.log('capital settings verification passed');
