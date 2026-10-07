'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import Logo from '@/components/Logo';

// 導線: LP（/）→ 新規登録（/login?mode=register）→ SMSの確認コード → ウィザード（/wizard）→ そのまま無料で公開
//       既存ユーザーは LP の「ログイン」→ ダッシュボード
const inputCls = 'w-full mb-4 p-4 border rounded-2xl text-base';
const primaryBtn = 'w-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-violet-200 disabled:opacity-50';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ email: '', password: '', name: '', phone: '' });
  // 新規登録で確認コードを送ったあとの状態
  const [pending, setPending] = useState<{ token: string; maskedPhone: string | null } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // LPの「無料ではじめる」から来た場合は、新規登録の画面から始める
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mode') === 'register') setIsLogin(false);
  }, []);

  const errorOf = (err: any) => err?.response?.data?.error || '通信に失敗しました。時間をおいてお試しください。';

  const finish = (token: string, to: string) => {
    localStorage.setItem('token', token);
    router.push(to);
  };

  const login = async () => {
    try {
      const { data } = await api.post('/auth/login', { email: form.email, password: form.password });
      finish(data.token, '/dashboard');
    } catch (err: any) {
      setError(err?.response?.status === 401 ? 'メールアドレスまたはパスワードが違います。' : errorOf(err));
      setLoading(false);
    }
  };

  // 新規登録ステップ1: SMSで確認コードを送る（SMS未設定の環境では、そのままアカウントを作る）
  const startRegister = async () => {
    try {
      const { data } = await api.post('/auth/register/start', form);
      if (!data.codeRequired) {
        const { data: done } = await api.post('/auth/register/verify', { pendingToken: data.pendingToken });
        finish(done.token, '/wizard');
        return;
      }
      setPending({ token: data.pendingToken, maskedPhone: data.maskedPhone });
      setCode('');
      setNotice(`${data.maskedPhone} にSMSで確認コードを送りました。`);
      setLoading(false);
    } catch (err: any) {
      setError(errorOf(err));
      setLoading(false);
    }
  };

  // 新規登録ステップ2: 届いたコードを確認してアカウントを作る
  const verifyRegister = async () => {
    try {
      const { data } = await api.post('/auth/register/verify', { pendingToken: pending!.token, code: code.trim() });
      finish(data.token, '/wizard');
    } catch (err: any) {
      setError(errorOf(err));
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (isLogin) await login();
    else if (pending) await verifyRegister();
    else await startRegister();
  };

  const resend = async () => {
    setError('');
    setNotice('');
    setLoading(true);
    await startRegister();
  };

  const switchMode = () => {
    setIsLogin(!isLogin);
    setPending(null);
    setError('');
    setNotice('');
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-gradient-to-b from-fuchsia-50 via-white to-sky-50">
      <Link href="/" className="mb-6"><Logo /></Link>
      <form onSubmit={handleSubmit} className="bg-white p-6 sm:p-8 rounded-3xl shadow-sm border border-gray-100 w-full max-w-md">
        {pending ? (
          <>
            <h2 className="text-2xl font-black mb-2 text-center">コードを入力してね</h2>
            <p className="text-sm text-gray-500 text-center mb-6">{notice || 'SMSで届いた6桁のコードを入力してください。'}</p>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10}
              placeholder="確認コード（6桁）" className={`${inputCls} text-center tracking-[0.5em] text-xl`}
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus />
            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
            <button type="submit" disabled={loading || code.length < 4} className={primaryBtn}>
              {loading ? 'ちょっと待ってね…' : '確認して登録する'}
            </button>
            <div className="flex justify-between mt-5 text-sm">
              <button type="button" onClick={() => { setPending(null); setError(''); setNotice(''); }} className="text-gray-500">← 入力に戻る</button>
              <button type="button" onClick={resend} disabled={loading} className="font-bold text-violet-600 disabled:opacity-50">コードを再送する</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-black mb-2 text-center">{isLogin ? 'おかえりなさい！' : 'さあ、はじめよう！'}</h2>
            <p className="text-sm text-gray-500 text-center mb-6">
              {isLogin ? 'メールアドレスとパスワードでログイン' : 'アカウントの作成も、ページの公開も無料。3分くらいで、あなたのページができあがります。'}
            </p>
            {!isLogin && (
              <input type="text" placeholder="お名前（ニックネーム・活動名・お店の名前でもOK）" className={inputCls} autoComplete="nickname"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            )}
            <input type="email" placeholder="メールアドレス" className={inputCls} autoComplete="email"
              value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <input type="password" placeholder={isLogin ? 'パスワード' : 'パスワード（8文字以上）'} className={inputCls}
              autoComplete={isLogin ? 'current-password' : 'new-password'} minLength={isLogin ? undefined : 8}
              value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            {!isLogin && (
              <>
                <input type="tel" inputMode="tel" placeholder="携帯電話番号（例: 090-1234-5678）" className={`${inputCls} mb-1`} autoComplete="tel-national"
                  value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
                <p className="text-xs text-gray-500 mb-4 px-1">なりすまし防止のため、SMSで確認コードを送ります。番号が公開されることはありません。</p>
              </>
            )}
            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
            <button type="submit" disabled={loading} className={primaryBtn}>
              {loading ? 'ちょっと待ってね…' : isLogin ? 'ログイン' : 'SMSで確認コードを受け取る'}
            </button>
            {isLogin && (
              <Link href="/forgot-password" className="block mt-4 text-center text-sm text-gray-500 underline">パスワードを忘れた方</Link>
            )}
            {!isLogin && (
              <p className="text-xs text-gray-400 mt-4 text-center">
                作成すると<Link href="/terms" className="underline">利用規約</Link>と<Link href="/privacy" className="underline">プライバシーポリシー</Link>に同意したものとみなされます。
              </p>
            )}
            <button type="button" className="mt-5 w-full text-center text-sm font-bold text-violet-600" onClick={switchMode}>
              {isLogin ? 'はじめての方はこちら（無料）' : 'アカウントをお持ちの方はログイン'}
            </button>
          </>
        )}
      </form>
      <Link href="/" className="text-sm text-gray-500 mt-6">← サービスの紹介へ戻る</Link>
    </div>
  );
}
