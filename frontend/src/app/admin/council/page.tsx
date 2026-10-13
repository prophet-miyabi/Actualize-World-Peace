'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import AiHealthBanner from '@/components/admin/AiHealthBanner';
import RichText from '@/components/admin/RichText';

type Session = { key: string; title: string; updatedAt: string; updatedBy: string; content: string };
type Task = { id: string; title: string; status: string; createdAt: string; finishedAt: string | null; error: string | null; costUsd: number; summary: string | null; nextActions: string[]; artifacts: string[]; runs: { id: string; status: string; engine: string; sessionId: string | null; costUsd: number }[] };
type Data = {
  vision: string | null;
  openQuestions: string | null;
  sessions: Session[];
  tasks: Task[];
  activity: { taskId: string; agent: string; agentName: string; emoji: string; text: string; phase: string; since: string }[];
};
const STATUS: Record<string, string> = { queued: '開始待ち', running: '会議中', verifying: '監査中', done: '終了', failed: '失敗', awaiting_approval: '承認待ち', cancelled: '取り消し' };

// AWP 会議室: 議題を入れると、議長と5人の博士（心理学・社会学・経済学・地政学・天文学）が議論し、
// 合意／未決／次の一手を議事録に残す。決定は「次の一手をタスクにする」で AI企業へ流す
export default function CouncilPage() {
  const [d, setD] = useState<Data | null>(null);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<'sessions' | 'open' | 'vision'>('sessions');

  const load = useCallback(async () => setD((await api.get('/company/council')).data), []);
  useEffect(() => { load().catch((e) => setError(e?.response?.status === 403 ? '管理者のみ利用できます。' : '読み込みに失敗しました。')); }, [load]);
  const live = (d?.tasks ?? []).some((t) => ['queued', 'running'].includes(t.status));
  useEffect(() => { const t = setInterval(() => load().catch(() => {}), live ? 6_000 : 30_000); return () => clearInterval(t); }, [load, live]);

  const openCouncil = async () => {
    if (topic.trim().length < 4) return;
    setBusy(true); setError(''); setMsg('');
    try {
      await api.post('/company/council/open', { topic: topic.trim() });
      setMsg('会議を開きました。議長が論点を整理し、5人の博士の見解を集めています（数分）。終わると下の「会議の記録」に議事録が出ます。');
      setTopic('');
      await load();
    } catch (e: any) { setError(e?.response?.data?.error || '開けませんでした。'); } finally { setBusy(false); }
  };

  const delegate = async (s: Session) => {
    if (!confirm(`「${s.title}」の次の一手を、COO に段取り（担当ごとのタスク登録）させますか？`)) return;
    setBusy(true); setError(''); setMsg('');
    try {
      await api.post('/company/tasks', {
        assignee: 'coo', risk: 'low', title: `会議の次の一手を段取り: ${s.title}`.slice(0, 120),
        instructions: `read_memory(council, ${s.key}) の「次の一手」を読み、担当ごとに create_task で登録してください（1件1成果物、期限つき。同じ内容の未完了タスクがあれば作らない）。登録したタスクIDを finish_task の artifacts に書くこと。`
      });
      setMsg('COO に段取りを任せました。「AI企業」のタスク一覧で進みを確認できます。');
      await load();
    } catch (e: any) { setError(e?.response?.data?.error || '登録できませんでした。'); } finally { setBusy(false); }
  };

  if (!d) return <div className="p-6 text-sm text-gray-500">{error || '読み込み中…'}</div>;
  const running = d.tasks.filter((t) => ['queued', 'running'].includes(t.status));

  return (
    <div className="px-4 py-6 md:px-8 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">AWP 会議室</h1>
          <p className="text-sm text-gray-600 mt-1">大きな問いを、議長と5人の博士（心理学・社会学・経済学・地政学・天文学）で議論し、合意・未決・次の一手にまとめます。決定はここから AI企業のタスクへ流せます。</p>
        </div>
        <Link href="/admin/company" className="shrink-0 text-xs text-violet-700 underline">AI企業の画面</Link>
      </div>
      <div className="mt-4"><AiHealthBanner /></div>

      {/* 議題を入れて開く */}
      <section className="mt-4 rounded-2xl border-2 border-violet-200 bg-white p-4">
        <p className="font-bold text-sm">会議を開く</p>
        <p className="text-xs text-gray-500 mt-1">例: 「参加配当の原資と配り方」「最初の自治単位をどう定義するか」「統括系の停止権限は誰が持つか」</p>
        <div className="mt-2 flex gap-2">
          <input value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) openCouncil(); }} maxLength={200} placeholder="議題を1文で" className="flex-1 border rounded-xl px-3 py-2 text-sm" />
          <button onClick={openCouncil} disabled={busy || topic.trim().length < 4} className="rounded-xl bg-violet-600 text-white text-sm font-bold px-4 disabled:opacity-40">開く</button>
        </div>
        {d.openQuestions && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.openQuestions.split('\n').filter((l) => /^\d+\./.test(l.trim())).slice(0, 5).map((l, i) => {
              const t = l.replace(/^\s*\d+\.\s*/, '').split(/[—（(]/)[0].trim().slice(0, 40);
              return <button key={i} onClick={() => setTopic(t)} className="text-[11px] rounded-full border border-violet-200 bg-violet-50 text-violet-800 px-2.5 py-1">{t}</button>;
            })}
          </div>
        )}
      </section>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {msg && <p className="mt-3 text-sm text-green-700">{msg}</p>}

      {/* 開催中 */}
      {running.length > 0 && (
        <section className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm space-y-1">
          <p className="text-xs font-bold text-violet-800">開催中</p>
          {running.map((t) => <p key={t.id} className="font-bold">🏛️ {t.title}（{STATUS[t.status] ?? t.status}）</p>)}
          {d.activity.map((a) => <p key={a.taskId + a.agent} className="flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-violet-500 animate-pulse" /><span className="font-bold">{a.emoji} {a.agentName}</span><span>{a.text}</span></p>)}
          {d.activity.length === 0 && <p className="text-xs text-gray-500">開始待ち… AIが止まっている場合は、上のバナーの直し方を見てください。</p>}
        </section>
      )}

      <div className="mt-6 flex gap-2 text-sm">
        {([['sessions', '会議の記録'], ['open', '未決の問い'], ['vision', 'ビジョン']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 font-bold ${tab === k ? 'bg-gray-900 text-white' : 'bg-white border text-gray-600'}`}>{l}</button>
        ))}
      </div>

      {tab === 'sessions' && (
        <section className="mt-3 space-y-3">
          {d.tasks.filter((t) => t.status === 'failed').slice(0, 3).map((t) => (
            <div key={t.id} className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">「{t.title}」は失敗しました: {t.error}</div>
          ))}
          {d.sessions.length === 0 && <p className="text-sm text-gray-500">まだ記録はありません。</p>}
          {d.sessions.map((s) => (
            <div key={s.key} className="bg-white border rounded-2xl p-4">
              <button onClick={() => setOpen(open === s.key ? null : s.key)} className="w-full text-left">
                <p className="font-bold text-sm">{s.title}</p>
                <p className="text-[11px] text-gray-500 mt-0.5">{new Date(s.updatedAt).toLocaleString('ja-JP')}・{s.updatedBy === 'system' ? '初回（Claude Code で開催）' : s.updatedBy}・{open === s.key ? '閉じる' : '全文を読む'}</p>
              </button>
              {open === s.key && (
                <div className="mt-3 border-t pt-3">
                  <RichText text={s.content} />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button onClick={() => delegate(s)} disabled={busy} className="rounded-full bg-violet-600 text-white text-xs font-bold px-4 py-2 disabled:opacity-40">次の一手を COO に段取りさせる</button>
                    <button onClick={() => { setTopic(`${s.title.replace(/^第\d+回 AWP 会議室（[^）]*）/, '').replace(/^## 議題: /, '').trim().slice(0, 60)} の続き`); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="rounded-full border text-xs font-bold px-4 py-2">この議題の続きを開く</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      {tab === 'open' && <section className="mt-3 bg-white border rounded-2xl p-4">{d.openQuestions ? <RichText text={d.openQuestions} /> : <p className="text-sm text-gray-500">未決の問いはありません。</p>}</section>}
      {tab === 'vision' && <section className="mt-3 bg-white border rounded-2xl p-4">{d.vision ? <RichText text={d.vision} /> : <p className="text-sm text-gray-500">ビジョンはまだ保存されていません（バックエンドの起動時に投入されます）。</p>}</section>}

      <p className="mt-6 text-[11px] text-gray-500">Claude Code からも開けます: <code>/awp-council 議題</code>（Max プランのトークンで動くため、本番の AI が止まっていても使えます）。</p>
    </div>
  );
}
