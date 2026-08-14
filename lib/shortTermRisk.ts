export interface PriceCandle {
  high: number;
  low: number;
}

export interface LongRiskPlan {
  entryPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  resistanceLevel: number;
  resistanceSource: string;
  riskRewardRatio: number;
  maxHoldingMinutes: number;
  entryRule: string;
  invalidation: string;
}

export interface RiskPlanResult {
  plan: LongRiskPlan | null;
  reason: string | null;
}

function roundToTick(value: number, tickSize: number, direction: 'up' | 'down'): number {
  if (!Number.isFinite(value) || !Number.isFinite(tickSize) || tickSize <= 0) return value;
  const ticks = value / tickSize;
  const roundedTicks = direction === 'up' ? Math.ceil(ticks - 1e-9) : Math.floor(ticks + 1e-9);
  return Number((roundedTicks * tickSize).toFixed(6));
}

/**
 * 以報價為 entry reference，先設定初始風險，再只接受足以提供最低 R 倍數的近期結構阻力。
 * 這刻意不以任意 ATR target 取代不存在的阻力，令「沒有合格交易」成為合法輸出。
 */
export function buildLongIntradayRiskPlan(params: {
  currentPrice: number;
  atr: number;
  candles: PriceCandle[];
  tickSize: number;
  maxStopLossPercent: number;
  minimumRewardRisk: number;
  maxHoldingMinutes: number;
  resistanceLookback?: number;
}): RiskPlanResult {
  const {
    currentPrice,
    atr,
    candles,
    tickSize,
    maxStopLossPercent,
    minimumRewardRisk,
    maxHoldingMinutes,
    resistanceLookback = 10,
  } = params;

  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(atr) || atr <= 0) {
    return { plan: null, reason: '報價或 ATR 無效，不能計算初始風險。' };
  }
  if (candles.length < 3) {
    return { plan: null, reason: '完成日線不足，不能確認結構阻力。' };
  }

  const rawStopDistance = Math.max(atr * 0.7, currentPrice * 0.015);
  const maxStopDistance = currentPrice * maxStopLossPercent;
  if (rawStopDistance > maxStopDistance) {
    return {
      plan: null,
      reason: `以 ATR 計的止蝕距離為 ${(rawStopDistance / currentPrice * 100).toFixed(2)}%，超過 ${(
        maxStopLossPercent * 100
      ).toFixed(2)}% 風險上限。`,
    };
  }

  const entryPrice = roundToTick(currentPrice, tickSize, 'up');
  const stopLossPrice = roundToTick(entryPrice - rawStopDistance, tickSize, 'down');
  const riskPerShare = entryPrice - stopLossPrice;
  if (riskPerShare <= 0) {
    return { plan: null, reason: '止蝕價無效，不能建立交易計劃。' };
  }

  const minimumTarget = entryPrice + riskPerShare * minimumRewardRisk;
  const recentHighs = candles
    .slice(-resistanceLookback)
    .map((candle, index) => ({ level: candle.high, index }))
    .filter((candidate) => Number.isFinite(candidate.level) && candidate.level >= minimumTarget)
    .sort((a, b) => a.level - b.level);

  if (!recentHighs.length) {
    return {
      plan: null,
      reason: `最近 ${resistanceLookback} 個完成日線沒有可提供至少 ${minimumRewardRisk.toFixed(1)}R 的結構阻力，拒絕追入。`,
    };
  }

  const resistance = recentHighs[0];
  const takeProfitPrice = roundToTick(resistance.level, tickSize, 'down');
  const riskRewardRatio = (takeProfitPrice - entryPrice) / riskPerShare;
  if (riskRewardRatio < minimumRewardRisk) {
    return { plan: null, reason: '按實際 tick size 取整後，回報風險比不足。' };
  }

  return {
    plan: {
      entryPrice,
      takeProfitPrice,
      stopLossPrice,
      resistanceLevel: takeProfitPrice,
      resistanceSource: `最近 ${resistanceLookback} 日結構高位`,
      riskRewardRatio: Number(riskRewardRatio.toFixed(2)),
      maxHoldingMinutes,
      entryRule: `只在價格維持於入場參考 $${entryPrice.toFixed(2)} 或以上時考慮；若跌穿止蝕前已失去相對強度，取消交易。`,
      invalidation: `價格跌至 $${stopLossPrice.toFixed(2)} 或持有超過 ${maxHoldingMinutes} 分鐘即退出；跳空時按可得價格處理。`,
    },
    reason: null,
  };
}
