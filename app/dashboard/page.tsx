'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase, type StockSignal, type Profile } from '@/lib/supabase';
import {
  TrendingUp,
  TrendingDown,
  Eye,
  LogOut,
  Crown,
  Zap,
  Clock,
  BarChart2,
  RefreshCw,
  Lock,
  ChevronRight,
  User,
  AlertTriangle,
  Star,
} from 'lucide-react';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || '玄金操盤手';
const MONTHLY_PRICE = process.env.NEXT_PUBLIC_MONTHLY_PRICE || '388';

const SIGNAL_TYPE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  buy: { label: '買入', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  sell: { label: '沽出', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
  watch: { label: '觀察', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
};

const TIMEFRAME_LABELS: Record<string, string> = {
  intraday: '當日',
  '1-3days': '1-3日',
  '1week': '一週',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  active: { label: '進行中', color: 'text-emerald-400' },
  closed: { label: '已完結', color: 'text-slate-400' },
  cancelled: { label: '已取消', color: 'text-red-400' },
};

// Extended StockSignal with stage information
interface SignalWithStages extends StockSignal {
  stage1?: { passed: boolean; label: string; detail: string };
  stage2?: { passed: boolean; label: string; detail: string };
  stage3?: { passed: boolean; label: string; detail: string };
  stage4?: { passed: boolean; label: string; detail: string };
  isFallback?: boolean;
  isNearMiss?: boolean;
}

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [signals, setSignals] = useState<SignalWithStages[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanInfo, setScanInfo] = useState<{ usedSoftener: boolean; nearMissCount: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'closed'>('active');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
  setLoading(true);
  setProfile({ 
    id: 'guest', 
    email: 'guest@local', 
    full_name: '訪客', 
    subscription_status: 'active' 
  } as any);
  setSignals([]);
  setLoading(false);
};

  const handleScan = async () => {
    setScanning(true);
    setScanError(null);
    setScanInfo(null);

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'linkage', riskLevel: 'medium' })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Scan failed');
      }

      if (data.success && data.signals) {
        setSignals(data.signals);
        setScanInfo({
          usedSoftener: data.usedSoftener || false,
          nearMissCount: data.nearMissCount || 0
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scan failed';
      setScanError(message);
      console.error('Scan error:', message);
    } finally {
      setScanning(false);
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

  const freeSignals = filteredSignals.filter((s) => !s.is_premium);
  const premiumSignals = filteredSignals.filter((s) => s.is_premium);
  const displaySignals = isPremium ? filteredSignals : [...freeSignals, ...premiumSignals];

  const winRate = signals.filter((s) => s.result_pct && s.result_pct > 0).length;
  const closedCount = signals.filter((s) => s.status === 'closed').length;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">載入訊號中...</p>
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
                  <Crown className="w-3.5 h-3.5" />
                  高級會員
                </span>
              ) : (
                <Link
                  href="/register"
                  className="hidden sm:inline-flex items-center gap-1.5 bg-amber-400 text-[#0a0e1a] text-xs font-bold px-3 py-1.5 rounded-full hover:bg-amber-300 transition-colors"
                >
                  <Crown className="w-3.5 h-3.5" />
                  升級訂閱
                </Link>
              )}

              <div className="flex items-center gap-2 text-slate-400">
                <User className="w-4 h-4" />
                <span className="text-sm hidden sm:block">{profile?.email}</span>
              </div>

              <button
                onClick={handleLogout}
                className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5"
                title="登出"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome & Stats */}
        <div className="mb-8">
          <h1 className="text-2xl font-black text-white mb-1">
            你好，{profile?.full_name || '會員'} 👋
          </h1>
          <p className="text-slate-400 text-sm">以下是今日最新港股 AI 訊號</p>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#0d1224] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span className="text-slate-400 text-xs">今日訊號</span>
            </div>
            <div className="text-2xl font-black text-white">{signals.filter((s) => s.status === 'active').length}</div>
          </div>
          <div className="bg-[#0d1224] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <BarChart2 className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400 text-xs">已完結</span>
            </div>
            <div className="text-2xl font-black text-white">{closedCount}</div>
          </div>
          <div className="bg-[#0d1224] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-slate-400 text-xs">獲利訊號</span>
            </div>
            <div className="text-2xl font-black text-emerald-400">{winRate}</div>
          </div>
          <div className="bg-[#0d1224] border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <Crown className="w-4 h-4 text-amber-400" />
              <span className="text-slate-400 text-xs">會員狀態</span>
            </div>
            <div className={`text-sm font-bold ${isPremium ? 'text-amber-400' : 'text-slate-300'}`}>
              {isPremium ? '高級會員' : '免費會員'}
            </div>
          </div>
        </div>

        {/* Upgrade banner for free users */}
        {!isPremium && (
          <div className="bg-gradient-to-r from-amber-400/10 to-amber-600/5 border border-amber-400/20 rounded-2xl p-5 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Crown className="w-5 h-5 text-amber-400" />
                <span className="text-white font-bold">升級高級會員</span>
              </div>
              <p className="text-slate-400 text-sm">
                解鎖全部每日 5-10 個訊號，附深度分析及即時 WhatsApp 推送
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="text-right">
                <div className="text-white font-black text-xl">HK${MONTHLY_PRICE}</div>
                <div className="text-slate-400 text-xs">/月</div>
              </div>
              <button className="bg-amber-400 text-[#0a0e1a] px-5 py-2.5 rounded-xl font-bold text-sm hover:bg-amber-300 transition-colors flex items-center gap-1">
                立即升級 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Scan Error Alert */}
        {scanError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-400 font-medium">掃描失敗</p>
              <p className="text-slate-400 text-sm">{scanError}</p>
            </div>
          </div>
        )}

        {/* Scan Info */}
        {scanInfo && (scanInfo.usedSoftener || scanInfo.nearMissCount > 0) && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 mb-6 flex items-start gap-3">
            <Star className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-400 font-medium">掃描提示</p>
              <p className="text-slate-400 text-sm">
                {scanInfo.usedSoftener && '今日市場動能較弱，已啟用降維模式獲取更多推介。'}
                {scanInfo.nearMissCount > 0 && ` 已加入 ${scanInfo.nearMissCount} 隻遺珠參考。`}
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            <button
              onClick={() => setActiveTab('active')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'active'
                  ? 'bg-amber-400 text-[#0a0e1a]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              進行中
            </button>
            <button
              onClick={() => setActiveTab('closed')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'closed'
                  ? 'bg-amber-400 text-[#0a0e1a]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              歷史記錄
            </button>
          </div>

          <button
            onClick={handleScan}
            disabled={scanning}
            className={`flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-all ${
              scanning
                ? 'bg-amber-400/20 text-amber-400 cursor-not-allowed'
                : 'bg-amber-400 text-[#0a0e1a] hover:bg-amber-300'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{scanning ? '掃描中...' : '刷新'}</span>
          </button>
        </div>

        {/* Signals Grid */}
        {displaySignals.length === 0 ? (
          <div className="text-center py-16">
            <Clock className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">暫時沒有訊號，請按「刷新」開始掃描</p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {displaySignals.map((signal) => {
              const isLocked = !isPremium && signal.is_premium;
              const typeInfo = SIGNAL_TYPE_LABELS[signal.signal_type] || SIGNAL_TYPE_LABELS.buy;
              const upside = (((signal.target_price - signal.entry_price) / signal.entry_price) * 100).toFixed(1);
              const downside = (((signal.stop_loss - signal.entry_price) / signal.entry_price) * 100).toFixed(1);
              const statusInfo = STATUS_LABELS[signal.status];

              return (
                <div
                  key={signal.id}
                  className={`bg-[#0d1224] border rounded-2xl overflow-hidden transition-all ${
                    signal.isNearMiss
                      ? 'border-amber-500/30'
                      : signal.isFallback
                      ? 'border-blue-500/30'
                      : 'border-white/10 hover:border-white/20'
                  } ${isLocked ? 'opacity-60' : ''}`}
                >
                  {/* Signal header */}
                  <div className={`px-5 py-4 border-b border-white/5 flex items-center justify-between`}>
                    <div className="flex items-center gap-3">
                      <span className={`border text-xs font-bold px-2.5 py-1 rounded-full ${typeInfo.bg} ${typeInfo.color}`}>
                        {typeInfo.label}
                      </span>
                      <div>
                        <div className="text-white font-bold flex items-center gap-2">
                          {signal.stock_name}
                          {signal.isNearMiss && (
                            <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">遺珠參考</span>
                          )}
                          {signal.isFallback && !signal.isNearMiss && (
                            <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">降維推介</span>
                          )}
                        </div>
                        <div className="text-slate-500 text-xs">{signal.stock_code}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {signal.is_premium && (
                        <span className="bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Crown className="w-3 h-3" />
                          高級
                        </span>
                      )}
                      <span className={`text-xs font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
                    </div>
                  </div>

                  {isLocked ? (
                    <div className="px-5 py-8 flex flex-col items-center justify-center text-center">
                      <Lock className="w-8 h-8 text-slate-600 mb-2" />
                      <p className="text-slate-400 text-sm mb-3">此為高級會員專屬訊號</p>
                      <button className="bg-amber-400 text-[#0a0e1a] px-4 py-2 rounded-lg text-xs font-bold hover:bg-amber-300 transition-colors">
                        升級解鎖
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="px-5 py-4 grid grid-cols-3 gap-3">
                        <div>
                          <div className="text-slate-400 text-xs mb-1">入場價</div>
                          <div className="text-white font-bold text-lg">${signal.entry_price.toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">目標價</div>
                          <div className="text-emerald-400 font-bold text-lg">${signal.target_price.toFixed(2)}</div>
                          <div className="text-emerald-400 text-xs">+{upside}%</div>
                        </div>
                        <div>
                          <div className="text-slate-400 text-xs mb-1">止蝕價</div>
                          <div className="text-red-400 font-bold text-lg">${signal.stop_loss.toFixed(2)}</div>
                          <div className="text-red-400 text-xs">{downside}%</div>
                        </div>
                      </div>

                      <div className="px-5 pb-4">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-slate-400 text-xs">AI 信心指數</span>
                          <span className="text-amber-400 text-xs font-bold">{signal.confidence}%</span>
                        </div>
                        <div className="h-1.5 bg-white/10 rounded-full">
                          <div
                            className="h-1.5 bg-gradient-to-r from-amber-400 to-amber-300 rounded-full transition-all"
                            style={{ width: `${signal.confidence}%` }}
                          />
                        </div>
                      </div>

                      {/* Four-stage details */}
                      {(signal.stage1 || signal.stage2 || signal.stage3 || signal.stage4) && (
                        <div className="px-5 pb-4">
                          <div className="text-slate-400 text-xs mb-2">四階段篩選詳情</div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {signal.stage1 && (
                              <div className="flex items-center gap-1.5">
                                <span>{signal.stage1.passed ? '✅' : '❌'}</span>
                                <span className="text-slate-500">📊 量能異動：</span>
                                <span className={signal.stage1.passed ? 'text-emerald-400' : 'text-slate-500'}>
                                  {signal.stage1.passed ? signal.stage1.detail : '未通過'}
                                </span>
                              </div>
                            )}
                            {signal.stage2 && (
                              <div className="flex items-center gap-1.5">
                                <span>{signal.stage2.passed ? '✅' : '❌'}</span>
                                <span className="text-slate-500">📰 新聞催化：</span>
                                <span className={signal.stage2.passed ? 'text-emerald-400' : 'text-slate-500'}>
                                  {signal.stage2.passed ? signal.stage2.detail : '無'}
                                </span>
                              </div>
                            )}
                            {signal.stage3 && (
                              <div className="flex items-center gap-1.5">
                                <span>{signal.stage3.passed ? '✅' : '❌'}</span>
                                <span className="text-slate-500">🌐 美股聯動：</span>
                                <span className={signal.stage3.passed ? 'text-emerald-400' : 'text-slate-500'}>
                                  {signal.stage3.passed ? signal.stage3.detail : '無'}
                                </span>
                              </div>
                            )}
                            {signal.stage4 && (
                              <div className="flex items-center gap-1.5">
                                <span>{signal.stage4.passed ? '✅' : '❌'}</span>
                                <span className="text-slate-500">📈 技術共振：</span>
                                <span className={signal.stage4.passed ? 'text-emerald-400' : 'text-slate-500'}>
                                  {signal.stage4.passed ? signal.stage4.detail : '未達標'}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {signal.analysis && (
                        <div className="px-5 pb-4">
                          <p className="text-slate-400 text-xs leading-relaxed line-clamp-3">{signal.analysis}</p>
                        </div>
                      )}

                      <div className="px-5 pb-4 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                          <Clock className="w-3 h-3" />
                          {TIMEFRAME_LABELS[signal.timeframe] || signal.timeframe}
                        </div>
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
      </div>
    </div>
  );
}
