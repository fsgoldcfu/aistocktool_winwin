export interface CapitalSettingsInput {
  totalCapitalHKD?: number;
  dailyAllocationPercent?: number;
  maxOpenPositions?: number;
}

export interface CapitalSettings {
  totalCapitalHKD: number;
  dailyAllocationPercent: number;
  maxOpenPositions: number;
}

export interface CapitalPlan extends CapitalSettings {
  dailyCapitalHKD: number;
  capitalPerPositionHKD: number;
  validationWarnings: string[];
}

export const DEFAULT_CAPITAL_SETTINGS: CapitalSettings = {
  totalCapitalHKD: Number(process.env.DEFAULT_TOTAL_CAPITAL_HKD ?? 180000),
  dailyAllocationPercent: Number(process.env.DEFAULT_DAILY_ALLOCATION_PERCENT ?? 55.5556),
  maxOpenPositions: Number(process.env.DEFAULT_MAX_OPEN_POSITIONS ?? 2),
};

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function resolveCapitalSettings(input?: CapitalSettingsInput): CapitalSettings {
  const candidate = {
    totalCapitalHKD: Number(input?.totalCapitalHKD ?? DEFAULT_CAPITAL_SETTINGS.totalCapitalHKD),
    dailyAllocationPercent: Number(input?.dailyAllocationPercent ?? DEFAULT_CAPITAL_SETTINGS.dailyAllocationPercent),
    maxOpenPositions: Math.floor(Number(input?.maxOpenPositions ?? DEFAULT_CAPITAL_SETTINGS.maxOpenPositions)),
  };

  if (!finitePositive(candidate.totalCapitalHKD)) throw new Error('本金必須是大於 0 的數字。');
  if (!finitePositive(candidate.dailyAllocationPercent) || candidate.dailyAllocationPercent > 100) {
    throw new Error('每日投入比例必須介乎 0.01 至 100%。');
  }
  if (!Number.isInteger(candidate.maxOpenPositions) || candidate.maxOpenPositions < 1 || candidate.maxOpenPositions > 5) {
    throw new Error('最多同時持倉數必須是 1 至 5。');
  }
  return candidate;
}

export function buildCapitalPlan(input?: CapitalSettingsInput): CapitalPlan {
  const settings = resolveCapitalSettings(input);
  const dailyCapitalHKD = settings.totalCapitalHKD * settings.dailyAllocationPercent / 100;
  const capitalPerPositionHKD = dailyCapitalHKD / settings.maxOpenPositions;
  const validationWarnings: string[] = [];
  if (capitalPerPositionHKD < 1000) validationWarnings.push('每筆配置低於 HK$1,000，較多股票可能無法同時達到 HK$500 成本後盈利門檻。');
  if (settings.dailyAllocationPercent > 80) validationWarnings.push('每日投入比例高於 80%，未保留足夠現金緩衝。');
  return { ...settings, dailyCapitalHKD, capitalPerPositionHKD, validationWarnings };
}

export interface UsCapitalFeasibilityInput {
  entryPrice: number;
  targetPrice: number;
  fxToHKD: number;
  capitalPlan: CapitalPlan;
  minimumNetProfitHKD: number;
  oneWayCostBps?: number;
}

export interface UsCapitalFeasibility {
  feasible: boolean;
  shares: number;
  capitalAllocatedHKD: number;
  estimatedCostsHKD: number;
  estimatedNetProfitHKD: number;
  minimumNetProfitHKD: number;
  reason: string;
}

/**
 * Self-contained ETF sizing gate. It deliberately has no dependency on the
 * short-term scanner so index routes remain compatible with older deployments.
 */
export function estimateUsCapitalFeasibility(input: UsCapitalFeasibilityInput): UsCapitalFeasibility {
  const { entryPrice, targetPrice, fxToHKD, capitalPlan, minimumNetProfitHKD } = input;
  const oneWayCostBps = input.oneWayCostBps ?? 5;
  const shares = Number.isFinite(entryPrice) && entryPrice > 0 && Number.isFinite(fxToHKD) && fxToHKD > 0
    ? Math.floor((capitalPlan.capitalPerPositionHKD / fxToHKD) / entryPrice)
    : 0;
  const capitalAllocatedHKD = shares * entryPrice * fxToHKD;
  const grossProfitHKD = Math.max(0, targetPrice - entryPrice) * shares * fxToHKD;
  const estimatedCostsHKD = (entryPrice + targetPrice) * shares * (oneWayCostBps / 10000) * fxToHKD;
  const estimatedNetProfitHKD = grossProfitHKD - estimatedCostsHKD;
  const feasible = shares >= 1 && Number.isFinite(estimatedNetProfitHKD) && estimatedNetProfitHKD >= minimumNetProfitHKD;
  return {
    feasible,
    shares,
    capitalAllocatedHKD,
    estimatedCostsHKD,
    estimatedNetProfitHKD,
    minimumNetProfitHKD,
    reason: shares < 1
      ? '每筆配置不足以買入 1 股。'
      : feasible
        ? `按每筆 HK$${capitalPlan.capitalPerPositionHKD.toFixed(0)} 配置，成本後估算 HK$${estimatedNetProfitHKD.toFixed(0)}，達到 HK$${minimumNetProfitHKD.toFixed(0)} 門檻。`
        : `按每筆 HK$${capitalPlan.capitalPerPositionHKD.toFixed(0)} 配置，成本後估算只有 HK$${estimatedNetProfitHKD.toFixed(0)}，低於 HK$${minimumNetProfitHKD.toFixed(0)} 門檻。`,
  };
}
