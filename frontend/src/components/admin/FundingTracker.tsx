'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

// 雅テック 資金トラッカー（オーナー決定 2026-10-23）: 年内 300 万円 → 2027 年初頭に 3,300 万円の融資。
// 受託の案件（提案中・成約・入金）は管理者が入力し、AWP 側の収益（確定報酬の AWP 分・プラン売上）は台帳から自動で足す。
type Deal = { id: string; client: string; pkg: 'ume' | 'take' | 'matsu' | 'custom'; amountYen: number; maintenanceYen: number; status: 'proposed' | 'signed' | 'paid' | 'lost'; proposedOn?: string | null; signedOn?: string | null; paidOn?: string | null; note?: string | null };
type Tracker = { deals: Deal[]; loan: { status: 'preparing' | 'consulting' | 'applied' | 'approved' | 'executed'; lender: string; note: string }; evidence: Record<string, boolean> };
type View = {
  targets: { selfCapitalYen: number; selfCapitalBy: string; dealsTarget: number; maintenanceTarget: number; loanYen: number; loanApplyBy: string; loanBy: string };
  evidenceList: { key: string; label: string }[]; tracker: Tracker;
  progress: { paidYen: number; signedYen: number; awpYen: number; totalYen: number; pct: number; remainingYen: number; signedDeals: number; paidDeals: number; proposedDeals: number; maintenanceCount: number; selfCapitalRatioPct: number; daysLeft: number };
};
const PKG: Record<Deal['pkg'], { label: string; price: number }> = { ume: { label: '梅（LP）', price: 150000 }, take: { label: '竹（LP＋LINE）', price: 350000 }, matsu: { label: '松（フル）', price: 600000 }, custom: { label: '個別見積', price: 0 } };
const STATUS: Record<Deal['status'], string> = { proposed: '提案中', signed: '成約', paid: '入金済み', lost: '見送り' };
const LOAN: Record<Tracker['loan']['status'], string> = { preparing: '準備中（エビデンス集め）', consulting: '事前相談中', applied: '申請済み', approved: '承認', executed: '実行済み' };
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const EMPTY: Deal = { id: '', client: '', pkg: 'take', amountYen: 350000, maintenanceYen: 0, status: 'proposed', proposedOn: today(), note: '' };
const input = 'mt-1 w-full border rounded-lg px-3 py-2 text-base';

