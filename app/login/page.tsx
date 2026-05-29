'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { TrendingUp, Eye, EyeOff, Loader2 } from 'lucide-react';

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'AI短炒神器';

export default function LoginPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.email.trim()) return setError('請輸入電郵');
    if (!form.password) return setError('請輸入密碼');

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: form.email.trim(),
      password: form.password,
    });
    setLoading(false);

    if (signInError) {
      if (signInError.message.includes('Invalid login credentials')) {
        setError('電郵或密碼不正確，請重試');
      } else {
        setError(signInError.message);
      }
      return;
    }

    router.push('/dashboard');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-10 h-10 bg-amber-400 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-[#0a0e1a]" />
            </div>
            <span className="text-xl font-bold text-white">{SITE_NAME}</span>
          </Link>
          <h1 className="text-3xl font-black text-white mb-2">歡迎回來</h1>
          <p className="text-slate-400">登入查看最新港股訊號</p>
        </div>

        <div className="bg-[#0d1224] border border-white/10 rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
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
                  placeholder="輸入密碼"
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
                  登入中...
                </>
              ) : (
                '登入'
              )}
            </button>
          </form>

          <p className="text-center text-slate-400 text-sm mt-6">
            未有帳戶？
            <Link href="/register" className="text-amber-400 hover:text-amber-300 ml-1 font-medium">
              免費註冊
            </Link>
          </p>
        </div>

        <div className="text-center mt-4">
          <Link href="/" className="text-slate-500 hover:text-slate-400 text-sm transition-colors">
            返回主頁
          </Link>
        </div>
      </div>
    </div>
  );
}
