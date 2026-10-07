'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

type Addon = {
  id: string; key: string; harness: 'line' | 'x' | 'instagram'; name: string; description: string;
  priceYen: number | null; isInstall: boolean; enabled: boolean; sortOrder: number;
};
type Order = {
  id: string; items: { name: string; priceYen: number }[]; totalYen: number; note: string | null;
  status: string; paymentStatus: string; createdAt: string; user: { name: string; email: string };
};

const HARNESS_LABEL = { line: 'LINE', x: 'X', instagram: 'Instagram' } as const;
const STATUS = [['requested', '受付済み'], ['in_progress', '対応中'], ['done', '完了'], ['canceled', '取り消し']] as const;
const PAYMENT = [['unpaid', 'お支払い前'], ['not_required', '支払い不要'], ['paid', '支払い済み']] as const;
const EMPTY = { key: '', harness: 'line' as Addon['harness'], name: '', description: '', priceYen: '', isInstall: false, enabled: false, sortOrder: 0 };

// 運営者専用: Harness導入支援のメニュー（料金）と、ユーザーからの申し込みを管理する。
// 料金が空欄（未定）のメニューや、無効にしたメニューはユーザーに表示されない
export default function AdminHarnessPage() {
  const [addons, setAddons] = useState<Addon[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [a, o] = await Promise.all([api.get('/harness/admin/addons'), api.get('/harness/admin/orders')]);
    setAddons(a.data.addons);
    setOrders(o.data.orders);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e?.response?.status === 403 ? '管理者のみ利用できます。' : '読み込みに失敗しました。'));
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok = '') => {
    setError('');
    setMsg('');
    try {
      await fn();
      await load();
      if (ok) setMsg(ok);
    } catch (err: any) {
      setError(err?.response?.data?.error || '保存に失敗しました。');
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, priceYen: form.priceYen === '' ? null : Number(form.priceYen) };
    run(async () => {
      if (editingId) await api.put(`/harness/admin/addons/${editingId}`, body);
      else await api.post('/harness/admin/addons', body);
      setForm({ ...EMPTY });
      setEditingId(null);
    }, '保存しました。');
  };

  const edit = (a: Addon) => {
    setEditingId(a.id);
    setForm({ ...a, priceYen: a.priceYen === null ? '' : String(a.priceYen) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const input = 'mt-1 w-full border rounded-lg px-3 py-2 text-base';
  const set = (k: keyof typeof EMPTY, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <h1 className="text-2xl font-bold mt-3 mb-2">Harness導入支援（運営者用）</h1>
        <p className="text-sm text-gray-600 mb-6">料金を入力して「ユーザーに表示」をオンにしたメニューだけが、ユーザーの画面に出ます。導入メニューは 0 円にすると「無料」と表示されます。</p>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        {msg && <p className="text-emerald-700 text-sm mb-3">{msg}</p>}

        <h2 className="font-bold mb-2">申し込み（{orders.filter((o) => o.status === 'requested').length}件が未対応）</h2>
        {orders.length === 0 ? <p className="text-sm text-gray-500 mb-8">まだありません。</p> : (
          <ul className="space-y-2 mb-8">
            {orders.map((o) => (
              <li key={o.id} className="bg-white border rounded-xl p-4 text-sm">
                <div className="flex justify-between gap-2 flex-wrap">
                  <span className="font-bold">{o.user.name}（{o.user.email}）</span>
                  <span className="text-gray-500">{new Date(o.createdAt).toLocaleString('ja-JP')}</span>
                </div>
                <p className="mt-1">{o.items.map((i) => `${i.name}（${i.priceYen === 0 ? '無料' : `¥${i.priceYen.toLocaleString('ja-JP')}`}）`).join('、')}</p>
                <p className="font-bold mt-1">合計 ¥{o.totalYen.toLocaleString('ja-JP')}</p>
                {o.note && <p className="text-gray-600 mt-1 whitespace-pre-wrap">ご要望: {o.note}</p>}
                <div className="flex gap-3 mt-2 flex-wrap">
                  <select value={o.status} onChange={(e) => run(() => api.put(`/harness/admin/orders/${o.id}`, { status: e.target.value }))} className="border rounded-lg px-2 py-1">
                    {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <select value={o.paymentStatus} onChange={(e) => run(() => api.put(`/harness/admin/orders/${o.id}`, { paymentStatus: e.target.value }))} className="border rounded-lg px-2 py-1">
                    {PAYMENT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={save} className="bg-white p-4 rounded-xl border space-y-3 mb-6">
          <p className="font-bold">{editingId ? `編集中: ${form.name}` : 'メニューを追加'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">キー（英小文字・変更不可）<input className={input} value={form.key} disabled={!!editingId} onChange={(e) => set('key', e.target.value)} placeholder="line-bot" /></label>
            <label className="text-sm">対象
              <select className={input} value={form.harness} onChange={(e) => set('harness', e.target.value)}>
                <option value="line">LINE（L Harness）</option><option value="x">X（X Harness）</option><option value="instagram">Instagram（IG Harness）</option>
              </select>
            </label>
            <label className="text-sm">名前<input className={input} value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
            <label className="text-sm">料金（円・未定なら空欄）<input className={input} type="number" min={0} inputMode="numeric" value={form.priceYen} onChange={(e) => set('priceYen', e.target.value)} /></label>
          </div>
          <label className="block text-sm">説明（ユーザーに表示・事実のみ）<textarea className={input} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
          <div className="flex gap-5 text-sm flex-wrap">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.isInstall} onChange={(e) => set('isInstall', e.target.checked)} />導入メニュー</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />ユーザーに表示</label>
            <label className="flex items-center gap-2">並び順<input type="number" className="w-16 border rounded px-2 py-1" value={form.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} /></label>
          </div>
          <div className="flex gap-2">
            <button className="bg-blue-600 text-white font-bold px-4 py-2 rounded-lg">{editingId ? '更新する' : '追加する'}</button>
            {editingId && <button type="button" onClick={() => { setEditingId(null); setForm({ ...EMPTY }); }} className="px-4 py-2 text-gray-600">キャンセル</button>}
          </div>
        </form>

        <div className="flex justify-between items-center mb-2">
          <h2 className="font-bold">メニュー</h2>
          <button onClick={() => run(async () => {
            const { data } = await api.post('/harness/admin/addons/seed');
            setMsg(`標準メニューを${data.created}件追加しました（料金未設定・非表示）。`);
          })} className="text-sm text-blue-600 underline">標準メニューのたたき台を追加</button>
        </div>
        {!addons ? <p className="text-sm text-gray-500">読み込み中...</p> : addons.length === 0 ? <p className="text-sm text-gray-500">まだありません。</p> : (
          <ul className="space-y-2">
            {addons.map((a) => {
              const shown = a.enabled && a.priceYen !== null;
              return (
                <li key={a.id} className="bg-white border rounded-xl p-4 flex justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-bold">{HARNESS_LABEL[a.harness]}・{a.name}{a.isInstall ? '（導入）' : ''}</p>
                    <p className="text-gray-500 text-xs">
                      {a.priceYen === null ? '料金未設定' : a.priceYen === 0 ? '無料' : `¥${a.priceYen.toLocaleString('ja-JP')}`}・{shown ? 'ユーザーに表示中' : '非表示'}
                    </p>
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button onClick={() => edit(a)} className="text-blue-600">編集</button>
                    <button onClick={() => { if (window.confirm(`「${a.name}」を削除しますか？`)) run(() => api.delete(`/harness/admin/addons/${a.id}`)); }} className="text-red-600">削除</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
