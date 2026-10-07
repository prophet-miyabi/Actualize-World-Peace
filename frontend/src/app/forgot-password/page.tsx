'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import Logo from '@/components/Logo';

// パスワード再設定: メールアドレス → 登録した携帯にSMSで届くコード＋新しいパスワード。
// 再設定すると、ほかの端末のログインはすべて解除される
const inputCls = 'w-full mb-4 p-4 border rounded-2xl text-base';
const primaryBtn = 'w-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-violet-200 disabled:opacity-50';

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const errorOf = (err: any) => err?.response?.data?.error || '通信に失敗しました。時間をおいてお試しください。';

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/password-reset/start', { email: email.trim() });
      setResetToken(data.resetToken);
      setCode('');
    } catch (err: any) {
      setError(errorOf(err));
    } finally {
      setLoading(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/password-reset/verify', { resetToken, code: code.trim(), newPassword });
      localStorage.setItem('token', data.token);
      router.push('/dashboard');
    } catch (err: any) {
      setError(errorOf(err));
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-gradient-to-b from-fuchsia-50 via-white to-sky-50">
      <Link href="/" className="mb-6"><Logo /></Link>
      <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-100 w-full max-w-md">
        {!resetToken ? (
          <form onSubmit={sendCode}>
            <h2 className="text-2xl font-black mb-2 text-center">パスワードの再設定</h2>
            <p className="text-sm text-gray-500 text-center mb-6">登録したメールアドレスを入力してください。登録した携帯電話に、SMSで確認コードを送ります。</p>
            <input type="email" placeholder="メールアドレス" className={inputCls} autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
            <button type="submit" disabled={loading} className={primaryBtn}>{loading ? 'ちょっと待ってね…' : 'SMSで確認コードを受け取る'}</button>
          </form>
        ) : (
          <form onSubmit={reset}>
            <h2 className="text-2xl font-black mb-2 text-center">新しいパスワードを決めよう</h2>
            <p className="text-sm text-gray-500 text-center mb-6">
              登録があれば、携帯電話にSMSで確認コードが届きます。数分たっても届かないときは、メールアドレスを確認してもう一度お試しください。
            </p>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10}
              placeholder="確認コード（6桁）" className={`${inputCls} text-center tracking-[0.5em] text-xl`}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
            <input type="password" placeholder="新しいパスワード（8文字以上）" className={inputCls} autoComplete="new-password" minLength={8}
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
            <button type="submit" disabled={loading || code.length < 4} className={primaryBtn}>{loading ? 'ちょっと待ってね…' : 'パスワードを変更する'}</button>
            <p className="text-xs text-gray-500 mt-3 text-center">変更すると、ほかの端末ではログアウトされます。</p>
            <div className="flex justify-between mt-5 text-sm">
              <button type="button" onClick={() => { setResetToken(null); setError(''); }} className="text-gray-500">← メールアドレスを直す</button>
              <button type="button" onClick={() => sendCode()} disabled={loading} className="font-bold text-violet-600 disabled:opacity-50">コードを再送する</button>
            </div>
          </form>
        )}
      </div>
      <Link href="/login" className="text-sm text-gray-500 mt-6">← ログインに戻る</Link>
    </div>
  );
}
