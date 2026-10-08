'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Order = {
  id: string; code: string; items: { name: string; priceYen: number; qty: number }[]; totalYen: number; shippingYen: number;
  paymentMethod: 'bank' | 'in_person'; buyerName: string; buyerContact: string; shipping: { postal: string; address: string; name: string } | null;
  message: string | null; status: 'awaiting_payment' | 'paid' | 'shipped' | 'completed' | 'canceled'; expiresAt: string | null;
  sellerNote: string | null; createdAt: string; lp: { slug: string; businessName: string };
};

const STATUS: Record<Order['status'], { label: string; cls: string }> = {
  awaiting_payment: { label: '入金待ち', cls: 'bg-amber-100 text-amber-700' },
  paid: { label: '入金済み', cls: 'bg-sky-100 text-sky-700' },
  shipped: { label: '発送済み', cls: 'bg-violet-100 text-violet-700' },
  completed: { label: '完了', cls: 'bg-green-100 text-green-700' },
  canceled: { label: '取り消し', cls: 'bg-gray-100 text-gray-500' }
};
const NEXT: Partial<Record<Order['status'], { action: string; label: string }>> = {
  awaiting_payment: { action: 'paid', label: '入金を確認した' },
  paid: { action: 'shipped', label: '発送・お渡しした' },
  shipped: { action: 'completed', label: '取引を完了にする' }
};
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

// 注文の管理（直接払い）: 入金の確認 → 発送 → 完了。お客様の「注文の状況」ページに反映される
export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => setOrders((await api.get('/shop/orders')).data.orders), []);
  useEffect(() => { load().catch(() => setError('読み込めませんでした。')); }, [load]);

  const act = async (o: Order, action: string) => {
    if (action === 'cancel' && !confirm('この注文を取り消しますか？在庫は戻ります。')) return;
    if (action === 'paid' && !confirm(`${o.buyerName}さんから ${yen(o.totalYen)} の入金を確認しましたか？`)) return;
    setError('');
    try {
      await api.put(`/shop/orders/${o.id}`, { action, sellerNote: notes[o.id] ?? o.sellerNote ?? '' });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || '更新できませんでした。');
    }
  };

  if (!orders) return <main className="p-6 text-sm text-gray-400">{error || '読み込み中…'}</main>;
  const list = orders.filter((o) => filter === 'all' || !['completed', 'canceled'].includes(o.status));

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-4">
        <Link href="/dashboard" className="text-sm text-violet-700 font-bold">← ホーム</Link>
        <div className="flex items-end justify-between">
          <h1 className="text-2xl font-black">注文</h1>
          <Link href="/shop-settings" className="text-xs font-bold text-violet-700">ショップの設定</Link>
        </div>
        <div className="flex gap-2">
          {(['open', 'all'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-4 py-1.5 text-xs font-bold ${filter === f ? 'bg-gray-900 text-white' : 'bg-white border'}`}>{f === 'open' ? '対応中' : 'すべて'}</button>
          ))}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {list.length === 0 ? <p className="text-sm text-gray-500 bg-white border rounded-2xl p-5 text-center">注文はまだありません</p> : (
          <ul className="space-y-3">
            {list.map((o) => {
              const next = NEXT[o.status];
              return (
                <li key={o.id} className="bg-white border rounded-2xl p-4 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-black">{yen(o.totalYen)} <span className="text-xs font-normal text-gray-500">{o.paymentMethod === 'bank' ? '銀行振込' : '店頭・手渡し'}</span></p>
                      <p className="text-xs text-gray-500">{new Date(o.createdAt).toLocaleString('ja-JP')}・{o.lp.businessName}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                  </div>
                  <ul className="mt-2 text-xs text-gray-700">{o.items.map((it, i) => <li key={i}>・{it.name} × {it.qty}（{yen(it.priceYen * it.qty)}）</li>)}{o.shippingYen > 0 && <li>・送料 {yen(o.shippingYen)}</li>}</ul>
                  <div className="mt-2 bg-gray-50 rounded-xl p-3 text-xs space-y-0.5">
                    <p className="font-bold">{o.buyerName}さん</p>
                    <a href={o.buyerContact.includes('@') ? `mailto:${o.buyerContact}` : `tel:${o.buyerContact.replace(/[^0-9+]/g, '')}`} className="text-violet-700 underline break-all">{o.buyerContact}</a>
                    {o.shipping && <p className="break-words">〒{o.shipping.postal} {o.shipping.address}（{o.shipping.name}）</p>}
                    {o.message && <p className="whitespace-pre-wrap">💬 {o.message}</p>}
                  </div>
                  {o.status === 'awaiting_payment' && o.expiresAt && <p className="text-[11px] text-amber-700 mt-1">振込期限 {new Date(o.expiresAt).toLocaleDateString('ja-JP')}（過ぎると自動で取り消し）</p>}
                  {!['completed', 'canceled'].includes(o.status) && (
                    <>
                      <input className="mt-2 w-full border rounded-xl px-3 py-2 text-base" placeholder="お客様へのひとこと（注文の状況ページに表示）" maxLength={300}
                        value={notes[o.id] ?? o.sellerNote ?? ''} onChange={(e) => setNotes({ ...notes, [o.id]: e.target.value })} />
                      <div className="flex gap-2 mt-2">
                        {next && <button onClick={() => act(o, next.action)} className="flex-1 rounded-full bg-gray-900 text-white font-bold py-2">{next.label}</button>}
                        {['awaiting_payment', 'paid'].includes(o.status) && <button onClick={() => act(o, 'cancel')} className="rounded-full border px-4 py-2 text-gray-600">取り消す</button>}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-gray-500">お客様の名前・連絡先・住所は、この取引のためだけに使ってください。完了・取り消しから約1年で自動で削除されます。</p>
      </div>
    </main>
  );
}
