'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

// 利用者側の画面に出す小さな戻り先。
//  - テストユーザーに入れ替え中: 「運営者に戻る」（退避しておいた管理者のトークンに戻す）
//  - 管理者が自分のアカウントで見ている: 「運営者画面」
export default function AdminReturnPill() {
  const pathname = usePathname() || '/';
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'tester' | 'admin'>('none');

  useEffect(() => {
    // 運営者画面の中と、見本を iframe で描く画面（/showcase, /preview）には出さない
    if (pathname.startsWith('/admin') || pathname.startsWith('/showcase') || pathname.startsWith('/preview')) { setMode('none'); return; }
    let stop = false;
    try {
      if (localStorage.getItem('adminToken')) { setMode('tester'); return; }
      const t = localStorage.getItem('token');
      if (!t) { setMode('none'); return; }
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } }).then(async (r) => {
        if (stop) return;
        // 期限切れ・無効なトークンは捨てて、何も出さない（管理者としてログイン中のときだけ表示する）
        if (r.status === 401) { try { localStorage.removeItem('token'); localStorage.removeItem('adminToken'); } catch { /* 無視 */ } setMode('none'); return; }
        const d = await r.json().catch(() => ({}));
        setMode(d?.isAdmin === true ? 'admin' : 'none');
      }).catch(() => { if (!stop) setMode('none'); });
    } catch { setMode('none'); }
    return () => { stop = true; };
  }, [pathname]);

  if (mode === 'none') return null;
  const back = () => {
    try {
      const a = localStorage.getItem('adminToken');
      if (a) { localStorage.setItem('token', a); localStorage.removeItem('adminToken'); }
    } catch { /* 無視 */ }
    router.push('/admin');
  };
  return (
    <button onClick={back} className="fixed top-2 right-2 z-50 rounded-full bg-gray-900/85 text-white text-[11px] font-bold px-3 py-1.5 shadow-lg backdrop-blur">
      {mode === 'tester' ? '🧪 テスト中 → 運営者に戻る' : '運営者画面 →'}
    </button>
  );
}
