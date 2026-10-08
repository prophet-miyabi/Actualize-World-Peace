'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Tier = { key: 'lite' | 'standard' | 'pro'; label: string; priceYen: number; aiYen: number; platformYen: number };
type Bank = { bank: string; branch: string; type: string; number: string; holder: string };
type Payment = { id: string; plan: string; months: number; amountYen: number; method: string; reference: string; status: string; expiresAt: string | null; createdAt: string; bank?: Bank | null };
type Data = {
  plans: Tier[];
  free: { aiYen: number };
  basis: { baseUsd: number; usdJpy: number; aiShare: number };
  current: { plan: string; label: string; until: string | null; legacyStripe: boolean };
  isAdmin?: boolean;
  quota: { usedYen: number; allowanceYen: number | null; exceeded: boolean };
  methods: { bank: boolean; cash: number };
  months: number[];
  payments: Payment[];
};

// 説明は実際の設定値から作る（倍率は管理画面で変えられるため、固定の文言にしない）
function features(t: Tier, plans: Tier[]) {
  const i = plans.findIndex((p) => p.key === t.key);
  if (i === 0) return ['独自ドメインで公開（どのドメインでも）', 'LINEの自動応答・SNS連携などの有料機能'];
  const prev = plans[i - 1];
  const ratio = Math.round((t.aiYen / Math.max(1, prev.aiYen)) * 10) / 10;
  return [`${prev.label}のすべて`, `AIの利用枠が${prev.label}の約${ratio}倍`];
}
const STATUS: Record<string, string> = { pending: '振込待ち', confirmed: '支払い済み', canceled: '取り消し', expired: '期限切れ' };
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

