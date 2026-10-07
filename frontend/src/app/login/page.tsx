'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import Logo from '@/components/Logo';

// 導線: LP（/）→ 新規登録（/login?mode=register）→ ウィザード（/wizard）で作成 → そのまま無料で公開
//       既存ユーザーは LP の「ログイン」→ ダッシュボード
export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // LPの「アカウントを作成」から来た場合は、新規登録の画面から始める
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mode') === 'register') setIsLogin(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/register';
      const { data } = await api.post(endpoint, form);
      localStorage.setItem('token', data.token);
      // 新規登録の直後はウィザードへ。ログインはダッシュボードへ
      router.push(isLogin ? '/dashboard' : '/wizard');
    } catch (err: any) {
      const status = err?.response?.status;
      setError(
        isLogin && status === 401
          ? 'メールアドレスまたはパスワードが違います。'
          : err?.response?.data?.error || '通信に失敗しました。時間をおいてお試しください。'
      );
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-gradient-to-b from-fuchsia-50 via-white to-sky-50">
      <Link href="/" className="mb-6"><Logo /></Link>
      <form onSubmit={handleSubmit} className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-100 w-full max-w-md">
        <h2 className="text-2xl font-black mb-2 text-center">{isLogin ? 'おかえりなさい！' : 'さあ、はじめよう！'}</h2>
        {!isLogin && (
          <p className="text-sm text-gray-500 text-center mb-6">
            アカウントの作成も、ページの公開も無料。3分くらいで、あなたのページができあがります。
          </p>
        )}
        {isLogin && <p className="text-sm text-gray-500 text-center mb-6">メールアドレスとパスワードでログイン</p>}
        {!isLogin && (
          <input type="text" placeholder="お名前（ニックネーム・活動名・お店の名前でもOK）" className="w-full mb-4 p-4 border rounded-2xl text-base" autoComplete="nickname"
            value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        )}
        <input type="email" placeholder="メールアドレス" className="w-full mb-4 p-4 border rounded-2xl text-base" autoComplete="email"
          value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input type="password" placeholder={isLogin ? 'パスワード' : 'パスワード（8文字以上）'} className="w-full mb-4 p-4 border rounded-2xl text-base"
          autoComplete={isLogin ? 'current-password' : 'new-password'} minLength={isLogin ? undefined : 8}
          value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-violet-200 disabled:opacity-50">
          {loading ? 'ちょっと待ってね…' : isLogin ? 'ログイン' : '無料ではじめる'}
        </button>
        {!isLogin && (
          <p className="text-xs text-gray-400 mt-4 text-center">
            作成すると<Link href="/privacy" className="underline">プライバシーポリシー</Link>に同意したものとみなされます。
          </p>
        )}
        <button type="button" className="mt-5 w-full text-center text-sm font-bold text-violet-600"
          onClick={() => { setIsLogin(!isLogin); setError(''); }}>
          {isLogin ? 'はじめての方はこちら（無料）' : 'アカウントをお持ちの方はログイン'}
        </button>
      </form>
      <Link href="/" className="text-sm text-gray-500 mt-6">← サービスの紹介へ戻る</Link>
    </div>
  );
}
