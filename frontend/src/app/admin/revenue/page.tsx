'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Event = {
  id: string; toolKey: string; slug: string | null; grossYen: number; ownerYen: number; platformYen: number;
  occurredOn: string; externalRef: string | null; note: string | null; status: 'recorded' | 'reversed'; createdAt: string;
};
type Data = {
  totals: { receivableYen: number; platformRevenueYen: number; cashSalesYen: number; userCashOutstandingYen: number };
  events: Event[];
  tools: { key: string; name: string; revenueShareAllowed: boolean }[];
  clicks30d: { toolKey: string; slug: string | null; count: number }[];
};

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
// 日付の初期値は端末の現地時間の「今日」（toISOString は UTC のため、日本の午前中に前日になってしまう）
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const EMPTY = { toolKey: '', slug: '', grossYen: '', occurredOn: today(), externalRef: '', note: '' };

// 運営者専用: ASP・広告主の管理画面で「確定」した報酬を記録し、ページの持ち主に 78% を分配する。
// 記録は台帳（複式簿記）に残り、書き換えはできない（誤りは「取り消し」で逆仕訳）
export default function AdminRevenuePage() {
  const [d, setD] = useState<Data | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setD((await api.get('/wallet/admin/revenue')).data), []);
  useEffect(() => {
    load().catch((e) => setError(e?.response?.status === 403 ? '管理者のみ利用できます。' : '読み込みに失敗しました。'));
  }, [load]);

  const gross = Number(form.grossYen) || 0;
  const owner = form.slug ? Math.floor((gross * 78) / 100) : 0;

  const record = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm(`${yen(gross)} を記録します（${form.slug ? `/${form.slug} の持ち主に ${yen(owner)}・AWP ${yen(gross - owner)}` : 'AWPの収益として全額'}）。よろしいですか？`)) return;
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await api.post('/wallet/admin/revenue', { ...form, grossYen: gross });
      setForm({ ...EMPTY });
      setMsg('記録しました。');
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || '記録できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  const reverse = async (ev: Event) => {
    if (!confirm(`この記録（${yen(ev.grossYen)}）を取り消しますか？分配したキャッシュも差し引かれます。`)) return;
    try {
      await api.post(`/wallet/admin/revenue/${ev.id}/reverse`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || '取り消せませんでした。');
    }
  };

  const input = 'mt-1 w-full border rounded-lg px-3 py-2 text-base';

  return (
    <div className="px-4 py-6 md:px-8 max-w-3xl">
      <h1 className="text-2xl font-black">収益と分配</h1>
      <p className="text-sm text-gray-600 mt-1">
        ASPの管理画面で<span className="font-bold">確定</span>した報酬だけを記録してください（発生・未確定の報酬は記録しない）。ページのURLを入れると、持ち主に78%がキャッシュとして分配されます。
      </p>

      {d && (
        <div className="grid grid-cols-2 gap-3 mt-5">
          {[
            ['AWPの収益（分配後）', d.totals.platformRevenueYen],
            ['入金待ちの報酬', d.totals.receivableYen],
            ['利用者のキャッシュ残高合計', d.totals.userCashOutstandingYen],
            ['キャッシュでの売上', d.totals.cashSalesYen]
          ].map(([label, v]) => (
            <div key={label as string} className="bg-white border rounded-xl p-3">
              <p className="text-[11px] text-gray-500">{label}</p>
              <p className="text-lg font-black">{yen(v as number)}</p>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={record} className="bg-white border rounded-2xl p-4 mt-6 space-y-3">
        <h2 className="font-bold">確定した報酬を記録</h2>
        <label className="block text-sm">提携ツール
          <select className={input} value={form.toolKey} onChange={(e) => setForm({ ...form, toolKey: e.target.value })} required>
            <option value="">選んでください</option>
            {d?.tools.map((t) => <option key={t.key} value={t.key}>{t.name}{t.revenueShareAllowed ? '（分配OK）' : ''}</option>)}
          </select>
        </label>
        <label className="block text-sm">ページのURL（PR枠からの成果の場合。AWP自身の紹介なら空欄）
          <input className={input} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.trim().toLowerCase() })} placeholder="例: midoriya" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">確定した報酬額（円）
            <input className={input} type="number" inputMode="numeric" min={1} value={form.grossYen} onChange={(e) => setForm({ ...form, grossYen: e.target.value })} required />
          </label>
          <label className="block text-sm">確定日
            <input className={input} type="date" value={form.occurredOn} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} required />
          </label>
        </div>
        <label className="block text-sm">ASPの成果ID（二重記録の防止に使います）
          <input className={input} value={form.externalRef} onChange={(e) => setForm({ ...form, externalRef: e.target.value })} />
        </label>
        <label className="block text-sm">メモ（任意）
          <input className={input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        {gross > 0 && (
          <p className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2">
            分配: {form.slug ? `持ち主 ${yen(owner)} / AWP ${yen(gross - owner)}` : `AWP ${yen(gross)}`}
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-green-700">{msg}</p>}
        <button disabled={busy} className="rounded-full bg-violet-600 text-white font-bold px-6 py-2.5 disabled:opacity-40">記録する</button>
      </form>

      {d && d.clicks30d.length > 0 && (
        <section className="mt-8">
          <h2 className="font-bold text-sm mb-2">紹介リンクのクリック（30日）</h2>
          <ul className="bg-white border rounded-xl divide-y text-sm">
            {d.clicks30d.sort((a, b) => b.count - a.count).map((c, i) => (
              <li key={i} className="px-4 py-2 flex justify-between gap-3">
                <span className="truncate">{c.toolKey}{c.slug ? `（/${c.slug} のPR枠）` : ''}</span>
                <span className="shrink-0 font-bold">{c.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-bold text-sm mb-2">記録</h2>
        {!d || d.events.length === 0 ? <p className="text-sm text-gray-500">まだ記録はありません。</p> : (
          <ul className="bg-white border rounded-xl divide-y text-sm">
            {d.events.map((ev) => (
              <li key={ev.id} className={`px-4 py-3 ${ev.status === 'reversed' ? 'opacity-50' : ''}`}>
                <div className="flex justify-between gap-3">
                  <span className="font-bold">{ev.toolKey}{ev.slug ? `・/${ev.slug}` : ''}</span>
                  <span className="shrink-0 font-black">{yen(ev.grossYen)}</span>
                </div>
                <div className="flex justify-between gap-3 text-xs text-gray-500 mt-0.5">
                  <span>{new Date(ev.occurredOn).toLocaleDateString('ja-JP')}・持ち主 {yen(ev.ownerYen)} / AWP {yen(ev.platformYen)}{ev.externalRef ? `・${ev.externalRef}` : ''}</span>
                  {ev.status === 'reversed' ? <span>取り消し済み</span> : <button onClick={() => reverse(ev)} className="text-red-600 underline shrink-0">取り消す</button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
