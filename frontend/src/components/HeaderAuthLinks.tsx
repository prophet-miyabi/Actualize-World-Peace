'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

// トップページ右上のリンク。ログイン状態で出し分ける（サーバー描画では分からないため、表示後に確認する）
//  - 未ログイン: ログイン / はじめる
//  - ログイン中: マイページ（管理者なら「運営者画面」も）
export default function HeaderAuthLinks({ signupHref }: { signupHref: string }) {
  const [state, setState] = useState<'unknown' | 'guest' | 'user' | 'admin'>('unknown');
  useEffect(() => {
    let stop = false;
    try {
      const t = localStorage.getItem('token');
      if (!t) { setState('guest'); return; }
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } }).then(async (r) => {
        if (stop) return;
        if (r.status === 401) {
          // 期限切れ・無効なトークンは捨てる（「ログインしていないのに運営者画面が出る」を防ぐ）
          try { localStorage.removeItem('token'); localStorage.removeItem('adminToken'); } catch { /* 無視 */ }
          setState('guest'); return;
        }
        const d = await r.json().catch(() => ({}));
        setState(d?.isAdmin ? 'admin' : d?.id ? 'user' : 'guest');
      }).catch(() => { if (!stop) setState('guest'); });
    } catch { setState('guest'); }
    return () => { stop = true; };
  }, []);

  if (state === 'user' || state === 'admin') {
    return (
      <>
        {state === 'admin' && <Link href="/admin" className="hidden sm:inline text-gray-600 hover:text-gray-900">運営者画面</Link>}
        <Link href="/me" className="inline-block bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold rounded-full shadow-lg shadow-violet-200 hover:brightness-110 transition px-5 py-2">マイページ</Link>
      </>
    );
  }
  return (
    <>
      <Link href="/login" className={`font-bold ${state === 'unknown' ? 'invisible' : ''}`}>ログイン</Link>
      <Link href={signupHref} className="inline-block bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold rounded-full shadow-lg shadow-violet-200 hover:brightness-110 transition px-5 py-2">はじめる</Link>
    </>
  );
}
