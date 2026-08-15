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

export interface TradeabilityScoreInput {
  volumeRatio: number;
  relativeStrength: number;
  atrPercent: number;
  riskRewardRatio: number;
  isCounterTrend?: boolean;
}

export interface TradeabilityScoreResult {
  score: number;
  passed: boolean;
  threshold: number;
  components: {
    liquidity: number;
    relativeStrength: number;
    volatility: number;
    rewardRisk: number;
    context: number;
  };
  reason: string;
}

/**
 * 評估「今日是否值得交易」，不是預測股價方向，也不是勝率。
 * Score 只使用掃描當刻已有的成交活躍度、相對強度、可交易波幅及風險回報資料。
 */
export function calculateTradeabilityScore(
  input: TradeabilityScoreInput,
  threshold = 60,
): TradeabilityScoreResult {
  const volumeRatio = Number.isFinite(input.volumeRatio) ? input.volumeRatio : 0;
  const relativeStrength = Number.isFinite(input.relativeStrength) ? input.relativeStrength : -Infinity;
  const atrPercent = Number.isFinite(input.atrPercent) ? input.atrPercent : 0;
  const riskRewardRatio = Number.isFinite(input.riskRewardRatio) ? input.riskRewardRatio : 0;

  const liquidity = volumeRatio >= 2 ? 30 : volumeRatio >= 1.5 ? 24 : volumeRatio >= 1.2 ? 16 : volumeRatio >= 1 ? 8 : 0;
  const relativeStrengthScore = relativeStrength >= 0.02 ? 25 : relativeStrength >= 0.01 ? 18 : relativeStrength > 0 ? 10 : 0;
  const volatility = atrPercent >= 1 && atrPercent <= 4.5 ? 20 : atrPercent >= 0.75 && atrPercent <= 5 ? 12 : 0;
  const rewardRisk = riskRewardRatio >= 3 ? 20 : riskRewardRatio >= 2 ? 15 : riskRewardRatio >= 1.5 ? 10 : 0;
  const context = input.isCounterTrend ? 5 : 0;
  const score = liquidity + relativeStrengthScore + volatility + rewardRisk + context;
  const passed = score >= threshold;

  const reasons = [
    `成交活躍度 ${volumeRatio.toFixed(2)}x=${liquidity}/30`,
    `相對強度 ${(relativeStrength * 100).toFixed(2)}%=${relativeStrengthScore}/25`,
    `ATR ${atrPercent.toFixed(2)}%=${volatility}/20`,
    `回報風險 ${riskRewardRatio.toFixed(2)}R=${rewardRisk}/20`,
  ];
  if (input.isCounterTrend) reasons.push(`逆市相對強勢=${context}/5`);

  return {
    score,
    passed,
    threshold,
    components: { liquidity, relativeStrength: relativeStrengthScore, volatility, rewardRisk, context },
    reason: `${passed ? '通過' : '未通過'} Tradeability Score ${score}/${threshold}（${reasons.join('；')}）`,
  };
}

export interface NetProfitEligibilityInput {
  entryPrice: number;
  targetPrice: number;
  shares: number;
  oneWayCostBps: number;
  fxToHKD?: number;
  minimumNetProfitHKD: number;
}

export interface NetProfitEligibilityResult {
  feasible: boolean;
  grossProfitLocal: number;
  estimatedCostsLocal: number;
  estimatedNetProfitLocal: number;
  estimatedGrossProfitHKD: number;
  estimatedCostsHKD: number;
  estimatedNetProfitHKD: number;
  minimumNetProfitHKD: number;
  reason: string;
}

/**
 * 以入場及結構目標計算「估計成本後」淨盈利資格。
 * 這是推薦的硬性門檻，不預測目標一定會被觸及；成本 bps 必須按實際 broker、spread 與滑點校準。
 */
export function evaluateNetProfitEligibility(input: NetProfitEligibilityInput): NetProfitEligibilityResult {
  const fxToHKD = input.fxToHKD ?? 1;
  const entryPrice = Number(input.entryPrice);
  const targetPrice = Number(input.targetPrice);
  const shares = Math.floor(Number(input.shares));
  const oneWayCostBps = Number(input.oneWayCostBps);
  const minimumNetProfitHKD = Number(input.minimumNetProfitHKD);

  if (
    !Number.isFinite(entryPrice) || entryPrice <= 0 ||
    !Number.isFinite(targetPrice) || targetPrice <= entryPrice ||
    !Number.isFinite(shares) || shares <= 0 ||
    !Number.isFinite(oneWayCostBps) || oneWayCostBps < 0 ||
    !Number.isFinite(fxToHKD) || fxToHKD <= 0 ||
    !Number.isFinite(minimumNetProfitHKD) || minimumNetProfitHKD <= 0
  ) {
    return {
      feasible: false,
      grossProfitLocal: 0,
      estimatedCostsLocal: 0,
      estimatedNetProfitLocal: 0,
      estimatedGrossProfitHKD: 0,
      estimatedCostsHKD: 0,
      estimatedNetProfitHKD: 0,
      minimumNetProfitHKD: Number.isFinite(minimumNetProfitHKD) ? minimumNetProfitHKD : 0,
      reason: '入場價、結構目標、可交易股數、成本假設或淨盈利門檻無效。',
    };
  }

  const grossProfitLocal = (targetPrice - entryPrice) * shares;
  // 每邊成本以各邊成交名義金額估算，避免只扣買入或只扣賣出成本。
  const estimatedCostsLocal = (entryPrice + targetPrice) * shares * (oneWayCostBps / 10_000);
  const estimatedNetProfitLocal = grossProfitLocal - estimatedCostsLocal;
  const estimatedGrossProfitHKD = grossProfitLocal * fxToHKD;
  const estimatedCostsHKD = estimatedCostsLocal * fxToHKD;
  const estimatedNetProfitHKD = estimatedNetProfitLocal * fxToHKD;
  const feasible = estimatedNetProfitHKD >= minimumNetProfitHKD;

  return {
    feasible,
    grossProfitLocal,
    estimatedCostsLocal,
    estimatedNetProfitLocal,
    estimatedGrossProfitHKD,
    estimatedCostsHKD,
    estimatedNetProfitHKD,
    minimumNetProfitHKD,
    reason: feasible
      ? `結構目標的估計成本後淨盈利 HK$${estimatedNetProfitHKD.toFixed(0)}，達到 HK$${minimumNetProfitHKD.toFixed(0)} 推薦門檻。`
      : `結構目標的估計成本後淨盈利只有 HK$${estimatedNetProfitHKD.toFixed(0)}，低於 HK$${minimumNetProfitHKD.toFixed(0)} 推薦門檻。`,
  };
}
