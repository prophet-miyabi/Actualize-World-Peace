'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';

type Order = {
  code: string; items: { name: string; priceYen: number; qty: number }[]; subtotalYen: number; shippingYen: number; totalYen: number;
  paymentMethod: 'bank' | 'in_person'; status: 'awaiting_payment' | 'paid' | 'shipped' | 'completed' | 'canceled';
  expiresAt: string | null; paidAt: string | null; shippedAt: string | null; sellerNote: string | null; createdAt: string; buyerName: string;
  lp: { slug: string; businessName: string };
};
type Bank = { bank: string; branch: string; type: string; number: string; holder: string };

const STATUS: Record<Order['status'], { label: string; cls: string }> = {
  awaiting_payment: { label: 'お支払い待ち', cls: 'bg-amber-100 text-amber-700' },
  paid: { label: 'お支払い確認済み', cls: 'bg-sky-100 text-sky-700' },
  shipped: { label: '発送・お渡し済み', cls: 'bg-violet-100 text-violet-700' },
  completed: { label: '完了', cls: 'bg-green-100 text-green-700' },
  canceled: { label: '取り消し', cls: 'bg-gray-100 text-gray-500' }
};
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

// 注文の状況（受付番号を知っている人だけが開けるページ。検索エンジンには載せない）
export default function OrderStatusPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [d, setD] = useState<{ order: Order; bank: Bank | null; inPersonNote: string | null } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/shop/orders/status/${encodeURIComponent(code)}`);
    if (!r.ok) throw new Error();
    setD(await r.json());
  }, [code]);
  useEffect(() => { load().catch(() => setError('注文が見つかりませんでした。')); }, [load]);

  const cancel = async () => {
    if (!confirm('この注文を取り消しますか？')) return;
    const r = await fetch(`/api/shop/orders/status/${encodeURIComponent(code)}/cancel`, { method: 'POST' });
    if (!r.ok) setError((await r.json().catch(() => ({}))).error || '取り消せませんでした。');
    await load();
  };

  if (!d) return <main className="p-6 text-sm text-gray-500">{error || '読み込み中…'}</main>;
  const { order: o, bank } = d;
  const st = STATUS[o.status];

  return (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-sky-50 text-gray-900">
      <meta name="robots" content="noindex" />
      <div className="max-w-md mx-auto px-4 py-10 space-y-4">
        <div>
          <p className="text-xs text-gray-500">ご注文</p>
          <h1 className="text-2xl font-black">{o.lp.businessName}</h1>
        </div>
        <div className="bg-white rounded-3xl border p-5 space-y-3">
          <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${st.cls}`}>{st.label}</span>
          <ul className="text-sm divide-y">
            {o.items.map((it, i) => <li key={i} className="py-2 flex justify-between gap-3"><span>{it.name} × {it.qty}</span><span>{yen(it.priceYen * it.qty)}</span></li>)}
            {o.shippingYen > 0 && <li className="py-2 flex justify-between"><span>送料</span><span>{yen(o.shippingYen)}</span></li>}
            <li className="py-2 flex justify-between font-black"><span>合計</span><span>{yen(o.totalYen)}</span></li>
          </ul>
          {o.sellerNote && <p className="text-sm bg-gray-50 rounded-xl p-3 whitespace-pre-wrap"><span className="block text-[11px] text-gray-500 mb-1">お店からのメッセージ</span>{o.sellerNote}</p>}
        </div>

        {o.status === 'awaiting_payment' && o.paymentMethod === 'bank' && bank && (
          <div className="bg-white rounded-3xl border-2 border-amber-300 p-5 space-y-2 text-sm">
            <p className="font-black">お振込のお願い</p>
            <p>{o.expiresAt && `${new Date(o.expiresAt).toLocaleDateString('ja-JP')}までに`} <span className="font-black">{yen(o.totalYen)}</span> を、{o.lp.businessName}の口座へお振り込みください。期限を過ぎると自動で取り消されます。</p>
            <dl className="bg-gray-50 rounded-xl p-3 space-y-1">
              <div className="flex gap-3"><dt className="w-16 text-gray-500">銀行</dt><dd className="font-bold">{bank.bank} {bank.branch}</dd></div>
              <div className="flex gap-3"><dt className="w-16 text-gray-500">口座</dt><dd className="font-bold">{bank.type} {bank.number}</dd></div>
              <div className="flex gap-3"><dt className="w-16 text-gray-500">名義</dt><dd className="font-bold">{bank.holder}</dd></div>
            </dl>
            <p className="text-[11px] text-gray-500">⚠ お振込先はこのページに表示された口座だけです。メールやSNSで別の口座を案内された場合は、振り込まずにページの「通報」からお知らせください。AWPは代金を預かりません。</p>
          </div>
        )}
        {o.status === 'awaiting_payment' && o.paymentMethod === 'in_person' && (
          <div className="bg-white rounded-3xl border p-5 text-sm">
            <p className="font-black">お支払いはお店で</p>
            <p className="mt-1">{d.inPersonNote || 'お店でお受け取りの際にお支払いください。'}</p>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {o.status === 'awaiting_payment' && (
          <button onClick={cancel} className="w-full rounded-full border border-gray-300 py-3 text-sm text-gray-600">この注文を取り消す</button>
        )}
        <div className="text-center text-sm space-y-1">
          <Link href={`/shop/${o.lp.slug}/legal`} className="block text-violet-700 underline">特定商取引法に基づく表記</Link>
          <Link href={`/${o.lp.slug}`} className="block font-bold text-violet-700">{o.lp.businessName}のページへ</Link>
        </div>
      </div>
    </main>
  );
}
