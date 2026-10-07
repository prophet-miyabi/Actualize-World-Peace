'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Wallet = {
  balance: number;
  ownerSharePercent: number;
  withdrawal: { available: boolean; reason: string };
  history: { id: string; amount: number; label: string; memo: string; createdAt: string }[];
  pages: { id: string; slug: string; businessName: string; monetizationEnabled: boolean; hidden: boolean; prClicks30d: number }[];
};

const yen = (n: number) => `${n < 0 ? '-' : ''}¥${Math.abs(n).toLocaleString('ja-JP')}`;

// キャッシュ: ページの収益化（PR枠）で生まれた報酬の分配を受け取り、AWPの有料機能に使える
export default function WalletPage() {
  const [w, setW] = useState<Wallet | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => setW((await api.get('/wallet')).data), []);
  useEffect(() => { load().catch(() => setError('読み込めませんでした。')); }, [load]);

  const toggle = async (p: Wallet['pages'][number]) => {
    setBusy(p.id);
    setError('');
    try {
      await api.put('/wallet/monetization', { lpId: p.id, enabled: !p.monetizationEnabled });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || '変更できませんでした。');
    } finally {
      setBusy(null);
    }
  };

  if (!w) return <main className="p-6 text-sm text-gray-400">{error || '読み込み中…'}</main>;

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <Link href="/dashboard" className="text-sm text-violet-700 font-bold">← ホーム</Link>

        <section className="rounded-3xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 text-white p-5 shadow-lg">
          <p className="text-xs opacity-90">キャッシュ残高</p>
          <p className="text-4xl font-black mt-1 tracking-tight">{yen(w.balance)}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Link href="/harness" className="rounded-2xl bg-white/20 px-3 py-2.5 font-bold text-center">Harnessの支払いに使う</Link>
            <span className="rounded-2xl bg-white/10 px-3 py-2.5 text-center opacity-80">出金は準備中</span>
          </div>
        </section>

        <section className="bg-white border rounded-2xl p-4">
          <h2 className="font-black">ページで収益化する（PR枠）</h2>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
            オンにすると、ページの下に「PR」と表示した提携サービスの紹介枠が出ます。紹介から生まれた報酬のうち、
            <span className="font-bold">{w.ownerSharePercent}%</span> があなたのキャッシュになります（提携先で報酬が確定したあとに反映）。
          </p>
          {w.pages.length === 0 ? (
            <p className="text-sm text-gray-500 mt-3">まだページがありません。<Link href="/builder" className="text-violet-700 underline">ページをつくる</Link></p>
          ) : (
            <ul className="mt-3 divide-y">
              {w.pages.map((p) => (
                <li key={p.id} className="py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate">{p.businessName}</p>
                    <p className="text-[11px] text-gray-500">/{p.slug}・PR枠のクリック（30日）{p.prClicks30d}回{p.hidden ? '・運営により非公開中' : ''}</p>
                  </div>
                  <button onClick={() => toggle(p)} disabled={busy === p.id} role="switch" aria-checked={p.monetizationEnabled} aria-label={`${p.businessName}の収益化`}
                    className={`relative w-12 h-7 shrink-0 rounded-full transition ${p.monetizationEnabled ? 'bg-violet-600' : 'bg-gray-300'}`}>
                    <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${p.monetizationEnabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-black mb-2">履歴</h2>
          {w.history.length === 0 ? (
            <p className="text-sm text-gray-500 bg-white border rounded-2xl p-4">まだ履歴はありません</p>
          ) : (
            <ul className="bg-white border rounded-2xl divide-y">
              {w.history.map((h) => (
                <li key={h.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-bold">{h.label}</span>
                    <span className="block text-[11px] text-gray-500 truncate">{h.memo}・{new Date(h.createdAt).toLocaleDateString('ja-JP')}</span>
                  </span>
                  <span className={`shrink-0 font-black ${h.amount >= 0 ? 'text-green-600' : 'text-gray-700'}`}>{h.amount >= 0 ? '+' : ''}{yen(h.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <section className="text-[11px] text-gray-500 leading-relaxed space-y-1">
          <p>・キャッシュは、AWPの有料機能の支払いに使えます。現金・他のポイントへの交換、他の人への譲渡はできません。</p>
          <p>・{w.withdrawal.reason}</p>
          <p>・提携先で報酬が取り消された場合、分配したキャッシュも取り消されます。</p>
          <p>・くわしくは<Link href="/terms" className="underline">利用規約</Link>をご確認ください。</p>
        </section>
      </div>
    </main>
  );
}
