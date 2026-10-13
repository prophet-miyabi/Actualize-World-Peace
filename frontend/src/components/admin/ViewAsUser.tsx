'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

// 運営者が「利用者の視点」でシステム全体を試すための切り替え。
//  - ユーザーとして試す: 自分（管理者）のアカウントのまま、利用者側の画面（ホーム）へ
//  - 新規ユーザー視点で試す: 専用のテストアカウントに入れ替える（管理者のトークンは退避し、いつでも戻れる）
export default function ViewAsUser({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const asTester = async (reset: boolean) => {
    if (reset && !confirm('テストユーザーのページ・投稿・予約などを全部消して、まっさらな新規ユーザーとして始めます。よろしいですか？')) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/admin/test-user', { reset });
      const adminToken = localStorage.getItem('token');
      if (adminToken) localStorage.setItem('adminToken', adminToken);
      localStorage.setItem('token', data.token);
      router.push(reset ? '/wizard' : '/feed');
    } catch (e: any) { setError(e?.response?.data?.error || '切り替えできませんでした。'); } finally { setBusy(false); }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-xs">
        <Link href="/feed" className="text-violet-700 font-bold">👤 ユーザーとして試す</Link>
        <button onClick={() => asTester(false)} disabled={busy} className="text-gray-500 underline disabled:opacity-40">🧪 新規ユーザー視点</button>
      </div>
    );
  }
  return (
    <div className="px-5 py-4 border-t text-sm space-y-2">
      <p className="text-[11px] font-bold text-gray-500">利用者の視点で試す</p>
      <Link href="/feed" className="block rounded-xl bg-violet-50 text-violet-800 font-bold px-3 py-2">👤 自分のアカウントでユーザー画面へ</Link>
      <button onClick={() => asTester(false)} disabled={busy} className="w-full text-left rounded-xl border px-3 py-2 disabled:opacity-40">🧪 テストユーザーとして入る<span className="block text-[11px] text-gray-500 font-normal">管理者の特典なし。いつでも「運営者に戻る」で戻れます</span></button>
      <button onClick={() => asTester(true)} disabled={busy} className="w-full text-left rounded-xl border px-3 py-2 disabled:opacity-40">🆕 まっさらな新規ユーザーとして始める<span className="block text-[11px] text-gray-500 font-normal">テストユーザーのデータを消してウィザードから</span></button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
