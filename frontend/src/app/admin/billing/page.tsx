'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Payment = {
  id: string; plan: string; months: number; amountYen: number; method: string; reference: string; status: string;
  expiresAt: string | null; createdAt: string; user: { name: string; email: string };
};
type Config = { baseUsd: number; usdJpy: number; freeAiUsd: number; multipliers: { lite: number; standard: number; pro: number } };
type Prices = Record<'lite' | 'standard' | 'pro', { label: string; priceYen: number; aiYen: number; platformYen: number }>;
type Bank = { bank: string; branch: string; type: string; number: string; holder: string };

const STATUS: Record<string, string> = { pending: '振込待ち', confirmed: '確認済み', canceled: '取り消し', expired: '期限切れ' };
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

// 運営者専用: 有料プランの振込の確認・料金の設定・AWPの振込先
export default function AdminBillingPage() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [bank, setBank] = useState<Bank>({ bank: '', branch: '', type: '普通', number: '', holder: '' });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/plans/admin');
    setPayments(data.payments);
    setConfig(data.config);
    setPrices(data.prices);
    if (data.bank) setBank(data.bank);
  }, []);
  useEffect(() => { load().catch((e) => setError(e?.response?.status === 403 ? '管理者のみ利用できます。' : '読み込みに失敗しました。')); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError('');
    setMsg('');
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || '処理できませんでした。');
    }
  };

  const input = 'mt-1 w-full border rounded-lg px-3 py-2 text-base';
  if (!payments || !config) return <div className="p-6 text-sm text-gray-500">{error || '読み込み中…'}</div>;
  const open = payments.filter((p) => p.status === 'pending' || p.status === 'expired');

  return (
    <div className="px-4 py-6 md:px-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-black">プランと請求</h1>
        <p className="text-sm text-gray-600 mt-1">AWPの有料プランの支払い（銀行振込）を確認して有効化します。振込名義の先頭の番号（AWP〜）で照合してください。</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-green-700">{msg}</p>}

      <section>
        <h2 className="font-bold text-sm mb-2">振込の確認待ち（{open.length}）</h2>
        {open.length === 0 ? <p className="text-sm text-gray-500 bg-white border rounded-xl p-4">確認待ちはありません</p> : (
          <ul className="space-y-2">
            {open.map((p) => (
              <li key={p.id} className="bg-white border-2 border-amber-200 rounded-2xl p-4 text-sm">
                <p className="font-black text-lg">{p.reference}　{yen(p.amountYen)}</p>
                <p>{p.user.name}（{p.user.email}）・{prices?.[p.plan as keyof Prices]?.label}プラン {p.months}か月</p>
                <p className="text-xs text-gray-500">申し込み {new Date(p.createdAt).toLocaleString('ja-JP')}・期限 {p.expiresAt ? new Date(p.expiresAt).toLocaleDateString('ja-JP') : '-'}{p.status === 'expired' ? '（期限切れ）' : ''}</p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => confirm(`${p.reference} の ${yen(p.amountYen)} の入金を確認しましたか？プランを有効にします。`) && run(() => api.post(`/plans/admin/payments/${p.id}/confirm`), '有効にしました。')}
                    className="rounded-full bg-green-600 text-white font-bold px-5 py-2">入金を確認・有効化</button>
                  <button onClick={() => run(() => api.post(`/plans/admin/payments/${p.id}/cancel`), '取り消しました。')} className="rounded-full border px-5 py-2 text-gray-600">取り消す</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white border rounded-2xl p-4 space-y-3">
        <h2 className="font-bold">料金の設定</h2>
        <p className="text-xs text-gray-500">月額 = 基準（Claude Pro の月額・ドル）× 倍率 × 為替。料金の78%を利用者のAI利用枠、22%を運営の取り分にします。</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>基準（ドル/月）<input className={input} type="number" step="0.01" value={config.baseUsd} onChange={(e) => setConfig({ ...config, baseUsd: Number(e.target.value) })} /></label>
          <label>為替（円/ドル）<input className={input} type="number" value={config.usdJpy} onChange={(e) => setConfig({ ...config, usdJpy: Number(e.target.value) })} /></label>
          {(['lite', 'standard', 'pro'] as const).map((k) => (
            <label key={k}>{prices?.[k].label}の倍率<input className={input} type="number" step="0.1" value={config.multipliers[k]} onChange={(e) => setConfig({ ...config, multipliers: { ...config.multipliers, [k]: Number(e.target.value) } })} /></label>
          ))}
          <label>フリーのAI利用枠（ドル/月）<input className={input} type="number" step="0.1" value={config.freeAiUsd} onChange={(e) => setConfig({ ...config, freeAiUsd: Number(e.target.value) })} /></label>
        </div>
        {prices && (
          <ul className="text-sm bg-gray-50 rounded-xl p-3 space-y-1">
            {(['lite', 'standard', 'pro'] as const).map((k) => (
              <li key={k}>{prices[k].label}: {yen(prices[k].priceYen)}/月（AI枠 {yen(prices[k].aiYen)}・運営 {yen(prices[k].platformYen)}）</li>
            ))}
          </ul>
        )}
        <button onClick={() => run(() => api.put('/plans/admin/config', config), '料金を保存しました。')} className="rounded-full bg-violet-600 text-white font-bold px-5 py-2">保存（表示中の価格は保存後に更新）</button>
      </section>

      <section className="bg-white border rounded-2xl p-4 space-y-3">
        <h2 className="font-bold">AWPの振込先（有料プランの支払い先）</h2>
        <p className="text-xs text-gray-500">暗号化して保存し、振込で申し込んだ人にだけ表示します。</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label>銀行名<input className={input} value={bank.bank} onChange={(e) => setBank({ ...bank, bank: e.target.value })} /></label>
          <label>支店名<input className={input} value={bank.branch} onChange={(e) => setBank({ ...bank, branch: e.target.value })} /></label>
          <label>種別<select className={input} value={bank.type} onChange={(e) => setBank({ ...bank, type: e.target.value })}><option>普通</option><option>当座</option></select></label>
          <label>口座番号<input className={input} inputMode="numeric" value={bank.number} onChange={(e) => setBank({ ...bank, number: e.target.value })} /></label>
          <label className="col-span-2">口座名義（カナ）<input className={input} value={bank.holder} onChange={(e) => setBank({ ...bank, holder: e.target.value })} /></label>
        </div>
        <button onClick={() => run(() => api.put('/plans/admin/bank', bank), '振込先を保存しました。')} className="rounded-full bg-violet-600 text-white font-bold px-5 py-2">保存</button>
      </section>
    </div>
  );
}
