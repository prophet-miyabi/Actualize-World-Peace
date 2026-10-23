'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import MessageSpecEditor from './MessageSpecEditor';
import { emptySpec, type MessageSpec } from '@/lib/harness';

// アンケート形式のボタン選択: 質問 → 選択肢（タグ・シナリオを結びつけられる）→ 完了時の返信（予約ボタン付きなど）
type Option = { label: string; value: string; tag?: string | null; scenarioId?: string | null };
type Question = { key: string; text: string; options: Option[] };
type Survey = { id: string; name: string; questions: Question[]; onComplete: { replyMessage?: MessageSpec | null; tag?: string | null; scenarioId?: string | null; linkPath?: string | null } | null; active: boolean; starts: number; completes: number; _count: { answers: number } };
type Refs = { scenarios: { id: string; name: string }[]; surveys: { id: string; name: string }[]; myPath: string };
const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-base';
const btn = 'rounded-full bg-violet-600 text-white text-sm font-bold px-5 py-2 disabled:opacity-40';
const small = 'rounded-full border px-3 py-1 text-xs font-bold';
const newQ = (i: number): Question => ({ key: `q${i + 1}`, text: '', options: [{ label: '', value: '' }, { label: '', value: '' }] });

export default function Surveys({ refs, onChanged }: { refs: Refs; onChanged?: () => void }) {
  const [rows, setRows] = useState<Survey[]>([]);
  const [name, setName] = useState('');
  const [questions, setQuestions] = useState<Question[]>([newQ(0)]);
  const [reply, setReply] = useState<MessageSpec>({ ...emptySpec(), text: 'ご回答ありがとうございました。' });
  const [doneTag, setDoneTag] = useState('');
  const [doneScenario, setDoneScenario] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [tally, setTally] = useState<{ id: string; rows: { key: string; options: { label: string; count: number }[] }[] } | null>(null);
  const load = useCallback(async () => { const { data } = await api.get('/harness/crm/surveys'); setRows(data.surveys); }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const setQ = (i: number, q: Partial<Question>) => setQuestions(questions.map((x, k) => (k === i ? { ...x, ...q } : x)));
  const setOpt = (i: number, j: number, o: Partial<Option>) => setQ(i, { options: questions[i].options.map((x, k) => (k === j ? { ...x, ...o, value: o.label !== undefined && (!x.value || x.value === x.label) ? o.label : (o.value ?? x.value) } : x)) });

  const create = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const qs = questions.filter((q) => q.text.trim()).map((q) => ({ ...q, options: q.options.filter((o) => o.label.trim()).map((o) => ({ ...o, value: o.value || o.label })) }));
      await api.post('/harness/crm/surveys', { name, questions: qs, onComplete: { replyMessage: reply, tag: doneTag || null, scenarioId: doneScenario || null } });
      setName(''); setQuestions([newQ(0)]); setDoneTag(''); setDoneScenario(''); setMsg('アンケートを作りました。ゲートの「反応したらアンケート」やボタンの「アンケートを始める」から送れます。');
      await load(); onChanged?.();
    } catch (e: any) { setError(e?.response?.data?.error || '作れませんでした'); } finally { setBusy(false); }
  };
  const toggle = async (s: Survey) => { await api.put(`/harness/crm/surveys/${s.id}`, { active: !s.active }).catch(() => {}); await load(); };
  const remove = async (s: Survey) => { if (confirm(`「${s.name}」を消しますか？回答も消えます。`)) { await api.delete(`/harness/crm/surveys/${s.id}`).catch(() => {}); await load(); onChanged?.(); } };
  const showTally = async (s: Survey) => { const { data } = await api.get(`/harness/crm/surveys/${s.id}/answers`); setTally({ id: s.id, rows: data.tally }); };

  return (
    <div className="space-y-4">
      <section className="bg-white border rounded-2xl p-4 space-y-3">
        <h2 className="font-bold">アンケートを作る</h2>
        <p className="text-xs text-gray-500">LINE の画面下に選択肢（ボタン）が出て、タップで答えられます。答えは顧客のカスタム項目に入り、選択肢ごとにタグやシナリオを結びつけられます。最後の返信に「予約フォームを開く」ボタンを付ければ、質問 → 予約の導線になります。</p>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="名前（例: 初回ヒアリング）" />
        {questions.map((q, i) => (
          <div key={i} className="rounded-2xl border-2 border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between"><p className="text-xs font-bold">質問 {i + 1}</p>{questions.length > 1 && <button type="button" onClick={() => setQuestions(questions.filter((_, k) => k !== i))} className="text-xs text-red-600 underline">消す</button>}</div>
            <input className={input} value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} placeholder="質問文（例: ご希望のメニューは？）" />
            <input className={`${input} text-xs`} value={q.key} onChange={(e) => setQ(i, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })} placeholder="保存する項目名（半角英数。例: menu）" />
            {q.options.map((o, j) => (
              <div key={j} className="rounded-xl bg-gray-50 p-2 space-y-1">
                <div className="flex gap-2">
                  <input className={input} value={o.label} maxLength={20} onChange={(e) => setOpt(i, j, { label: e.target.value })} placeholder={`選択肢 ${j + 1}（20字まで）`} />
                  {q.options.length > 1 && <button type="button" onClick={() => setQ(i, { options: q.options.filter((_, k) => k !== j) })} className="text-xs text-red-600 shrink-0">×</button>}
                </div>
                <div className="flex gap-2">
                  <input className={`${input} text-xs`} value={o.tag ?? ''} onChange={(e) => setOpt(i, j, { tag: e.target.value })} placeholder="選んだら付けるタグ（任意）" />
                  <select className={`${input} text-xs`} value={o.scenarioId ?? ''} onChange={(e) => setOpt(i, j, { scenarioId: e.target.value || null })}><option value="">シナリオ（任意）</option>{refs.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                </div>
              </div>
            ))}
            {q.options.length < 13 && <button type="button" onClick={() => setQ(i, { options: [...q.options, { label: '', value: '' }] })} className={small}>＋ 選択肢</button>}
          </div>
        ))}
        {questions.length < 10 && <button type="button" onClick={() => setQuestions([...questions, newQ(questions.length)])} className={small}>＋ 質問を足す</button>}
        <div className="rounded-2xl bg-violet-50 p-3 space-y-2">
          <p className="text-xs font-bold">すべて答えたら</p>
          <MessageSpecEditor value={reply} onChange={setReply} refs={refs} compact />
          <div className="flex gap-2">
            <input className={`${input} text-xs`} value={doneTag} onChange={(e) => setDoneTag(e.target.value)} placeholder="付けるタグ（任意）" />
            <select className={`${input} text-xs`} value={doneScenario} onChange={(e) => setDoneScenario(e.target.value)}><option value="">始めるシナリオ（任意）</option>{refs.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        <button type="button" disabled={busy || !name.trim() || !questions.some((q) => q.text.trim() && q.options.some((o) => o.label.trim()))} onClick={create} className={btn}>作る</button>
      </section>
      <ul className="space-y-2">
        {rows.map((s) => (
          <li key={s.id} className={`bg-white border rounded-2xl p-4 text-sm ${s.active ? '' : 'opacity-60'}`}>
            <div className="flex justify-between gap-2"><p className="font-bold">{s.name}</p><span className="text-xs text-gray-500 shrink-0">開始 {s.starts}・完了 {s.completes}</span></div>
            <p className="text-xs text-gray-600 mt-1">{s.questions.map((q) => q.text).join(' / ').slice(0, 100)}</p>
            <div className="flex gap-3 mt-2 text-xs"><button type="button" onClick={() => showTally(s)} className="underline text-violet-700">集計</button><button type="button" onClick={() => toggle(s)} className="underline text-violet-700">{s.active ? '止める' : '動かす'}</button><button type="button" onClick={() => remove(s)} className="underline text-red-600">消す</button></div>
            {tally?.id === s.id && (
              <div className="mt-2 rounded-xl bg-gray-50 p-2 text-xs space-y-1">
                {tally.rows.map((r) => <p key={r.key}><span className="font-bold">{r.key}:</span> {r.options.map((o) => `${o.label} ${o.count}`).join(' / ')}</p>)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
