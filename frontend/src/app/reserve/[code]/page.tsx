'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';

type Booking = {
  menu: string | null; requestedAt: string; status: 'requested' | 'confirmed' | 'declined' | 'canceled'; ownerNote: string | null;
  createdAt: string; lp: { slug: string; businessName: string };
};

const STATUS: Record<Booking['status'], { label: string; cls: string; text: string }> = {
  requested: { label: '返事待ち', cls: 'bg-amber-100 text-amber-700', text: 'お店からの返事を待っています。このページで確認できます。' },
  confirmed: { label: '予約確定', cls: 'bg-green-100 text-green-700', text: '予約が確定しました！当日お待ちしています。' },
  declined: { label: 'お受けできませんでした', cls: 'bg-gray-100 text-gray-600', text: 'ごめんなさい、この日時ではお受けできませんでした。別の日時でリクエストしてね。' },
  canceled: { label: '取り消し済み', cls: 'bg-gray-100 text-gray-600', text: 'この予約リクエストは取り消されました。' }
};

// 予約リクエストの状況確認（受付番号を知っている人だけが開けるページ。検索エンジンには載せない）
export default function ReservePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [b, setB] = useState<Booking | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/bookings/status/${encodeURIComponent(code)}`);
    if (!r.ok) throw new Error();
    setB((await r.json()).booking);
  }, [code]);
  useEffect(() => { load().catch(() => setError('予約リクエストが見つかりませんでした。')); }, [load]);

  const cancel = async () => {
    if (!confirm('この予約リクエストを取り消しますか？')) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/bookings/status/${encodeURIComponent(code)}/cancel`, { method: 'POST' });
      if (!r.ok) setError((await r.json().catch(() => ({}))).error || '取り消せませんでした。');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!b) return <main className="p-6 text-sm text-gray-500">{error || '読み込み中…'}</main>;
  const st = STATUS[b.status];

  return (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-sky-50 text-gray-900">
      <meta name="robots" content="noindex" />
      <div className="max-w-md mx-auto px-4 py-10">
        <p className="text-xs text-gray-500">予約リクエスト</p>
        <h1 className="text-2xl font-black mt-1">{b.lp.businessName}</h1>
        <div className="mt-5 bg-white rounded-3xl border p-5 space-y-3">
          <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${st.cls}`}>{st.label}</span>
          <p className="text-sm text-gray-700">{st.text}</p>
          <dl className="text-sm divide-y">
            <div className="py-2 flex justify-between gap-3"><dt className="text-gray-500">希望日時</dt><dd className="font-bold">{new Date(b.requestedAt).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })}</dd></div>
            {b.menu && <div className="py-2 flex justify-between gap-3"><dt className="text-gray-500">メニュー</dt><dd className="font-bold">{b.menu}</dd></div>}
            <div className="py-2 flex justify-between gap-3"><dt className="text-gray-500">送った日</dt><dd>{new Date(b.createdAt).toLocaleDateString('ja-JP')}</dd></div>
          </dl>
          {b.ownerNote && <p className="text-sm bg-gray-50 rounded-xl p-3 whitespace-pre-wrap"><span className="block text-[11px] text-gray-500 mb-1">お店からのメッセージ</span>{b.ownerNote}</p>}
        </div>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        {(b.status === 'requested' || b.status === 'confirmed') && (
          <button onClick={cancel} disabled={busy} className="mt-4 w-full rounded-full border border-gray-300 py-3 text-sm text-gray-600">予約リクエストを取り消す</button>
        )}
        <Link href={`/${b.lp.slug}`} className="mt-6 block text-center text-sm font-bold text-violet-700">{b.lp.businessName}のページへ</Link>
      </div>
    </main>
  );
}
