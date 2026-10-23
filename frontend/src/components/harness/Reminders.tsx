'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import MessageSpecEditor from './MessageSpecEditor';
import { specSummary, type MessageSpec } from '@/lib/harness';

// リマインダー: 予約の希望日時（またはシナリオ登録）から「前日の同時刻」「3 時間前」などに自動で送る
type Reminder = { id: string; name: string; basis: string; basisRef: string | null; offsetMinutes: number; message: MessageSpec; active: boolean; sentCount: number };
type Refs = { scenarios: { id: string; name: string }[]; surveys: { id: string; name: string }[]; myPath: string };
const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-base';
const btn = 'rounded-full bg-violet-600 text-white text-sm font-bold px-5 py-2 disabled:opacity-40';
const PRESETS = [{ label: '前日の同時刻', min: -1440 }, { label: '3 時間前', min: -180 }, { label: '1 時間前', min: -60 }, { label: '翌日（お礼）', min: 1440 }, { label: '3 日後', min: 4320 }];
const offsetLabel = (m: number) => (m === 0 ? '同時刻' : `${m < 0 ? '' : ''}${Math.abs(m) % 1440 === 0 ? `${Math.abs(m) / 1440} 日` : Math.abs(m) % 60 === 0 ? `${Math.abs(m) / 60} 時間` : `${Math.abs(m)} 分`}${m < 0 ? '前' : '後'}`);

export default function Reminders({ refs }: { refs: Refs }) {
  const [rows, setRows] = useState<Reminder[]>([]);
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<'booking' | 'enrollment'>('booking');
  const [basisRef, setBasisRef] = useState('');
  const [offset, setOffset] = useState(-1440);
  const [spec, setSpec] = useState<MessageSpec>({ kind: 'text', text: '{{name}}さん、明日 {{date}} にご予約をいただいています。{{shop}} でお待ちしています。' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => { const { data } = await api.get('/harness/crm/reminders'); setRows(data.reminders); }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const create = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/harness/crm/reminders', { name, basis, basisRef: basis === 'enrollment' ? basisRef || null : null, offsetMinutes: offset, message: spec });
      setName(''); await load();
    } catch (e: any) { setError(e?.response?.data?.error || '作れませんでした'); } finally { setBusy(false); }
  };
  const toggle = async (r: Reminder) => { await api.put(`/harness/crm/reminders/${r.id}`, { active: !r.active }).catch(() => {}); await load(); };
  const remove = async (r: Reminder) => { if (confirm(`「${r.name}」を消しますか？`)) { await api.delete(`/harness/crm/reminders/${r.id}`).catch(() => {}); await load(); } };

  return (
    <div className="space-y-4">
      <section className="bg-white border rounded-2xl p-4 space-y-3">
        <h2 className="font-bold">リマインダーを作る</h2>
        <p className="text-xs text-gray-500">LINE から予約フォームを開いて予約した人（顧客 ID 付き）に、予約日時を基準に自動で送ります。{'{{date}}'}（日時）{'{{menu}}'}（メニュー）{'{{shop}}'}（店名）{'{{name}}'} が使えます。</p>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="名前（例: 前日リマインド）" />
        <div className="flex gap-2">
          <select className={input} value={basis} onChange={(e) => setBasis(e.target.value as 'booking' | 'enrollment')}><option value="booking">予約の希望日時を基準に</option><option value="enrollment">シナリオ登録日時を基準に</option></select>
          {basis === 'enrollment' && <select className={input} value={basisRef} onChange={(e) => setBasisRef(e.target.value)}><option value="">シナリオ</option>{refs.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        </div>
        <div className="flex flex-wrap gap-1">{PRESETS.map((p) => <button key={p.min} type="button" onClick={() => setOffset(p.min)} className={`rounded-full border px-3 py-1 text-xs ${offset === p.min ? 'bg-gray-900 text-white border-gray-900' : 'bg-white'}`}>{p.label}</button>)}</div>
        <label className="flex items-center gap-2 text-xs">分で指定 <input type="number" className="w-28 rounded-lg border px-2 py-1" value={offset} onChange={(e) => setOffset(Number(e.target.value))} /> （負の数は前）→ {offsetLabel(offset)}</label>
        <MessageSpecEditor value={spec} onChange={setSpec} refs={refs} compact />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="button" disabled={busy || !name.trim() || (basis === 'enrollment' && !basisRef)} onClick={create} className={btn}>作る</button>
      </section>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className={`bg-white border rounded-2xl p-4 text-sm ${r.active ? '' : 'opacity-60'}`}>
            <div className="flex justify-between gap-2"><p className="font-bold">{r.name}</p><span className="text-xs text-gray-500 shrink-0">送信 {r.sentCount}</span></div>
            <p className="text-xs text-gray-600 mt-1">{r.basis === 'booking' ? '予約' : 'シナリオ登録'}の {offsetLabel(r.offsetMinutes)}・{specSummary(r.message)}</p>
            <div className="flex gap-3 mt-2 text-xs"><button type="button" onClick={() => toggle(r)} className="underline text-violet-700">{r.active ? '止める' : '動かす'}</button><button type="button" onClick={() => remove(r)} className="underline text-red-600">消す</button></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
