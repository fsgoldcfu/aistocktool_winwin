import { strict as assert } from 'node:assert';
import { calculateTradeOutcome } from '../lib/tradeJournalMath';

const usOutcome = calculateTradeOutcome({
  market: 'US',
  plannedEntry: 70,
  plannedStop: 68,
  actualEntry: 70,
  actualExit: 72,
  shares: 90,
  buyCostHKD: 25,
  sellCostHKD: 25,
  fxToHKD: 7.8,
});
assert.equal(usOutcome.grossPnlHKD, 1404);
assert.equal(usOutcome.netPnlHKD, 1354);
assert.equal(usOutcome.plannedRiskHKD, 1404);
assert.ok(Math.abs((usOutcome.rMultiple || 0) - (1354 / 1404)) < 1e-10);

const hkOutcome = calculateTradeOutcome({
  market: 'HK',
  plannedEntry: 100,
  plannedStop: 97,
  actualEntry: 100,
  actualExit: 102,
  shares: 500,
  buyCostHKD: 70,
  sellCostHKD: 72,
  fxToHKD: 7.8,
});
assert.equal(hkOutcome.grossPnlHKD, 1000);
assert.equal(hkOutcome.netPnlHKD, 858);
assert.equal(hkOutcome.plannedRiskHKD, 1500);
assert.ok(Math.abs((hkOutcome.rMultiple || 0) - 0.572) < 0.001);

console.log('Trade journal verification passed');
