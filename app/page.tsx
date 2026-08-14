'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, type StockSignal, type Profile } from '@/lib/supabase';
import {
  TrendingUp, TrendingDown, LogOut, Crown, Zap, Clock,
  BarChart2, RefreshCw, Lock, ChevronRight, User,
  AlertTriangle, Star, Gem, Target, Calendar, Activity,
} from 'lucide-react';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || '玄金操盤手';
const MONTHLY_PRICE = process.env.NEXT_PUBLIC_MONTHLY_PRICE || '388';

type Market = 'US' | 'HK';
type Mode = 'shortterm' | 'midterm' | 'indices';

// ==================== 短炒 Signal ====================
const SIGNAL_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  buy: { label: '買入', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  sell: { label: '沽出', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  watch: { label: '觀察', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: '進行中', color: 'text-emerald-400' },
  closed: { label: '已完結', color: 'text-slate-400' },
  cancelled: { label: '已取消', color: 'text-red-400' },
};

interface SignalWithStages extends StockSignal {
  stage1?: { passed: boolean; label: string; detail: string };
  stage2?: { passed: boolean; label: string; detail: string };
  stage3?: { passed: boolean; label: string; detail: string };
  stage4?: { passed: boolean; label: string; detail: string };
  isFallback?: boolean;
  isNearMiss?: boolean;
  capitalAllocatedHKD?: number;
  expectedProfitHKD?: number;
  isCounterTrend?: boolean;
  riskRewardRatio?: number;
  maxHoldingMinutes?: number;
  entryRule?: string;
  invalidation?: string;
}

// ==================== 中短線 Recommendation ====================
interface MidtermRec {
  id: string;
  market: 'US' | 'HK';
  stock_code: string;
  stock_name: string;
  current_price: number;
  change_percent: number;

  trigger_type: string;
  trigger_label: string;
  trigger_reason: string;

  take_profit_a: number;
  take_profit_a_percent: number;
  take_profit_b: number;
  take_profit_b_percent: number;
  stop_loss: number;
  stop_loss_percent: number;

  suggested_capital_hkd: number;
  expected_profit_a_hkd: number;
  expected_profit_b_hkd: number;

  rsi: number;
  week_high_52: number;
  week_low_52: number;
  distance_from_52week_high: number;

  earnings_days_until?: number;
  earnings_beat_count?: number;

  confidence: number;
  holding_period: string;
  sector: string;
}

const TRIGGER_COLORS: Record<string, { border: string; badge: string; text: string }> = {
  EARNINGS_DIP: {
    border: 'border-amber-400/40',
    badge: 'bg-amber-500/20 text-amber-400',
    text: 'text-amber-400',
  },
  STRONG_STOCK_PULLBACK: {
    border: 'border-emerald-400/40',
    badge: 'bg-emerald-500/20 text-emerald-400',
    text: 'text-emerald-400',
  },
  SECTOR_BREAKOUT: {
    border: 'border-blue-400/40',
    badge: 'bg-blue-500/20 text-blue-400',
    text: 'text-blue-400',
  },
};

// ==================== 指數 / 槓桿ETF ====================
interface SignalBacktestStats {
  label: string;
  occurrences: number;
  hitRate: number | null;
  avgMovePct: number | null;
  medianMovePct: number | null;
  avgDaysToHit: number | null;
}

interface IndexResult {
  symbol: string;
  name: string;
  direction: 'long' | 'short';
  priceIsLive?: boolean;
  latestClose: number;
  latestDate: string;
  trend: 'strong' | 'neutral' | 'weak';
  supportLevels: { avg: number; touches: number }[];
  resistanceLevels: { avg: number; touches: number }[];
  recentReference: {
    low: { price: number; date: string };
    high: { price: number; date: string };
  };
  indicators: {
    sma20: number;
    sma50: number;
    sma200: number;
    atr14: number;
    avgVolume20: number;
    latestVolume: number;
    volumeSpikeRatio: number | null;
    rsi14: number | null;
    bollingerUpper: number | null;
    bollingerLower: number | null;
    bollingerPosition: 'above_upper' | 'below_lower' | 'inside' | null;
  };
  historicalStats: {
    oversoldBounce: SignalBacktestStats;
    overboughtPullback: SignalBacktestStats;
    bollingerLowerBounce: SignalBacktestStats;
    bollingerUpperPullback: SignalBacktestStats;
  };
  recommendation: {
    action: string;
    nextBuyPrice: number;
    nextSellPrice: number;
    basis: string;
  };
}

const BOLLINGER_POSITION_LABELS: Record<string, { label: string; color: string }> = {
  above_upper: { label: '突破上軌', color: 'text-red-400' },
  below_lower: { label: '跌穿下軌', color: 'text-emerald-400' },
  inside: { label: '通道內', color: 'text-slate-400' },
};

const TREND_LABELS: Record<string, { label: string; color: string }> = {
  strong: { label: '強勢', color: 'text-emerald-400' },
  neutral: { label: '中性', color: 'text-amber-400' },
  weak: { label: '弱勢', color: 'text-red-400' },
};

// ==================== MAIN COMPONENT ====================

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // 短炒 state
  const [signals, setSignals] = useState<SignalWithStages[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanInfo, setScanInfo] = useState<{ usedSoftener: boolean; nearMissCount: number } | null>(null);
  const [marketClosedNotice, setMarketClosedNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'closed'>('active');
  const [market, setMarket] = useState<Market>('US');

  // 中短線 state
  const [midtermRecs, setMidtermRecs] = useState<MidtermRec[]>([]);
  const [midtermScanning, setMidtermScanning] = useState(false);
  const [midtermError, setMidtermError] = useState<string | null>(null);
  const [midtermMarket, setMidtermMarket] = useState<'ALL' | 'US' | 'HK'>('ALL');

  // 指數/槓桿ETF state
  const [indexResults, setIndexResults] = useState<IndexResult[]>([]);
  const [indexScanning, setIndexScanning] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexGeneratedAt, setIndexGeneratedAt] = useState<string | null>(null);

  // 模式切換（短炒 vs 中短線 vs 指數）
  const [mode, setMode] = useState<Mode>('shortterm');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    setProfile({
      id: 'guest', email: 'guest@local', full_name: '訪客',
      subscription_status: 'active'
    } as any);
    setLoading(false);
  };

  // ==================== 短炒掃描 ====================
  const handleScan = async (targetMarket: Market = market) => {
    setScanning(true);
    setScanError(null);
    setScanInfo(null);
    setMarketClosedNotice(null);
    const endpoint = targetMarket === 'HK' ? '/api/scan-hk' : '/api/scan';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'linkage', riskLevel: 'medium' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Scan failed');
      if (data.success && data.signals) {
        setSignals(data.signals);
        setScanInfo({ usedSoftener: data.usedSoftener || false, nearMissCount: data.nearMissCount || 0 });
        if (data.marketClosedNotice) setMarketClosedNotice(data.marketClosedNotice);
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handleMarketSwitch = (targetMarket: Market) => {
    if (targetMarket === market) return;
    setMarket(targetMarket);
    setSignals([]);
    setScanInfo(null);
    setScanError(null);
    setMarketClosedNotice(null);
  };

  // ==================== 中短線掃描 ====================
  const handleMidtermScan = async () => {
    setMidtermScanning(true);
    setMidtermError(null);
    try {
      const response = await fetch('/api/scan-midterm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ market: midtermMarket, forceRefresh: false })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '掃描失敗');
      if (data.success) setMidtermRecs(data.recommendations || []);
    } catch (err) {
      setMidtermError(err instanceof Error ? err.message : '掃描失敗');
    } finally {
      setMidtermScanning(false);
    }
  };

  // ==================== 指數/槓桿ETF掃描 ====================
  const handleIndexScan = async () => {
    setIndexScanning(true);
    setIndexError(null);
    try {
      const response = await fetch('/api/index-scanner');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '掃描失敗');
      setIndexResults(data.results || []);
      setIndexGeneratedAt(data.generatedAt || null);
    } catch (err) {
      setIndexError(err instanceof Error ? err.message : '掃描失敗');
    } finally {
      setIndexScanning(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const isPremium = profile?.subscription_status === 'active';
  const filteredSignals = signals.filter((s) =>
    activeTab === 'active' ? s.status === 'active' : s.status !== 'active'
  );
  const displaySignals = isPremium ? filteredSignals :
    [...filteredSignals.filter(s => !s.is_premium), ...filteredSignals.filter(s => s.is_premium)];

  const displayMidtermRecs = midtermMarket === 'ALL'
    ? midtermRecs
    : midtermRecs.filter(r => r.market === midtermMarket);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      {/* Header */}
      <header className="border-b border-white/10 bg-[#0a0e1a]/95 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-amber-400 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-[#0a0e1a]" />
              </div>
              <span className="text-white font-bold">{SITE_NAME}</span>
            </div>
            <div className="flex items-center gap-3">
              {isPremium ? (
                <span className="hidden sm:inline-flex items-center gap-1.5 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs font-bold px-3 py-1.5 rounded-full">
                  <Crown className="w-3.5 h-3.5" />高級會員
                </span>
              ) : (
                <Link href="/register" className="hidden sm:inline-flex items-center gap-1.5 bg-amber-400 text-[#0a0e1a] text-xs font-bold px-3 py-1.5 rounded-full hover:bg-amber-300 transition-colors">
                  <Crown className="w-3.5 h-3.5" />升級訂閱
                </Link>
              )}
              <div className="flex items-center gap-2 text-slate-400">
                <User className="w-4 h-4" />
                <span className="text-sm hidden sm:block">{profile?.email}</span>
              </div>
              <button onClick={handleLogout} className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome */}
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white mb-1">你好，{profile?.full_name || '會員'} 👋</h1>
          <p className="text-slate-400 text-sm">AI 股票分析系統</p>
        </div>

        {/* ===== 模式切換：短炒 / 中短線 / 指數 ===== */}
        <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 mb-6 w-fit">
          <button
            onClick={() => setMode('shortterm')}
            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${mode === 'shortterm' ? 'bg-amber-400 text-[#0a0e1a]' : 'text-slate-400 hover:text-white'}`}
          >
            <Zap className="w-4 h-4" />
            短炒推介
          </button>
          <button
            onClick={() => setMode('midterm')}
            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${mode === 'midterm' ? 'bg-amber-400 text-[#0a0e1a]' : 'text-slate-400 hover:text-white'}`}
          >
            <Target className="w-4 h-4" />
            中短線選股
          </button>
          <button
            onClick={() => setMode('indices')}
            className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${mode === 'indices' ? 'bg-amber-400 text-[#0a0e1a]' : 'text-slate-400 hover:text-white'}`}
          >
            <Activity className="w-4 h-4" />
            指數/槓桿ETF
          </button>
        </div>

        {/* ==================== 短炒模式 ==================== */}
        {mode === 'shortterm' && (
          <>
            {/* 市場切換 */}
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1 mb-6 w-fit">
              <button
                onClick={() => handleMarketSwitch('US')}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${market === 'US' ? 'bg-amber-400 text-[#0a0e1a]' : 'text-slate-400 hover:text-white'}`}
              >🇺🇸 美股</button>
              <button
                onClick={() => handleMarketSwitch('HK')}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${market === 'HK' ? 'bg-amber-400 text-[#0a0e1a]' : 'text-slate-400 hover:text-white'}`}
              >🇭🇰 港股</button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { icon: <Zap className="w-4 h-4 text-amber-400" />, label: '今日訊號', value: signals.filter(s => s.status === 'active').length, color: 'text-white' },
                { icon: <BarChart2 className="w-4 h-4 text-emerald-400" />, label: '已完結', value: signals.filter(s => s.status === 'closed').length, color: 'text-white' },
                { icon: <TrendingUp className="w-4 h-4 text-blue-400" />, label: '獲利訊號', value: signals.filter(s => s.result_pct && s.result_pct > 0).length, color: 'text-emerald-400' },
                { icon: <Crown className="w-4 h-4 text-amber-400" />, label: '會員狀態', value: isPremium ? '高級會員' : '免費會員', color: isPremium ? 'text-amber-400' : 'text-slate-300' },
              ].map((stat, i) => (
                <div key={i} className="bg-[#0d1224] border border-white/10 rounded-2xl p-5">
                  <div className="flex items-center gap-2 mb-2">{stat.icon}<span className="text-slate-400 text-xs">{stat.label}</span></div>
                  <div className={`text-2xl font-black ${stat.color}`}>{stat.value}</div>
                </div>
              ))}
            </div>

            {/* Alerts */}
            {scanError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div><p className="text-red-400 font-medium">掃描失敗</p><p className="text-slate-400 text-sm">{scanError}</p></div>
              </div>
            )}
            {marketClosedNotice && (
              <div className="bg-slate-500/10 border border-slate-500/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
                <Clock className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                <div><p className="text-slate-300 font-medium">市場休市</p><p className="text-slate-400 text-sm">{marketClosedNotice}</p></div>
              </div>
            )}
            {scanInfo && (scanInfo.usedSoftener || scanInfo.nearMissCount > 0) && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
                <Star className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-400 font-medium">掃描提示</p>
                  <p className="text-slate-400 text-sm">
                    {scanInfo.usedSoftener && '今日市場動能較弱，已啟用降維模式。'}
                    {scanInfo.nearMissCount > 0 && ` 已加入 ${scanInfo.nearMissCount} 隻遺珠參考。`}
                  </p>
                </div>
              </div>
            )}

            {/* Tabs + Refresh */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
                {(['active', 'closed'] as const).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab ? 'bg-amber-400 text-[#0a0e1a]' : 'text-slate-400 hover:text-white'}`}>
                    {tab === 'active' ? '進行中' : '歷史記錄'}
                  </button>
                ))}
              </div>
              <button onClick={() => handleScan()} disabled={scanning}
                className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all ${scanning ? 'bg-amber-400/20 text-amber-400 cursor-not-allowed' : 'bg-amber-400 text-[#0a0e1a] hover:bg-amber-300'}`}>
                <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{scanning ? '掃描中...' : `刷新${market === 'HK' ? '港股' : '美股'}`}</span>
              </button>
            </div>

            {/* Signals Grid */}
            {displaySignals.length === 0 ? (
              <div className="text-center py-16">
                <Clock className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400">{marketClosedNotice || `暫時沒有合格訊號；系統不會為湊數而顯示交易建議。`}</p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {displaySignals.map((signal) => {
                  const isLocked = !isPremium && signal.is_premium;
                  const typeInfo = SIGNAL_TYPE_LABELS[signal.signal_type] || SIGNAL_TYPE_LABELS.buy;
                  const upside = (((signal.target_price - signal.entry_price) / signal.entry_price) * 100).toFixed(1);
                  const downside = (((signal.stop_loss - signal.entry_price) / signal.entry_price) * 100).toFixed(1);
                  const statusInfo = STATUS_LABELS[signal.status];
                  const hasCapitalInfo = typeof signal.capitalAllocatedHKD === 'number' && typeof signal.expectedProfitHKD === 'number';

                  return (
                    <div key={signal.id} className={`bg-[#0d1224] border rounded-2xl overflow-hidden transition-all ${signal.isCounterTrend ? 'border-cyan-400/40' : signal.isNearMiss ? 'border-amber-500/30' : signal.isFallback ? 'border-blue-500/30' : 'border-white/10 hover:border-white/20'} ${isLocked ? 'opacity-60' : ''}`}>
                      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`border text-xs font-bold px-2.5 py-1 rounded-full ${typeInfo.bg} ${typeInfo.color}`}>{typeInfo.label}</span>
                          <div>
                            <div className="text-white font-bold flex items-center gap-2">
                              {signal.stock_name}
                              {signal.isCounterTrend && <span className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded flex items-center gap-1"><Gem className="w-3 h-3" />逆市抗跌</span>}
                              {signal.isNearMiss && <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">遺珠參考</span>}
                            </div>
                            <div className="text-slate-500 text-xs">{signal.stock_code}</div>
                          </div>
                        </div>
                        <span className={`text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
                      </div>
                      {isLocked ? (
                        <div className="px-5 py-8 flex flex-col items-center justify-center text-center">
                          <Lock className="w-8 h-8 text-slate-600 mb-2" />
                          <p className="text-slate-400 text-sm mb-3">此為高級會員專屬訊號</p>
                          <button className="bg-amber-400 text-[#0a0e1a] px-4 py-2 rounded-lg text-xs font-bold">升級解鎖</button>
                        </div>
                      ) : (
                        <>
                          <div className="px-5 py-4 grid grid-cols-3 gap-3">
                            <div><div className="text-slate-400 text-xs mb-1">入場價</div><div className="text-white font-bold text-lg">${signal.entry_price.toFixed(2)}</div></div>
                            <div><div className="text-slate-400 text-xs mb-1">目標價</div><div className="text-emerald-400 font-bold text-lg">${signal.target_price.toFixed(2)}</div><div className="text-emerald-400 text-xs">+{upside}%</div></div>
                            <div><div className="text-slate-400 text-xs mb-1">止蝕價</div><div className="text-red-400 font-bold text-lg">${signal.stop_loss.toFixed(2)}</div><div className="text-red-400 text-xs">{downside}%</div></div>
                          </div>
                          {hasCapitalInfo && (
                            <div className="px-5 pb-3 grid grid-cols-2 gap-3">
                              <div className="bg-white/5 rounded-xl px-3 py-2"><div className="text-slate-400 text-xs mb-0.5">配置參考</div><div className="text-white font-bold text-sm">HK${signal.capitalAllocatedHKD!.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
                              <div className="bg-white/5 rounded-xl px-3 py-2"><div className="text-slate-400 text-xs mb-0.5">目標毛利參考</div><div className="text-emerald-400 font-bold text-sm">HK${signal.expectedProfitHKD!.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
                            </div>
                          )}
                          {typeof signal.riskRewardRatio === 'number' && (
                            <div className="px-5 pb-3 grid grid-cols-2 gap-3">
                              <div className="bg-white/5 rounded-xl px-3 py-2"><div className="text-slate-400 text-xs mb-0.5">回報／風險</div><div className="text-amber-400 font-bold text-sm">{signal.riskRewardRatio.toFixed(2)}R</div></div>
                              <div className="bg-white/5 rounded-xl px-3 py-2"><div className="text-slate-400 text-xs mb-0.5">時間退出</div><div className="text-slate-200 font-bold text-sm">{signal.maxHoldingMinutes || '—'} 分鐘</div></div>
                            </div>
                          )}
                          <div className="px-5 pb-4">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-slate-400 text-xs">策略分數（非勝率）</span>
                              <span className="text-amber-400 text-xs font-bold">{signal.confidence}%</span>
                            </div>
                            <div className="h-1.5 bg-white/10 rounded-full">
                              <div className="h-1.5 bg-gradient-to-r from-amber-400 to-amber-300 rounded-full" style={{ width: `${signal.confidence}%` }} />
                            </div>
                          </div>
                          {signal.analysis && <div className="px-5 pb-2"><p className="text-slate-400 text-xs leading-relaxed line-clamp-3">{signal.analysis}</p></div>}
                          {signal.entryRule && <div className="px-5 pb-2"><p className="text-slate-500 text-[11px] leading-relaxed">入場：{signal.entryRule}</p></div>}
                          {signal.invalidation && <div className="px-5 pb-4"><p className="text-red-300/80 text-[11px] leading-relaxed">失效：{signal.invalidation}</p></div>}
                          <div className="px-5 pb-4 flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-slate-500 text-xs"><Clock className="w-3 h-3" />日內計劃</div>
                            {signal.result_pct !== null && (
                              <div className={`flex items-center gap-1 text-sm font-bold ${signal.result_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {signal.result_pct >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                {signal.result_pct >= 0 ? '+' : ''}{signal.result_pct}%
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ==================== 中短線模式 ==================== */}
        {mode === 'midterm' && (
          <>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
              <Target className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-400 font-medium">中短線選股模式</p>
                <p className="text-slate-400 text-sm">持倉目標 1-4 週，止盈分兩批（+10% 先出一半，+20% 出另一半），止損 -7%。建議最多同時持有 3 注。</p>
              </div>
            </div>

            {/* 市場篩選 + 掃描按鈕 */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
                {(['ALL', 'US', 'HK'] as const).map((m) => (
                  <button key={m} onClick={() => setMidtermMarket(m)}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${midtermMarket === m ? 'bg-amber-400 text-[#0a0e1a]' : 'text-slate-400 hover:text-white'}`}>
                    {m === 'ALL' ? '全部' : m === 'US' ? '🇺🇸 美股' : '🇭🇰 港股'}
                  </button>
                ))}
              </div>
              <button onClick={handleMidtermScan} disabled={midtermScanning}
                className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all ${midtermScanning ? 'bg-amber-400/20 text-amber-400 cursor-not-allowed' : 'bg-amber-400 text-[#0a0e1a] hover:bg-amber-300'}`}>
                <RefreshCw className={`w-4 h-4 ${midtermScanning ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">{midtermScanning ? '掃描中...' : '掃描中短線機會'}</span>
              </button>
            </div>

            {midtermError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div><p className="text-red-400 font-medium">掃描失敗</p><p className="text-slate-400 text-sm">{midtermError}</p></div>
              </div>
            )}

            {displayMidtermRecs.length === 0 ? (
              <div className="text-center py-16">
                <Target className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400 mb-2">暫時未有中短線機會</p>
                <p className="text-slate-500 text-sm">中短線系統只會喺出現強力催化劑時推介，唔係每日都有。你亦可以設定 Email 通知，有機會先通知你。</p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {displayMidtermRecs.map((rec) => {
                  const colors = TRIGGER_COLORS[rec.trigger_type] || TRIGGER_COLORS.STRONG_STOCK_PULLBACK;
                  return (
                    <div key={rec.id} className={`bg-[#0d1224] border ${colors.border} rounded-2xl overflow-hidden`}>
                      {/* Header */}
                      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                        <div>
                          <div className="text-white font-bold flex items-center gap-2">
                            {rec.stock_name}
                            <span className={`text-xs px-2 py-0.5 rounded ${colors.badge}`}>{rec.trigger_label}</span>
                            <span className="text-xs bg-white/10 text-slate-400 px-2 py-0.5 rounded">{rec.market === 'US' ? '🇺🇸' : '🇭🇰'}</span>
                          </div>
                          <div className="text-slate-500 text-xs mt-0.5">{rec.stock_code} · {rec.sector}</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs font-medium ${rec.change_percent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {rec.change_percent >= 0 ? '+' : ''}{(rec.change_percent * 100).toFixed(2)}%
                          </div>
                          <div className="text-slate-500 text-xs">今日</div>
                        </div>
                      </div>

                      {/* 觸發原因 */}
                      <div className="px-5 py-3 bg-white/2 border-b border-white/5">
                        <p className="text-slate-300 text-xs leading-relaxed">{rec.trigger_reason}</p>
                      </div>

                      {/* 入場 + 分批止盈 */}
                      <div className="px-5 py-4 grid grid-cols-4 gap-2">
                        <div>
                          <div className="text-slate-400 text-xs mb-1">入場參考</div>
                          <div className="text-white font-bold">{rec.market === 'HK' ? 'HK$' : '$'}{rec.current_price.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">止盈一 <span className="text-emerald-400">+{rec.take_profit_a_percent}%</span></div>
                          <div className="text-emerald-400 font-bold">{rec.market === 'HK' ? 'HK$' : '$'}{rec.take_profit_a.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">止盈二 <span className="text-emerald-300">+{rec.take_profit_b_percent}%</span></div>
                          <div className="text-emerald-300 font-bold">{rec.market === 'HK' ? 'HK$' : '$'}{rec.take_profit_b.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">止損 <span className="text-red-400">-{rec.stop_loss_percent}%</span></div>
                          <div className="text-red-400 font-bold">{rec.market === 'HK' ? 'HK$' : '$'}{rec.stop_loss.toFixed(2)}</div>
                        </div>
                      </div>

                      {/* 資金 + 預期利潤 */}
                      <div className="px-5 pb-3 grid grid-cols-3 gap-2">
                        <div className="bg-white/5 rounded-xl px-3 py-2">
                          <div className="text-slate-400 text-xs mb-0.5">建議投入</div>
                          <div className="text-white font-bold text-sm">HK${rec.suggested_capital_hkd.toLocaleString()}</div>
                        </div>
                        <div className="bg-white/5 rounded-xl px-3 py-2">
                          <div className="text-slate-400 text-xs mb-0.5">止盈一利潤</div>
                          <div className="text-emerald-400 font-bold text-sm">HK${Math.round(rec.expected_profit_a_hkd).toLocaleString()}</div>
                        </div>
                        <div className="bg-white/5 rounded-xl px-3 py-2">
                          <div className="text-slate-400 text-xs mb-0.5">止盈二利潤</div>
                          <div className="text-emerald-300 font-bold text-sm">HK${Math.round(rec.expected_profit_b_hkd).toLocaleString()}</div>
                        </div>
                      </div>

                      {/* AI 信心 + 技術面 */}
                      <div className="px-5 pb-4">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-slate-400 text-xs">AI 信心指數</span>
                          <span className={`text-xs font-bold ${colors.text}`}>{rec.confidence}%</span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full mb-3">
                          <div className="h-1.5 bg-gradient-to-r from-amber-400 to-amber-300 rounded-full" style={{ width: `${rec.confidence}%` }} />
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <span>RSI {rec.rsi.toFixed(0)}</span>
                          <span>距52週高 -{rec.distance_from_52week_high.toFixed(1)}%</span>
                          {rec.earnings_days_until && <span className="text-amber-400 flex items-center gap-1"><Calendar className="w-3 h-3" />業績 {rec.earnings_days_until}日後</span>}
                        </div>
                        <div className="mt-2 text-slate-500 text-xs flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          建議持倉：{rec.holding_period}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ==================== 指數/槓桿ETF模式 ==================== */}
        {mode === 'indices' && (
          <>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
              <Activity className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-400 font-medium">TQQQ 技術分析掃描</p>
                <p className="text-slate-400 text-sm">
                  分析TQQQ過去10年daily數據：SMA20/50/200、ATR、RSI、布林通道、支持/阻力位，
                  並用歷史回測統計超賣/超買訊號嘅命中率。建議價僅供參考，槓桿ETF長線持有有波動耗損風險。
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between mb-6">
              <div className="text-slate-500 text-xs">
                {indexGeneratedAt && `更新時間 ${new Date(indexGeneratedAt).toLocaleString('zh-HK')}`}
              </div>
              <button
                onClick={handleIndexScan}
                disabled={indexScanning}
                className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all ${indexScanning ? 'bg-amber-400/20 text-amber-400 cursor-not-allowed' : 'bg-amber-400 text-[#0a0e1a] hover:bg-amber-300'}`}
              >
                <RefreshCw className={`w-4 h-4 ${indexScanning ? 'animate-spin' : ''}`} />
                <span>{indexScanning ? '分析中...' : '刷新指數'}</span>
              </button>
            </div>

            {indexError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div><p className="text-red-400 font-medium">掃描失敗</p><p className="text-slate-400 text-sm">{indexError}</p></div>
              </div>
            )}

            {indexResults.length === 0 ? (
              <div className="text-center py-16">
                <Activity className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                <p className="text-slate-400">暫時沒有數據，請按「刷新指數」開始分析（首次約需30-40秒）</p>
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {indexResults.map((r) => {
                  const isLong = r.direction === 'long';
                  const trendInfo = TREND_LABELS[r.trend];
                  const support = r.supportLevels?.[0]?.avg;
                  const resistance = r.resistanceLevels?.[0]?.avg;
                  const buyPrice = r.recommendation?.nextBuyPrice;
                  const sellPrice = r.recommendation?.nextSellPrice;

                  return (
                    <div key={r.symbol} className={`bg-[#0d1224] border rounded-2xl overflow-hidden ${isLong ? 'border-emerald-400/30' : 'border-red-400/30'}`}>
                      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`border text-xs font-bold px-2.5 py-1 rounded-full ${isLong ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : 'text-red-400 bg-red-500/10 border-red-500/20'}`}>
                            {isLong ? '做多策略' : '做空策略'}
                          </span>
                          <div>
                            <div className="text-white font-bold">{r.symbol}</div>
                            <div className="text-slate-500 text-xs">{r.name}</div>
                          </div>
                        </div>
                        <span className={`text-xs font-medium ${trendInfo.color}`}>{trendInfo.label}</span>
                      </div>

                      <div className="px-5 py-4 grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-slate-400 text-xs mb-1 flex items-center gap-1.5">
                            現價
                            <span className={r.priceIsLive ? 'text-emerald-400' : 'text-amber-400'}>
                              {r.priceIsLive ? '● 即市' : '● 收市價'}
                            </span>
                          </div>
                          <div className="text-white font-bold text-lg">${r.latestClose.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">{isLong ? '建議買入' : '建議做空'}</div>
                          <div className="text-white font-bold text-lg">${buyPrice != null ? (isLong ? buyPrice : sellPrice)?.toFixed(2) : '—'}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">{isLong ? '建議賣出' : '建議回補'}</div>
                          <div className={`font-bold text-lg ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                            ${sellPrice != null ? (isLong ? sellPrice : buyPrice)?.toFixed(2) : '—'}
                          </div>
                        </div>
                      </div>

                      <div className="px-5 pb-3 grid grid-cols-2 gap-3">
                        <div className="bg-white/5 rounded-xl px-3 py-2">
                          <div className="text-slate-400 text-xs mb-0.5">支持位</div>
                          <div className="text-slate-200 font-bold text-sm">{support != null ? support.toFixed(2) : '—'}</div>
                        </div>
                        <div className="bg-white/5 rounded-xl px-3 py-2">
                          <div className="text-slate-400 text-xs mb-0.5">阻力位</div>
                          <div className="text-slate-200 font-bold text-sm">{resistance != null ? resistance.toFixed(2) : '—'}</div>
                        </div>
                      </div>

                      {r.recentReference && (
                        <div className="px-5 pb-3 text-xs text-slate-500 flex items-center gap-1">
                          <span className="text-slate-600">近10日(未確認)：</span>
                          低 {r.recentReference.low.price.toFixed(2)}({r.recentReference.low.date.slice(5)}) ·
                          高 {r.recentReference.high.price.toFixed(2)}({r.recentReference.high.date.slice(5)})
                        </div>
                      )}

                      {r.indicators?.volumeSpikeRatio != null && (
                        <div className="px-5 pb-3 text-xs text-slate-500 flex items-center gap-3">
                          <span>量比 {r.indicators.volumeSpikeRatio.toFixed(2)}x</span>
                          <span>ATR14 {r.indicators.atr14?.toFixed(2)}</span>
                          {r.indicators.rsi14 != null && (
                            <span className={r.indicators.rsi14 < 30 ? 'text-emerald-400 font-bold' : r.indicators.rsi14 > 70 ? 'text-red-400 font-bold' : ''}>
                              RSI {r.indicators.rsi14.toFixed(0)}
                            </span>
                          )}
                          {r.indicators.bollingerPosition && (
                            <span className={BOLLINGER_POSITION_LABELS[r.indicators.bollingerPosition].color}>
                              布林{BOLLINGER_POSITION_LABELS[r.indicators.bollingerPosition].label}
                            </span>
                          )}
                        </div>
                      )}

                      {/* ===== 歷史回測統計：獨立區塊，唔再塞晒喺basis一句字入面 ===== */}
                      {r.historicalStats && (
                        <div className="px-5 pb-4">
                          <div className="text-slate-500 text-xs uppercase tracking-wide mb-2">歷史訊號回測（10年樣本）</div>
                          <div className="grid grid-cols-2 gap-2">
                            {([
                              { stat: r.historicalStats.oversoldBounce, tone: 'up' as const },
                              { stat: r.historicalStats.bollingerLowerBounce, tone: 'up' as const },
                              { stat: r.historicalStats.overboughtPullback, tone: 'down' as const },
                              { stat: r.historicalStats.bollingerUpperPullback, tone: 'down' as const },
                            ]).map(({ stat, tone }, i) =>
                              stat && stat.occurrences > 0 ? (
                                <div
                                  key={i}
                                  className={`bg-white/5 rounded-xl px-3 py-2 border ${tone === 'up' ? 'border-emerald-500/20' : 'border-red-500/20'}`}
                                >
                                  <div className="text-slate-400 text-xs mb-1 leading-tight">{stat.label}</div>
                                  <div className="flex items-baseline gap-1.5">
                                    <span className={`font-bold text-lg ${tone === 'up' ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {stat.hitRate}%
                                    </span>
                                    <span className="text-slate-500 text-xs">命中率</span>
                                  </div>
                                  <div className="text-slate-500 text-xs mt-1">
                                    樣本{stat.occurrences}次 · 平均{stat.avgMovePct}% · 平均{stat.avgDaysToHit}日
                                  </div>
                                </div>
                              ) : (
                                <div key={i} className="bg-white/5 rounded-xl px-3 py-2 border border-white/5">
                                  <div className="text-slate-500 text-xs leading-tight">{stat?.label ?? '—'}</div>
                                  <div className="text-slate-600 text-xs mt-1">歷史樣本不足</div>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}

                      {r.recommendation?.basis && (
                        <div className="px-5 pb-4">
                          <p className="text-slate-400 text-xs leading-relaxed">{r.recommendation.basis}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