export default function FundingTracker() {
  const [v, setV] = useState<View | null>(null);
  const [form, setForm] = useState<Deal>({ ...EMPTY });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setV((await api.get('/intelligence/funding-tracker')).data), []);
  useEffect(() => { load().catch(() => setError('資金トラッカーを読み込めませんでした。')); }, [load]);

  const save = async (t: Tracker) => {
    setBusy(true); setError('');
    try { setV((await api.put('/intelligence/funding-tracker', t)).data); } catch (e: any) { setError(e?.response?.data?.error || '保存できませんでした。'); } finally { setBusy(false); }
  };
  const addDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v) return;
    const d: Deal = { ...form, id: form.id || `d${Date.now().toString(36)}`, amountYen: Number(form.amountYen) || 0, maintenanceYen: Number(form.maintenanceYen) || 0 };
    await save({ ...v.tracker, deals: [...v.tracker.deals.filter((x) => x.id !== d.id), d] });
    setForm({ ...EMPTY, proposedOn: today() });
  };
  const setStatus = async (d: Deal, status: Deal['status']) => {
    if (!v) return;
    const patch: Partial<Deal> = { status };
    if (status === 'signed' && !d.signedOn) patch.signedOn = today();
    if (status === 'paid') { patch.paidOn = d.paidOn || today(); if (!d.signedOn) patch.signedOn = today(); }
    await save({ ...v.tracker, deals: v.tracker.deals.map((x) => (x.id === d.id ? { ...x, ...patch } : x)) });
  };
  const removeDeal = async (d: Deal) => { if (v && confirm(`「${d.client}」を一覧から消しますか？`)) await save({ ...v.tracker, deals: v.tracker.deals.filter((x) => x.id !== d.id) }); };
  const toggleEvidence = async (key: string) => { if (v) await save({ ...v.tracker, evidence: { ...v.tracker.evidence, [key]: !v.tracker.evidence[key] } }); };
  const setLoan = async (patch: Partial<Tracker['loan']>) => { if (v) await save({ ...v.tracker, loan: { ...v.tracker.loan, ...patch } }); };

  if (!v) return <section className="bg-white border rounded-2xl p-4 mt-5 text-sm text-gray-500">{error || '資金トラッカーを読み込み中…'}</section>;
  const p = v.progress; const t = v.targets;
  const evidenceDone = v.evidenceList.filter((e) => v.tracker.evidence[e.key]).length;
  return (
    <section className="bg-white border-2 border-violet-200 rounded-2xl p-4 mt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-black">雅テック 資金トラッカー</h2>
        <span className="text-xs text-gray-500">{t.selfCapitalBy} まで あと {p.daysLeft} 日</span>
      </div>
      <p className="text-xs text-gray-600 mt-1">年内に <b>{yen(t.selfCapitalYen)}</b>（受託の入金 + AWP の収益）→ {t.loanApplyBy} までに融資を申請 → {t.loanBy} までに <b>{yen(t.loanYen)}</b> の実行。数字は入力した事実と台帳の実績だけで、見込みは含めません。</p>

      <div className="mt-3">
        <div className="flex justify-between text-xs font-bold"><span>{yen(p.totalYen)}</span><span>{p.pct}%・残り {yen(p.remainingYen)}</span></div>
        <div className="h-3 rounded-full bg-gray-100 mt-1 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500" style={{ width: `${p.pct}%` }} /></div>
        <p className="text-[11px] text-gray-500 mt-1">内訳: 受託の入金 {yen(p.paidYen)} / AWP の収益 {yen(p.awpYen)}（成約済み・未入金 {yen(p.signedYen - p.paidYen)} は含めていません）</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-sm">
        {[['成約', `${p.signedDeals} / ${t.dealsTarget} 件`], ['入金済み', `${p.paidDeals} 件`], ['月額保守', `${p.maintenanceCount} / ${t.maintenanceTarget} 件`], ['自己資金比率', `${p.selfCapitalRatioPct}%`]].map(([l, x]) => (
          <div key={l} className="rounded-xl bg-gray-50 p-3"><p className="text-[11px] text-gray-500">{l}</p><p className="font-black">{x}</p></div>
        ))}
      </div>

      <form onSubmit={addDeal} className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <label className="col-span-2">案件名（会社・店名）<input className={input} value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} required /></label>
        <label>パッケージ<select className={input} value={form.pkg} onChange={(e) => { const pkg = e.target.value as Deal['pkg']; setForm({ ...form, pkg, amountYen: PKG[pkg].price || form.amountYen }); }}>{(Object.keys(PKG) as Deal['pkg'][]).map((k) => <option key={k} value={k}>{PKG[k].label}</option>)}</select></label>
        <label>金額（税別・円）<input type="number" inputMode="numeric" min={0} className={input} value={form.amountYen} onChange={(e) => setForm({ ...form, amountYen: Number(e.target.value) })} required /></label>
        <label>月額保守（円・なければ 0）<input type="number" inputMode="numeric" min={0} className={input} value={form.maintenanceYen} onChange={(e) => setForm({ ...form, maintenanceYen: Number(e.target.value) })} /></label>
        <label>状態<select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Deal['status'] })}>{(Object.keys(STATUS) as Deal['status'][]).map((k) => <option key={k} value={k}>{STATUS[k]}</option>)}</select></label>
        <label className="col-span-2">メモ（任意）<input className={input} value={form.note ?? ''} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        <div className="col-span-2"><button disabled={busy} className="rounded-full bg-violet-600 text-white font-bold px-6 py-2.5 disabled:opacity-40">案件を記録</button></div>
      </form>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}

      {v.tracker.deals.length > 0 && (
        <ul className="mt-4 border rounded-xl divide-y text-sm">
          {v.tracker.deals.slice().sort((a, b) => (b.signedOn ?? b.proposedOn ?? '').localeCompare(a.signedOn ?? a.proposedOn ?? '')).map((d) => (
            <li key={d.id} className={`px-3 py-2 ${d.status === 'lost' ? 'opacity-50' : ''}`}>
              <div className="flex justify-between gap-2"><span className="font-bold min-w-0 truncate">{d.client} <span className="font-normal text-xs text-gray-500">{PKG[d.pkg].label}</span></span><span className="shrink-0 font-black">{yen(d.amountYen)}</span></div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-600">
                <select className="rounded-full border px-2 py-0.5" value={d.status} onChange={(e) => setStatus(d, e.target.value as Deal['status'])}>{(Object.keys(STATUS) as Deal['status'][]).map((k) => <option key={k} value={k}>{STATUS[k]}</option>)}</select>
                {d.maintenanceYen > 0 && <span>保守 {yen(d.maintenanceYen)}/月</span>}
                {d.signedOn && <span>成約 {d.signedOn}</span>}{d.paidOn && <span>入金 {d.paidOn}</span>}{d.note && <span className="truncate">{d.note}</span>}
                <button type="button" onClick={() => removeDeal(d)} className="ml-auto text-red-600 underline">消す</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="font-bold">融資（{yen(t.loanYen)}）</p>
          <select className={input} value={v.tracker.loan.status} onChange={(e) => setLoan({ status: e.target.value as Tracker['loan']['status'] })}>{(Object.keys(LOAN) as Tracker['loan']['status'][]).map((k) => <option key={k} value={k}>{LOAN[k]}</option>)}</select>
          <input className={input} value={v.tracker.loan.lender} onChange={(e) => setLoan({ lender: e.target.value })} placeholder="相談先" />
          <textarea className={`${input} min-h-[60px]`} defaultValue={v.tracker.loan.note} onBlur={(e) => { if (e.target.value !== v.tracker.loan.note) void setLoan({ note: e.target.value }); }} placeholder="相談のメモ（担当者・必要書類・次回）" />
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="font-bold">審査のエビデンス {evidenceDone}/{v.evidenceList.length}</p>
          <ul className="mt-1 space-y-1 text-xs">
            {v.evidenceList.map((e) => <li key={e.key}><label className="flex items-start gap-2"><input type="checkbox" checked={!!v.tracker.evidence[e.key]} onChange={() => toggleEvidence(e.key)} className="mt-0.5" /><span>{e.label}</span></label></li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}
