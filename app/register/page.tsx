'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { TrendingUp, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || '玄金操盤手';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.fullName.trim()) return setError('請輸入姓名');
    if (!form.email.trim()) return setError('請輸入電郵');
    if (form.password.length < 8) return setError('密碼至少需要 8 個字元');
    if (form.password !== form.confirmPassword) return setError('兩次密碼輸入不一致');

    setLoading(true);
    const { error: signUpError } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: { full_name: form.fullName.trim() },
      },
    });

    setLoading(false);

    if (signUpError) {
      if (signUpError.message.includes('already registered')) {
        setError('此電郵已被註冊，請直接登入');
      } else {
        setError(signUpError.message);
      }
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push('/dashboard'), 1500);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center">
        <div className="text-center">
          <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">註冊成功！</h2>
          <p className="text-slate-400">正在跳轉至儀表板...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 bg-amber-400 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-[#0a0e1a]" />
            </div>
            <span className="text-xl font-bold text-white">{SITE_NAME}</span>
          </Link>
          <h1 className="text-3xl font-black text-white mb-2">免費註冊</h1>
          <p className="text-slate-400">即刻體驗 AI 港股訊號</p>
        </div>

        {/* Form */}
        <div className="bg-[#0d1224] border border-white/10 rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">姓名</label>
              <input
                type="text"
                name="fullName"
                value={form.fullName}
                onChange={handleChange}
                placeholder="你的名字"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30 transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">電郵地址</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="example@email.com"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30 transition-colors"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">密碼</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="至少 8 個字元"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30 transition-colors"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">確認密碼</label>
              <input
                type={showPassword ? 'text' : 'password'}
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="再次輸入密碼"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-400/50 focus:ring-1 focus:ring-amber-400/30 transition-colors"
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-400 text-[#0a0e1a] py-3 rounded-xl font-bold text-base hover:bg-amber-300 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  註冊中...
                </>
              ) : (
                '免費註冊'
              )}
            </button>
          </form>

          <p className="text-center text-slate-400 text-sm mt-6">
            已有帳戶？
            <Link href="/login" className="text-amber-400 hover:text-amber-300 ml-1 font-medium">
              立即登入
            </Link>
          </p>
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">
          註冊即代表您同意我們的服務條款及私隱政策
        </p>
      </div>
    </div>
  );
}
