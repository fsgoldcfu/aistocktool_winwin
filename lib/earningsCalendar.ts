/**
 * lib/earningsCalendar.ts
 *
 * 業績日期查詢層，使用 Finnhub /calendar/earnings endpoint
 * Finnhub 免費版已包含，唔需要額外申請。
 *
 * 主要功能：
 * 1. 查詢未來 N 日內即將出業績嘅股票
 * 2. 查詢某隻股票嘅歷史業績 Surprise（實際 vs 預期 EPS）
 * 3. 判斷某隻股票係咪「業績前低吸」機會
 */

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || "";

// Cache：業績日曆每小時更新一次就夠
const earningsCache = new Map<string, { data: any; timestamp: number }>();
const EARNINGS_CACHE_TTL_MS = 60 * 60 * 1000; // 1小時

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EarningsEvent {
  symbol: string;
  date: string;           // "2024-08-28"
  epsEstimate: number;    // 預期 EPS
  epsActual?: number;     // 實際 EPS（出咗業績先有）
  surprise?: number;      // 超預期百分比
  daysUntil: number;      // 距今幾日
}

export interface EarningsSurprise {
  symbol: string;
  period: string;         // "2024-03-31"
  actual: number;
  estimate: number;
  surprisePercent: number; // 正數=beat，負數=miss
}

/**
 * 攞未來 N 日內即將出業績嘅股票清單
 * 用法：await getUpcomingEarnings(10) → 未來10日有業績嘅股票
 */
export async function getUpcomingEarnings(daysAhead: number = 14): Promise<EarningsEvent[]> {
  const cacheKey = `upcoming_${daysAhead}`;
  const cached = earningsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EARNINGS_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const today = new Date();
    const future = new Date(today);
    future.setDate(future.getDate() + daysAhead);

    const fromStr = today.toISOString().split("T")[0];
    const toStr = future.toISOString().split("T")[0];

    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${fromStr}&to=${toStr}&token=${FINNHUB_KEY}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      console.error(`[Earnings] Finnhub HTTP ${response.status}`);
      return [];
    }

    const json = await response.json();
    const events: EarningsEvent[] = (json.earningsCalendar || []).map((e: any) => {
      const eventDate = new Date(e.date);
      const diffMs = eventDate.getTime() - today.getTime();
      const daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return {
        symbol: e.symbol,
        date: e.date,
        epsEstimate: Number(e.epsEstimate) || 0,
        daysUntil,
      };
    });

    earningsCache.set(cacheKey, { data: events, timestamp: Date.now() });
    console.log(`[Earnings] 未來${daysAhead}日有 ${events.length} 隻股票即將出業績`);
    return events;

  } catch (error) {
    console.error("[Earnings] getUpcomingEarnings error:", error);
    return [];
  }
}

/**
 * 攞某隻股票過去幾季嘅業績 Surprise 記錄
 * 用嚟判斷呢隻股票係咪「慣性 beat 預期」
 */
export async function getEarningsSurprises(symbol: string): Promise<EarningsSurprise[]> {
  const cacheKey = `surprise_${symbol}`;
  const cached = earningsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < EARNINGS_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const url = `https://finnhub.io/api/v1/stock/earnings?symbol=${symbol}&limit=4&token=${FINNHUB_KEY}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
      console.error(`[Earnings] Surprise HTTP ${response.status} for ${symbol}`);
      return [];
    }

    const json = await response.json();
    if (!Array.isArray(json)) return [];

    const surprises: EarningsSurprise[] = json.map((e: any) => {
      const actual = Number(e.actual) || 0;
      const estimate = Number(e.estimate) || 0;
      const surprisePercent = estimate !== 0 ? ((actual - estimate) / Math.abs(estimate)) * 100 : 0;
      return {
        symbol,
        period: e.period || "",
        actual,
        estimate,
        surprisePercent,
      };
    });

    earningsCache.set(cacheKey, { data: surprises, timestamp: Date.now() });
    return surprises;

  } catch (error) {
    console.error(`[Earnings] getSurprises error for ${symbol}:`, error);
    return [];
  }
}

/**
 * 判斷某隻股票係咪「業績前低吸」機會
 * 條件：
 * 1. 距離出業績 5-14 日（太近或太遠都唔算）
 * 2. 過去 3 季全部 beat 預期（surprisePercent > 0）
 * 3. 當前股價係近 20 日低位（未被炒起）
 */
export async function isEarningsOpportunity(
  symbol: string,
  currentPrice: number,
  twentyDayLow: number,
  upcomingEarnings: EarningsEvent[]
): Promise<{ isOpportunity: boolean; daysUntil: number; beatCount: number; reason: string }> {

  const earningsEvent = upcomingEarnings.find((e) => e.symbol === symbol);
  if (!earningsEvent) {
    return { isOpportunity: false, daysUntil: 0, beatCount: 0, reason: "未有即將出業績" };
  }

  const { daysUntil } = earningsEvent;
  if (daysUntil < 3 || daysUntil > 14) {
    return { isOpportunity: false, daysUntil, beatCount: 0, reason: `距業績 ${daysUntil} 日，唔係最佳窗口（3-14日）` };
  }

  const surprises = await getEarningsSurprises(symbol);
  if (surprises.length < 2) {
    return { isOpportunity: false, daysUntil, beatCount: 0, reason: "業績記錄不足" };
  }

  const beatCount = surprises.filter((s) => s.surprisePercent > 0).length;
  if (beatCount < 2) {
    return { isOpportunity: false, daysUntil, beatCount, reason: `近期業績僅 ${beatCount} 次 beat 預期，唔夠穩定` };
  }

  // 股價係咪近 20 日低位（偏低才值得買）
  const nearLow = currentPrice <= twentyDayLow * 1.05; // 係20日低位5%範圍內
  if (!nearLow) {
    return { isOpportunity: false, daysUntil, beatCount, reason: "股價未夠低，等回調先" };
  }

  return {
    isOpportunity: true,
    daysUntil,
    beatCount,
    reason: `距業績 ${daysUntil} 日，過去 ${beatCount}/4 季 beat 預期，股價近低位`,
  };
}