// 有料プラン: 料金の78%をあなたのAIの利用枠に、22%をAWPの運営に。支払いは銀行振込かキャッシュ（決済手数料なし）
export default function PlansPage() {
  const [d, setD] = useState<Data | null>(null);
  const [selected, setSelected] = useState<Tier['key'] | null>(null);
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => setD((await api.get('/plans')).data), []);
  useEffect(() => { load().catch(() => setError('読み込めませんでした。')); }, [load]);

  const buy = async (method: 'bank' | 'cash') => {
    if (!selected) return;
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await api.post('/plans/purchase', { plan: selected, months, method });
      setMsg(method === 'cash' ? 'プランが有効になりました 🎉' : '申し込みました。下の振込先に、期限までにお振り込みください。');
      setSelected(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || '申し込めませんでした。');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (p: Payment) => {
    if (!confirm('この申し込みを取り消しますか？')) return;
    await api.post(`/plans/payments/${p.id}/cancel`).catch(() => {});
    await load();
  };

  if (!d) return <main className="p-6 text-sm text-gray-400">{error || '読み込み中…'}</main>;
  const pending = d.payments.find((p) => p.status === 'pending');
  const tier = d.plans.find((t) => t.key === selected);
  const total = tier ? tier.priceYen * months : 0;
  const usedPct = d.quota.allowanceYen ? Math.min(100, Math.round((d.quota.usedYen / Math.max(1, d.quota.allowanceYen)) * 100)) : 0;

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <Link href="/dashboard" className="text-sm text-violet-700 font-bold">← ホーム</Link>
        <div>
          <h1 className="text-2xl font-black">プラン</h1>
          <p className="text-xs text-gray-500 mt-1">ページの作成・公開・SNS・ショップはずっと無料。もっとAIを使いたい人と、独自ドメインで公開したい人のための有料プランです。</p>
        </div>

        {d.isAdmin && (
          <p className="text-xs rounded-xl bg-violet-50 text-violet-800 p-3">管理者としてログイン中：料金・AIの利用枠・1日の回数制限はすべて通過できます。Harnessの申し込みも支払い不要になります。</p>
        )}
        <section className="rounded-3xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 text-white p-5">
          <p className="text-xs opacity-90">いまのプラン</p>
          <p className="text-2xl font-black">{d.current.label}{d.current.until && d.current.plan !== 'free' ? <span className="text-sm font-bold">（{new Date(d.current.until).toLocaleDateString('ja-JP')}まで）</span> : ''}</p>
          <p className="text-xs mt-3 opacity-90">今月のAIの利用</p>
          {d.quota.allowanceYen === null ? <p className="text-sm font-bold">管理者のため上限なし</p> : (
            <>
              <div className="mt-1 h-2 rounded-full bg-white/30 overflow-hidden"><div className="h-full bg-white" style={{ width: `${usedPct}%` }} /></div>
              <p className="text-xs mt-1">約{yen(d.quota.usedYen)} / {yen(d.quota.allowanceYen)} {d.quota.exceeded && '（使い切りました）'}</p>
            </>
          )}
        </section>

        <section className="space-y-3">
          {d.plans.map((t) => (
            <button key={t.key} onClick={() => setSelected(t.key)}
              className={`w-full text-left bg-white rounded-2xl p-4 border-2 transition ${selected === t.key ? 'border-violet-500 shadow-md' : 'border-gray-100'}`}>
              <div className="flex items-baseline justify-between">
                <p className="font-black text-lg">{t.label}</p>
                <p className="font-black text-xl">{yen(t.priceYen)}<span className="text-xs font-bold text-gray-500">/月</span></p>
              </div>
              <p className="text-xs text-violet-700 font-bold mt-1">AIの利用枠 約{yen(t.aiYen)}/月</p>
              <ul className="text-xs text-gray-600 mt-2 space-y-0.5">{features(t, d.plans).map((f) => <li key={f}>・{f}</li>)}</ul>
            </button>
          ))}
          <p className="text-[11px] text-gray-500 leading-relaxed">
            料金は Claude の Pro プラン（月額${d.basis.baseUsd}、1ドル={d.basis.usdJpy}円で換算）を基準にしています。
            料金の<span className="font-bold">{d.basis.aiShare}%</span>をあなたのAIの利用枠（AIのトークンの消費にかかる費用）に充て、残り{100 - d.basis.aiShare}%がAWPの運営費です。
            フリーでも毎月 約{yen(d.free.aiYen)} 分のAIが使えます。利用額は公開されているAIの料金からの見積もりです。
          </p>
        </section>

        {selected && tier && (
          <section className="bg-white border rounded-2xl p-4 space-y-3">
            <p className="font-black">{tier.label}プランに申し込む</p>
            <div className="flex gap-2 flex-wrap">
              {d.months.map((m) => (
                <button key={m} onClick={() => setMonths(m)} className={`rounded-full px-4 py-2 text-sm font-bold ${months === m ? 'bg-gray-900 text-white' : 'bg-white border text-gray-600'}`}>{m}か月</button>
              ))}
            </div>
            <p className="text-sm">お支払い金額: <span className="font-black text-lg">{yen(total)}</span>（{months * 30}日間）</p>
            {d.current.plan !== 'free' && d.current.plan !== selected && <p className="text-[11px] text-gray-500">いまのプランの残り期間は、金額で換算して新しいプランの期間に足します。</p>}
            {d.isAdmin && (
              <button disabled={busy} onClick={() => buy('cash')} className="w-full rounded-full bg-gray-900 text-white font-bold py-3 disabled:opacity-40">
                管理者: 支払いなしで有効にする（テスト・運営用）
              </button>
            )}
            <div className="grid gap-2">
              <button disabled={busy || d.methods.cash < total} onClick={() => buy('cash')}
                className="rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold py-3 disabled:opacity-40">
                キャッシュで支払う（残高 {yen(d.methods.cash)}）
              </button>
              <button disabled={busy || !d.methods.bank || !!pending} onClick={() => buy('bank')}
                className="rounded-full border-2 border-gray-900 font-bold py-3 disabled:opacity-40">
                銀行振込で支払う{!d.methods.bank ? '（準備中）' : pending ? '（振込待ちの申し込みがあります）' : ''}
              </button>
            </div>
            <p className="text-[11px] text-gray-500">決済会社を通さないため、決済手数料はかかりません（振込手数料はご負担ください）。自動更新はありません。期限が近づいたら、また申し込んでください。</p>
          </section>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-green-700 font-bold">{msg}</p>}

        {pending?.bank && (
          <section className="bg-white border-2 border-amber-300 rounded-2xl p-4 text-sm space-y-2">
            <p className="font-black">お振込のお願い</p>
            <p>{pending.expiresAt && `${new Date(pending.expiresAt).toLocaleDateString('ja-JP')}までに`}、<span className="font-black">{yen(pending.amountYen)}</span> を次の口座にお振り込みください。</p>
            <dl className="bg-gray-50 rounded-xl p-3 space-y-1">
              <div className="flex gap-3"><dt className="w-20 text-gray-500">銀行</dt><dd className="font-bold">{pending.bank.bank} {pending.bank.branch}</dd></div>
              <div className="flex gap-3"><dt className="w-20 text-gray-500">口座</dt><dd className="font-bold">{pending.bank.type} {pending.bank.number}</dd></div>
              <div className="flex gap-3"><dt className="w-20 text-gray-500">名義</dt><dd className="font-bold">{pending.bank.holder}</dd></div>
              <div className="flex gap-3"><dt className="w-20 text-gray-500">振込名義</dt><dd className="font-black text-violet-700">{pending.reference} あなたのお名前</dd></div>
            </dl>
            <p className="text-xs text-gray-600">振込名義の先頭に、必ず <span className="font-bold">{pending.reference}</span> を付けてください。運営者が入金を確認すると、プランが有効になります（通常1〜2営業日）。</p>
            <button onClick={() => cancel(pending)} className="text-xs text-gray-500 underline">この申し込みを取り消す</button>
          </section>
        )}

        {d.payments.filter((p) => p.status !== 'pending').length > 0 && (
          <section>
            <h2 className="font-bold text-sm mb-2">支払いの履歴</h2>
            <ul className="bg-white border rounded-2xl divide-y text-sm">
              {d.payments.filter((p) => p.status !== 'pending').map((p) => (
                <li key={p.id} className="px-4 py-3 flex justify-between gap-3">
                  <span>{d.plans.find((t) => t.key === p.plan)?.label}・{p.months}か月・{p.method === 'cash' ? 'キャッシュ' : '振込'}</span>
                  <span className="shrink-0 text-xs">{yen(p.amountYen)}・{STATUS[p.status] ?? p.status}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
