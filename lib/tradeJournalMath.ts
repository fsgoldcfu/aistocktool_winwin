export interface TradeOutcomeInput {
  market: 'US' | 'HK';
  plannedEntry: number;
  plannedStop: number;
  actualEntry: number;
  actualExit: number;
  shares: number;
  buyCostHKD: number;
  sellCostHKD: number;
  fxToHKD: number;
}

export interface TradeOutcome {
  grossPnlHKD: number;
  netPnlHKD: number;
  plannedRiskHKD: number;
  rMultiple: number | null;
}

/**
 * Calculates outcome from user-supplied executed prices and actual broker costs.
 * US price P/L is converted with the recorded USD/HKD rate; HK prices use 1.0.
 */
export function calculateTradeOutcome(input: TradeOutcomeInput): TradeOutcome {
  const priceFx = input.market === 'US' ? input.fxToHKD : 1;
  const grossPnlHKD = (input.actualExit - input.actualEntry) * input.shares * priceFx;
  const netPnlHKD = grossPnlHKD - input.buyCostHKD - input.sellCostHKD;
  const plannedRiskHKD = Math.abs(input.plannedEntry - input.plannedStop) * input.shares * priceFx;
  return {
    grossPnlHKD,
    netPnlHKD,
    plannedRiskHKD,
    rMultiple: plannedRiskHKD > 0 ? netPnlHKD / plannedRiskHKD : null,
  };
}
