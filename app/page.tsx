'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import {
  TrendingUp,
  Shield,
  Zap,
  BarChart2,
  Clock,
  CheckCircle,
  ChevronRight,
  Star,
  ArrowRight,
  Menu,
  X,
} from 'lucide-react';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || '玄金操盤手';
const MONTHLY_PRICE = process.env.NEXT_PUBLIC_MONTHLY_PRICE || '388';
const WHATSAPP = process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || '';

const features = [
  {
    icon: Zap,
    title: 'AI 智能掃描',
    desc: '每日自動掃描逾 2,000 隻港股，精選高勝算短炒機會',
  },
  {
    icon: BarChart2,
    title: '技術分析訊號',
    desc: '結合多重技術指標，提供精準入市、目標及止蝕價',
  },
  {
    icon: Clock,
    title: '即時推介',
    desc: '訊號即時推送，把握最佳入場時機，不錯失每個機會',
  },
  {
    icon: Shield,
    title: '風險管理',
    desc: '每個推介均附止蝕位及信心指數，有效控制投資風險',
  },
];

const plans = [
  {
    name: '免費會員',
    price: '0',
    period: '永久',
    color: 'border-slate-200',
    badge: '',
    features: [
      '每日 1 個免費訊號',
      '基本技術分析',
      '訊號歷史記錄（7日）',
    ],
    cta: '免費註冊',
    href: '/register',
    highlight: false,
  },
  {
    name: '高級會員',
    price: MONTHLY_PRICE,
    period: '每月',
    color: 'border-amber-400',
    badge: '最受歡迎',
    features: [
      '每日全部 AI 訊號（5-10 個）',
      '深度 AI 技術分析',
      '即時 WhatsApp 推送',
      '完整訊號歷史記錄',
      '勝率統計報表',
      '專屬客服支援',
    ],
    cta: '立即訂閱',
    href: '/register',
    highlight: true,
  },
];

const testimonials = [
  {
    name: 'K.L. Chan',
    tag: '高級會員',
    text: '用了兩個月，勝率超過 70%，平均每個訊號賺 3-5%，非常值得！',
    stars: 5,
  },
  {
    name: 'Michael W.',
    tag: '高級會員',
    text: 'AI 訊號準確度高，有清晰止蝕位，幫我控制好風險，推薦！',
    stars: 5,
  },
  {
    name: 'S.Y. Lam',
    tag: '高級會員',
    text: 'WhatsApp 即時通知很方便，再唔會錯過好訊號，值回票價。',
    stars: 5,
  },
];

const stats = [
  { label: '平均月勝率', value: '72%' },
  { label: '平均每注回報', value: '+4.2%' },
  { label: '活躍會員', value: '1,800+' },
  { label: '訊號總數', value: '3,500+' },
];

