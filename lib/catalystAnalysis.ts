export interface HeadlineEvidence {
  title: string;
  url?: string;
  datetime?: number;
  source?: string;
}

export interface EarningsEvidence {
  date: string;
  hour?: string;
  epsActual?: number | null;
  epsEstimate?: number | null;
  revenueActual?: number | null;
  revenueEstimate?: number | null;
}

export type CatalystStatus = 'verified-positive' | 'neutral' | 'event-risk' | 'unavailable';

export interface CatalystAssessment {
  status: CatalystStatus;
  scoreAdjustment: number;
  blockTrade: boolean;
  summary: string;
  evidence: string[];
  primaryHeadline?: string;
  primaryUrl?: string;
  upcomingEarningsDate?: string;
}

const POSITIVE_HEADLINE_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: '業績優於市場預期', pattern: /(?:earnings|eps|revenue|sales).{0,45}(?:beat|beats|above estimates)|(?:beat|beats).{0,45}(?:earnings|eps|revenue|sales)/i },
  { label: '上調指引', pattern: /(?:raise[sd]?|raising|boost(?:ed|s)?|increas(?:e[sd]?|ing)).{0,45}(?:guidance|outlook|forecast)|(?:guidance|outlook).{0,45}(?:raise[sd]?|boost(?:ed|s)?|increas(?:e[sd]?|ing))/i },
  { label: '股份回購或資本回報', pattern: /(?:share )?(?:buyback|repurchase)|capital return/i },
  { label: '重大合約、訂單或合作', pattern: /(?:wins?|won|secures?|secured|lands?|landed).{0,50}(?:contract|deal|order)|(?:partnership|strategic alliance)/i },
  { label: '監管批准或重要里程碑', pattern: /(?:fda|regulator|regulatory).{0,45}(?:approv|clearance)|(?:approval|clearance).{0,45}(?:fda|regulator|regulatory)/i },
];

const NEGATIVE_HEADLINE_PATTERN = /(?:miss(?:es|ed)?\s|cuts?|cutting|lowers?|lowered|withdraws?|withdrawn|probe|investigation|lawsuit|recall|offering|dilution|secondary sale|guidance.{0,30}(?:down|lower|cut))/i;

function parseDateToUtcStart(dateValue: string): number | null {
  const parsed = Date.parse(`${dateValue}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysUntil(dateValue: string, now: Date): number | null {
  const target = parseDateToUtcStart(dateValue);
  if (target === null) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/**
 * 事件資料只作可追溯佐證：未公布業績是風險，絕不當成「預期會好」的利好。
 * 只有已公布、實際 EPS 或收入高於估算的資料才會被標為正面業績催化。
 */
export function assessCatalyst(params: {
  headlines: HeadlineEvidence[];
  upcomingEarnings?: EarningsEvidence | null;
  recentEarnings?: EarningsEvidence | null;
  now?: Date;
}): CatalystAssessment {
  const now = params.now ?? new Date();
  const freshHeadlines = params.headlines
    .filter((item) => typeof item.title === 'string' && item.title.trim().length > 0)
    .filter((item) => !item.datetime || now.getTime() - item.datetime * 1000 <= 48 * 60 * 60 * 1000);

  const upcomingDays = params.upcomingEarnings?.date ? daysUntil(params.upcomingEarnings.date, now) : null;
  if (upcomingDays !== null && upcomingDays >= 0 && upcomingDays <= 1) {
    return {
      status: 'event-risk',
      scoreAdjustment: 0,
      blockTrade: true,
      summary: `業績公布在 ${upcomingDays === 0 ? '今日' : '明日'}；避免以短線推介承擔隔夜業績跳空風險。`,
      evidence: [`業績日：${params.upcomingEarnings?.date}${params.upcomingEarnings?.hour ? `（${params.upcomingEarnings.hour}）` : ''}`],
      upcomingEarningsDate: params.upcomingEarnings?.date,
    };
  }

  const evidence: string[] = [];
  let scoreAdjustment = 0;
  let primaryHeadline: HeadlineEvidence | undefined;

  const recentBeat = params.recentEarnings &&
    params.recentEarnings.epsActual !== null && params.recentEarnings.epsActual !== undefined &&
    params.recentEarnings.epsEstimate !== null && params.recentEarnings.epsEstimate !== undefined &&
    params.recentEarnings.epsActual > params.recentEarnings.epsEstimate;
  if (recentBeat) {
    evidence.push(`最近已公布業績 EPS 實際 ${params.recentEarnings?.epsActual} 高於預估 ${params.recentEarnings?.epsEstimate}。`);
    scoreAdjustment += 3;
  }

  for (const headline of freshHeadlines) {
    if (NEGATIVE_HEADLINE_PATTERN.test(headline.title)) {
      evidence.push(`負面／不確定新聞：${headline.title}`);
      continue;
    }
    const matched = POSITIVE_HEADLINE_RULES.find((rule) => rule.pattern.test(headline.title));
    if (matched) {
      primaryHeadline ??= headline;
      evidence.push(`${matched.label}：${headline.title}`);
      scoreAdjustment += 3;
      break;
    }
  }

  if (upcomingDays !== null && upcomingDays >= 2 && upcomingDays <= 7) {
    evidence.push(`業績窗口將在 ${upcomingDays} 日後（${params.upcomingEarnings?.date}）；這是事件風險提示，不作正面加分。`);
  }

  scoreAdjustment = Math.min(scoreAdjustment, 6);
  const hasPositiveEvidence = scoreAdjustment > 0;
  return {
    status: hasPositiveEvidence ? 'verified-positive' : 'neutral',
    scoreAdjustment,
    blockTrade: false,
    summary: hasPositiveEvidence
      ? '有可追溯的近期正面催化，但仍需由價格、成交量、風險計劃及成本後淨盈利共同確認。'
      : '未取得可驗證的正面催化；技術與風險條件仍可獨立決定是否合格。',
    evidence: evidence.length ? evidence : ['未有符合規則的近期可追溯催化新聞或已公布業績 surprise。'],
    primaryHeadline: primaryHeadline?.title,
    primaryUrl: primaryHeadline?.url,
    upcomingEarningsDate: params.upcomingEarnings?.date,
  };
}
