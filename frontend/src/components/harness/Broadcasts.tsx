'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import MessageSpecEditor from './MessageSpecEditor';
import { STAGE_LABEL, emptySpec, specSummary, type Audience, type MessageSpec } from '@/lib/harness';

// 一斉・セグメント配信と予約配信: 対象の件数を先に見せ、送信は確認付き
type Broadcast = { id: string; name: string; status: string; targetCount: number; sentCount: number; failedCount: number; scheduledAt: string | null; finishedAt: string | null; error: string | null; message: MessageSpec; createdAt: string };
type Refs = { scenarios: { id: string; name: string }[]; surveys: { id: string; name: string }[]; myPath: string; tags: string[] };
const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-base';
const btn = 'rounded-full bg-violet-600 text-white text-sm font-bold px-5 py-2 disabled:opacity-40';
const STATUS: Record<string, string> = { draft: '下書き', scheduled: '予約済み', sending: '送信中', done: '完了', failed: '失敗', canceled: '取り消し' };

export default function Broadcasts({ refs }: { refs: Refs }) {
  const [rows, setRows] = useState<Broadcast[]>([]);
  const [name, setName] = useState('');
  const [audience, setAudience] = useState<Audience>({ all: true });
  const [spec, setSpec] = useState<MessageSpec>(emptySpec());
  const [scheduledAt, setScheduledAt] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => { const { data } = await api.get('/harness/crm/broadcasts'); setRows(data.broadcasts); }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => {
    const t = setTimeout(() => { api.post('/harness/crm/broadcasts/preview', { audience }).then((r) => setCount(r.data.count)).catch(() => setCount(null)); }, 300);
    return () => clearTimeout(t);
  }, [audience]);
  useEffect(() => {
    if (!rows.some((r) => r.status === 'sending')) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [rows, load]);

  const toggleTag = (key: 'tags' | 'excludeTags', tag: string) => {
    const cur = audience[key] ?? [];
    setAudience({ ...audience, all: false, [key]: cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag] });
  };
  const toggleStage = (s: string) => { const cur = audience.stages ?? []; setAudience({ ...audience, all: false, stages: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] }); };

  const create = async (sendNow: boolean) => {
    setBusy(true); setError(''); setMsg('');
    try {
      const { data } = await api.post('/harness/crm/broadcasts', { name: name || (sendNow ? '一斉配信' : '予約配信'), audience, message: spec, scheduledAt: !sendNow && scheduledAt ? new Date(scheduledAt).toISOString() : null });
      if (sendNow) {
        if (!confirm(`${data.broadcast.targetCount} 人に送ります。よろしいですか？`)) { await api.post(`/harness/crm/broadcasts/${data.broadcast.id}/cancel`).catch(() => {}); setBusy(false); return; }
        const r = await api.post(`/harness/crm/broadcasts/${data.broadcast.id}/send`);
        setMsg(`送りました: 成功 ${r.data.sent} / 失敗 ${r.data.failed}`);
      } else setMsg(scheduledAt ? '予約しました。時刻になると自動で送ります。' : '下書きを保存しました。');
      setName(''); setSpec(emptySpec()); setScheduledAt('');
      await load();
    } catch (e: any) { setError(e?.response?.data?.error || '作れませんでした'); } finally { setBusy(false); }
  };
  const sendDraft = async (b: Broadcast) => {
    if (!confirm(`「${b.name}」を ${b.targetCount} 人に送ります。よろしいですか？`)) return;
    setBusy(true); setError('');
    try { const r = await api.post(`/harness/crm/broadcasts/${b.id}/send`); setMsg(`送りました: 成功 ${r.data.sent} / 失敗 ${r.data.failed}`); await load(); } catch (e: any) { setError(e?.response?.data?.error || '送れませんでした'); } finally { setBusy(false); }
  };
  const cancel = async (b: Broadcast) => { await api.post(`/harness/crm/broadcasts/${b.id}/cancel`).catch(() => {}); await load(); };
  const remove = async (b: Broadcast) => { if (confirm('この配信を消しますか？')) { await api.delete(`/harness/crm/broadcasts/${b.id}`).catch(() => {}); await load(); } };

  return (
    <div className="space-y-4">
      <section className="bg-white border rounded-2xl p-4 space-y-3">
        <h2 className="font-bold">一斉・セグメント配信</h2>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="配信の名前（例: 11月のキャンペーン）" />
        <div className="rounded-xl bg-gray-50 p-3 space-y-2 text-sm">
          <div className="flex items-center justify-between"><p className="font-bold text-xs text-gray-600">送る相手</p><p className="text-xs font-black text-violet-700">{count === null ? '…' : `${count} 人`}</p></div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!audience.all} onChange={(e) => setAudience(e.target.checked ? { all: true } : { ...audience, all: false })} /> LINE で送れる全員</label>
          {!audience.all && (
            <>
              <div><p className="text-[11px] text-gray-500 mb-1">段階</p><div className="flex flex-wrap gap-1">{Object.entries(STAGE_LABEL).map(([k, v]) => <button key={k} type="button" onClick={() => toggleStage(k)} className={`rounded-full border px-3 py-1 text-xs ${audience.stages?.includes(k) ? 'bg-gray-900 text-white border-gray-900' : 'bg-white'}`}>{v}</button>)}</div></div>
              {refs.tags.length > 0 && <div><p className="text-[11px] text-gray-500 mb-1">タグ（いずれかを持つ人）</p><div className="flex flex-wrap gap-1">{refs.tags.map((t) => <button key={t} type="button" onClick={() => toggleTag('tags', t)} className={`rounded-full border px-3 py-1 text-xs ${audience.tags?.includes(t) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white'}`}>{t}</button>)}</div></div>}
              {refs.tags.length > 0 && <div><p className="text-[11px] text-gray-500 mb-1">除外するタグ</p><div className="flex flex-wrap gap-1">{refs.tags.map((t) => <button key={t} type="button" onClick={() => toggleTag('excludeTags', t)} className={`rounded-full border px-3 py-1 text-xs ${audience.excludeTags?.includes(t) ? 'bg-red-600 text-white border-red-600' : 'bg-white'}`}>{t}</button>)}</div></div>}
              <label className="flex items-center gap-2 text-xs">スコア <input type="number" min={0} max={100} className="w-20 rounded-lg border px-2 py-1" value={audience.minScore ?? ''} onChange={(e) => setAudience({ ...audience, minScore: e.target.value === '' ? null : Number(e.target.value) })} /> 以上</label>
            </>
          )}
        </div>
        <MessageSpecEditor value={spec} onChange={setSpec} refs={refs} />
        <label className="block text-xs text-gray-600">予約する場合の日時<input type="datetime-local" className={`${input} mt-1`} value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !count} onClick={() => create(true)} className={btn}>今すぐ送る</button>
          <button type="button" disabled={busy} onClick={() => create(false)} className="rounded-full border px-5 py-2 text-sm font-bold">{scheduledAt ? '予約する' : '下書き保存'}</button>
        </div>
        <p className="text-[11px] text-gray-500">LINE 公式アカウントの無料の配信枠（月 200 通など）を使います。1 日 5,000 通を超える配信は止まります。{'{{name}}'} を使うと 1 人ずつ送ります。</p>
      </section>
      <ul className="space-y-2">
        {rows.map((b) => (
          <li key={b.id} className="bg-white border rounded-2xl p-4 text-sm">
            <div className="flex justify-between gap-2"><p className="font-bold min-w-0 truncate">{b.name}</p><span className={`shrink-0 text-xs font-bold ${b.status === 'done' ? 'text-emerald-600' : b.status === 'failed' ? 'text-red-600' : 'text-gray-500'}`}>{STATUS[b.status] ?? b.status}</span></div>
            <p className="text-xs text-gray-600 mt-1 truncate">{specSummary(b.message)}</p>
            <p className="text-[11px] text-gray-500 mt-1">対象 {b.targetCount}・成功 {b.sentCount}・失敗 {b.failedCount}{b.scheduledAt ? `・予約 ${new Date(b.scheduledAt).toLocaleString('ja-JP')}` : ''}{b.error ? `・${b.error}` : ''}</p>
            <div className="flex gap-3 mt-2 text-xs">
              {b.status === 'draft' && <button type="button" disabled={busy} onClick={() => sendDraft(b)} className="underline text-violet-700">送る</button>}
              {(b.status === 'draft' || b.status === 'scheduled') && <button type="button" onClick={() => cancel(b)} className="underline text-gray-600">取り消す</button>}
              {b.status !== 'sending' && <button type="button" onClick={() => remove(b)} className="underline text-red-600">消す</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