export default function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white font-sans">
      {/* Navigation */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'bg-[#0a0e1a]/95 backdrop-blur border-b border-white/10 shadow-xl' : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-amber-400 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-[#0a0e1a]" />
              </div>
              <span className="text-lg font-bold text-white">{SITE_NAME}</span>
            </div>

            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-slate-300 hover:text-amber-400 transition-colors text-sm">
                功能
              </a>
              <a href="#pricing" className="text-slate-300 hover:text-amber-400 transition-colors text-sm">
                價格
              </a>
              <a href="#testimonials" className="text-slate-300 hover:text-amber-400 transition-colors text-sm">
                用戶評價
              </a>
              <Link
                href="/login"
                className="text-slate-300 hover:text-white transition-colors text-sm"
              >
                登入
              </Link>
              <Link
                href="/register"
                className="bg-amber-400 text-[#0a0e1a] px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-300 transition-colors"
              >
                免費開始
              </Link>
            </div>

            <button
              className="md:hidden text-white"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="md:hidden bg-[#0d1224] border-t border-white/10 px-4 py-4 space-y-3">
            <a href="#features" className="block text-slate-300 hover:text-amber-400 py-2 text-sm" onClick={() => setMenuOpen(false)}>功能</a>
            <a href="#pricing" className="block text-slate-300 hover:text-amber-400 py-2 text-sm" onClick={() => setMenuOpen(false)}>價格</a>
            <a href="#testimonials" className="block text-slate-300 hover:text-amber-400 py-2 text-sm" onClick={() => setMenuOpen(false)}>用戶評價</a>
            <Link href="/login" className="block text-slate-300 hover:text-white py-2 text-sm" onClick={() => setMenuOpen(false)}>登入</Link>
            <Link href="/register" className="block bg-amber-400 text-[#0a0e1a] px-4 py-2 rounded-lg text-sm font-semibold text-center" onClick={() => setMenuOpen(false)}>免費開始</Link>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-amber-400/5 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/4 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 right-1/4 w-[300px] h-[300px] bg-emerald-500/5 rounded-full blur-3xl" />
        </div>

        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
        />

        <div className="relative max-w-5xl mx-auto px-4 text-center">
          <div className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/30 rounded-full px-4 py-2 text-amber-400 text-sm mb-8">
            <Zap className="w-4 h-4" />
            <span>AI 驅動港股短炒訊號平台</span>
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black mb-6 leading-tight">
            <span className="text-white">每日精準</span>
            <br />
            <span className="text-amber-400">港股短炒訊號</span>
          </h1>

          <p className="text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            {SITE_NAME} 利用 AI 技術每日掃描全港股市，
            為您提供高勝算短炒推介，附帶入場價、目標價及止蝕位。
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/register"
              className="inline-flex items-center justify-center gap-2 bg-amber-400 text-[#0a0e1a] px-8 py-4 rounded-xl font-bold text-lg hover:bg-amber-300 transition-all hover:scale-105 shadow-lg shadow-amber-400/25"
            >
              免費開始使用
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center justify-center gap-2 bg-white/5 border border-white/10 text-white px-8 py-4 rounded-xl font-semibold text-lg hover:bg-white/10 transition-all"
            >
              了解更多
              <ChevronRight className="w-5 h-5" />
            </a>
          </div>

          <div className="mt-20 grid grid-cols-2 sm:grid-cols-4 gap-6">
            {stats.map((s) => (
              <div key={s.label} className="bg-white/5 border border-white/10 rounded-2xl p-5">
                <div className="text-3xl font-black text-amber-400 mb-1">{s.value}</div>
                <div className="text-slate-400 text-sm">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black text-white mb-4">
              為何選擇 <span className="text-amber-400">{SITE_NAME}</span>
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              結合人工智能與技術分析，為港股短炒者提供最全面的操盤支援
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-amber-400/40 hover:bg-white/[0.08] transition-all group"
                >
                  <div className="w-12 h-12 bg-amber-400/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-amber-400/20 transition-colors">
                    <Icon className="w-6 h-6 text-amber-400" />
                  </div>
                  <h3 className="text-white font-bold text-lg mb-2">{f.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Sample Signal */}
      <section className="py-16 bg-white/[0.02]">
        <div className="max-w-4xl mx-auto px-4">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-black text-white mb-3">訊號示例</h2>
            <p className="text-slate-400">每個訊號均包含完整操盤資訊</p>
          </div>

          <div className="bg-[#0d1224] border border-white/10 rounded-2xl overflow-hidden">
            <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full">買入</span>
                <span className="text-white font-bold text-lg">騰訊控股 (0700.HK)</span>
              </div>
              <span className="text-slate-400 text-sm">1-3日</span>
            </div>

            <div className="p-6 grid sm:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="text-slate-400 text-xs mb-1 uppercase tracking-wider">入場價</div>
                <div className="text-white text-2xl font-black">$385.00</div>
              </div>
              <div className="text-center">
                <div className="text-slate-400 text-xs mb-1 uppercase tracking-wider">目標價</div>
                <div className="text-emerald-400 text-2xl font-black">$402.00</div>
                <div className="text-emerald-400 text-xs">+4.4%</div>
              </div>
              <div className="text-center">
                <div className="text-slate-400 text-xs mb-1 uppercase tracking-wider">止蝕價</div>
                <div className="text-red-400 text-2xl font-black">$378.00</div>
                <div className="text-red-400 text-xs">-1.8%</div>
              </div>
            </div>

            <div className="px-6 pb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-sm">AI 信心指數</span>
                <span className="text-amber-400 font-bold">82%</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full">
                <div className="h-2 bg-gradient-to-r from-amber-400 to-amber-300 rounded-full" style={{ width: '82%' }} />
              </div>
            </div>

            <div className="px-6 pb-6">
              <p className="text-slate-400 text-sm leading-relaxed">
                技術分析：MACD 金叉確認，RSI 由超賣區回升至 45，成交量放大，突破 20 日均線壓力。短線上方目標看 $402 附近前高位。
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black text-white mb-4">
              簡單透明的<span className="text-amber-400">定價</span>
            </h2>
            <p className="text-slate-400 text-lg">選擇最適合您的方案</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`relative bg-[#0d1224] border-2 ${plan.color} rounded-2xl p-8 ${
                  plan.highlight ? 'shadow-xl shadow-amber-400/10' : ''
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-amber-400 text-[#0a0e1a] text-xs font-black px-4 py-1.5 rounded-full">
                      {plan.badge}
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-white font-bold text-xl mb-2">{plan.name}</h3>
                  <div className="flex items-end gap-1">
                    <span className="text-slate-400 text-lg">HK$</span>
                    <span className="text-white text-5xl font-black">{plan.price}</span>
                    <span className="text-slate-400 mb-1">/{plan.period}</span>
                  </div>
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-3">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span className="text-slate-300 text-sm">{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.href}
                  className={`block text-center py-3 rounded-xl font-bold transition-all ${
                    plan.highlight
                      ? 'bg-amber-400 text-[#0a0e1a] hover:bg-amber-300'
                      : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          {WHATSAPP && (
            <p className="text-center text-slate-400 text-sm mt-8">
              有疑問？
              <a
                href={`https://wa.me/${WHATSAPP}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:text-emerald-300 ml-1"
              >
                WhatsApp 聯絡我們
              </a>
            </p>
          )}
        </div>
      </section>

      {/* Testimonials */}
      <section id="testimonials" className="py-24 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black text-white mb-4">
              用戶<span className="text-amber-400">真實評價</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((t) => (
              <div
                key={t.name}
                className="bg-[#0d1224] border border-white/10 rounded-2xl p-6"
              >
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: t.stars }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-slate-300 text-sm leading-relaxed mb-4">
                  &ldquo;{t.text}&rdquo;
                </p>
                <div>
                  <div className="text-white font-semibold text-sm">{t.name}</div>
                  <div className="text-amber-400 text-xs">{t.tag}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-4xl font-black text-white mb-4">
            立即開始您的<span className="text-amber-400">港股之旅</span>
          </h2>
          <p className="text-slate-400 text-lg mb-10">
            免費註冊，即刻體驗 AI 港股訊號
          </p>
          <Link
            href="/register"
            className="inline-flex items-center gap-2 bg-amber-400 text-[#0a0e1a] px-10 py-4 rounded-xl font-bold text-xl hover:bg-amber-300 transition-all hover:scale-105 shadow-xl shadow-amber-400/25"
          >
            立即免費註冊
            <ArrowRight className="w-6 h-6" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 py-10">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-amber-400 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-[#0a0e1a]" />
            </div>
            <span className="text-white font-bold">{SITE_NAME}</span>
          </div>
          <p className="text-slate-500 text-sm text-center">
            免責聲明：本平台訊號僅供參考，不構成投資建議。投資涉及風險，請自行判斷。
          </p>
        </div>
      </footer>
    </div>
  );
}
