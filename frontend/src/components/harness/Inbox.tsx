'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import MessageSpecEditor from './MessageSpecEditor';
import { STAGE_LABEL, emptySpec, type MessageSpec } from '@/lib/harness';

// 受信箱（オペレーターチャット）: 未返信の会話 → 会話ログ → AWP から返信（文章・ボタン・カード）
type Conv = { id: string; displayName: string | null; stage: string; leadScore: number; unreadCount: number; lastInboundAt: string; assignee: string | null; blocked: boolean; tags: string[]; last: { direction: string; kind: string; text: string | null; createdAt: string } | null };
type Msg = { id: string; direction: 'in' | 'out'; kind: string; text: string | null; source: string | null; status: string; error: string | null; createdAt: string };
type Refs = { scenarios: { id: string; name: string }[]; surveys: { id: string; name: string }[]; myPath: string };
const btn = 'rounded-full bg-violet-600 text-white text-sm font-bold px-5 py-2 disabled:opacity-40';
const time = (s: string) => new Date(s).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function Inbox({ refs }: { refs: Refs }) {
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [spec, setSpec] = useState<MessageSpec>(emptySpec());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => { const { data } = await api.get('/harness/crm/inbox', { params: { filter } }); setConvs(data.conversations); }, [filter]);
  useEffect(() => { load().catch(() => setError('読み込めませんでした')); }, [load]);
  useEffect(() => {
    if (!openId) return;
    api.get(`/harness/crm/contacts/${openId}/messages`).then((r) => setMsgs(r.data.messages)).catch(() => {});
    const t = setInterval(() => api.get(`/harness/crm/contacts/${openId}/messages`).then((r) => setMsgs(r.data.messages)).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [openId]);

  const send = async () => {
    if (!openId) return;
    setBusy(true); setError('');
    try {
      await api.post(`/harness/crm/contacts/${openId}/messages`, { message: spec });
      setSpec(emptySpec());
      const r = await api.get(`/harness/crm/contacts/${openId}/messages`); setMsgs(r.data.messages);
      await load();
    } catch (e: any) { setError(e?.response?.data?.error || '送れませんでした'); } finally { setBusy(false); }
  };
  const handled = async () => { if (!openId) return; await api.post(`/harness/crm/contacts/${openId}/handled`).catch(() => {}); await load(); };
  const sendSurvey = async (surveyId: string) => { if (!openId || !surveyId) return; setError(''); try { await api.post(`/harness/crm/contacts/${openId}/survey`, { surveyId }); } catch (e: any) { setError(e?.response?.data?.error || '送れませんでした'); } };

  const open = convs?.find((c) => c.id === openId) ?? null;
  if (open) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => { setOpenId(null); void load(); }} className="text-sm text-gray-500">← 受信箱へ戻る</button>
        <div className="bg-white border rounded-2xl p-3">
          <div className="flex justify-between gap-2"><p className="font-bold">{open.displayName ?? '名前なし'} <span className="text-xs font-normal text-gray-500">{STAGE_LABEL[open.stage] ?? open.stage}・スコア {open.leadScore}</span></p>{open.unreadCount > 0 && <button type="button" onClick={handled} className="text-xs underline text-violet-700">対応済みにする</button>}</div>
          {open.tags.length > 0 && <p className="text-xs text-gray-500 mt-1">{open.tags.join('・')}</p>}
          {open.blocked && <p className="text-xs text-red-600 mt-1">ブロックされているため送れません</p>}
        </div>
        <div className="bg-gray-100 rounded-2xl p-3 space-y-2 max-h-[50vh] overflow-y-auto">
          {msgs.length === 0 && <p className="text-xs text-gray-500">まだ会話はありません</p>}
          {msgs.map((m) => (
            <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${m.direction === 'out' ? (m.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-violet-600 text-white') : 'bg-white'}`}>
                {m.text ?? `（${m.kind}）`}
                <div className={`text-[10px] mt-1 ${m.direction === 'out' ? 'opacity-80' : 'text-gray-400'}`}>{time(m.createdAt)}{m.direction === 'out' && m.source ? `・${m.source}` : ''}{m.error ? `・${m.error}` : ''}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white border rounded-2xl p-3 space-y-2">
          <MessageSpecEditor value={spec} onChange={setSpec} refs={refs} compact />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || open.blocked} onClick={send} className={btn}>送る</button>
            {refs.surveys.length > 0 && <select className="rounded-full border px-3 py-2 text-xs" defaultValue="" onChange={(e) => { void sendSurvey(e.target.value); e.target.value = ''; }}><option value="">アンケートを送る…</option>{refs.surveys.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(['unread', 'all'] as const).map((f) => <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full px-4 py-1.5 text-xs font-bold border ${filter === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600'}`}>{f === 'unread' ? '未返信' : 'すべて'}</button>)}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {convs === null ? <p className="text-sm text-gray-500">読み込み中…</p> : convs.length === 0 ? <p className="text-sm text-gray-500 bg-white border rounded-2xl p-4">{filter === 'unread' ? '未返信の会話はありません。' : 'まだ会話はありません。LINE から話しかけられると、ここに届きます。'}</p> : (
        <ul className="bg-white border rounded-2xl divide-y">
          {convs.map((c) => (
            <li key={c.id}><button type="button" onClick={() => setOpenId(c.id)} className="w-full text-left px-4 py-3 flex items-center gap-3">
              <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm font-black ${c.unreadCount ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-500'}`}>{c.unreadCount || ''}</span>
              <span className="min-w-0 flex-1">
                <span className="flex justify-between gap-2"><span className="font-bold truncate">{c.displayName ?? '名前なし'}</span><span className="text-[11px] text-gray-400 shrink-0">{time(c.lastInboundAt)}</span></span>
                <span className="block text-xs text-gray-600 truncate">{c.last ? `${c.last.direction === 'out' ? '→ ' : ''}${c.last.text ?? `（${c.last.kind}）`}` : ''}</span>
              </span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
