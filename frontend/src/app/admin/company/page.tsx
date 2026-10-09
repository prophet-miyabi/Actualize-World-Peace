'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import AiHealthBanner from '@/components/admin/AiHealthBanner';

type Kpi = { key: string; label: string; target: number; unit: string; by: string };
type Agent = {
  key: string; name: string; department: string; reportsTo: string | null; mission: string; tools: string[]; maxAutoRisk: string; webSearch: boolean;
  model: string; defaultModel: string; enabled: boolean; dailyBudgetUsd: number; spentTodayUsd: number;
  stats30d: { done: number; failed: number; other: number }; lastRunAt: string | null;
  managed: { id: string; version: number | null; syncedAt: string | null } | null;
  selftest: { status: string; costUsd: number; toolCalls: number; summary: string | null; error: string | null; at: string } | null;
};
type Goal = { id: string; title: string; description: string; kpis: Kpi[]; status: string };
type Task = { id: string; title: string; assignee: string; createdBy: string; status: string; risk: string; result: any; verification: any; error: string | null; parentId: string | null; costUsd: number; runAt: string; createdAt: string; finishedAt: string | null };
type Action = { id: string; taskId: string; agent: string; tool: string; input: any; reason: string; risk: string; status: string; result?: any; decidedAt?: string | null; createdAt: string; task: { title: string } };
type Settings = { ceoHour: number; monthlyCapUsd: number; concurrency: number; discordApprovals: boolean; discordActivity: boolean };
type Status = {
  configured: boolean; paused: boolean; goals: Goal[]; org: Agent[]; tasks: Task[]; actions: Action[]; decided: Action[];
  events: { id: string; type: string; actor: string; payload: any; createdAt: string }[];
  costs: { companyAgents30d: { agent: string; runs: number; costUsd: number }[]; userFacingAi30d: { costUsd: number; calls: number } };
  metrics: { totals: { users: number; publishedPages: number; activeUsers7d: number }; period: { signups: number; pages: number; posts: number; bookings: number; orders: number } };
  settings: Settings; reports: { key: string; content: string; updatedAt: string }[];
  monthly: { spentUsd: number; capUsd: number };
  health: { lastTickAt: string | null; queued: number; running: number; awaitingApproval: number; verifying: number; failed24h: number; lastCeoDay: string | null };
  models: { strong: string; balanced: string; fast: string };
  engine: { kind: 'managed' | 'messages'; environmentId: string | null; workspace: string };
  activity: { taskId: string; agent: string; agentName: string; emoji: string; task: string; phase: string; tool?: string; text: string; since: string; updatedAt: string; toolCalls: number }[];
};

const STATUS: Record<string, string> = { queued: '待機', running: '実行中', awaiting_approval: '承認待ち', verifying: '検証中', done: '完了', failed: '失敗', rejected: '却下', canceled: '取り消し' };
const STATUS_CLS: Record<string, string> = { queued: 'bg-gray-100 text-gray-600', running: 'bg-sky-100 text-sky-700', awaiting_approval: 'bg-amber-100 text-amber-700', verifying: 'bg-violet-100 text-violet-700', done: 'bg-green-100 text-green-700', failed: 'bg-red-100 text-red-700', rejected: 'bg-red-50 text-red-600', canceled: 'bg-gray-100 text-gray-400' };
const DEPT: Record<string, string> = { executive: '経営', product: 'プロダクト', engineering: '開発', data: 'データ', marketing: 'マーケ', growth: 'グロース', cs: 'CS', finance: '財務', security: 'セキュリティ', legal: '法務', audit: '監査' };
const ACTION_STATUS: Record<string, string> = { approved: '承認', executed: '実行済み', rejected: '却下', failed: '失敗' };
const usd = (n: number) => `$${n.toFixed(2)}`;
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const TABS = [['overview', '概要'], ['approvals', '承認'], ['tasks', 'タスク'], ['org', '組織'], ['reports', '報告'], ['memory', 'メモリ'], ['events', 'ログ']] as const;
type Tab = (typeof TABS)[number][0];

// AI企業の運営コンソール。人間のオーナーはここで、目標・設定・承認・点検を行い、エージェントの働きを監督する
export default function CompanyPage() {
  const [s, setS] = useState<Status | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [memory, setMemory] = useState<{ scope: string; key: string; content: string; updatedBy: string; updatedAt: string }[] | null>(null);
  const [memOpen, setMemOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [newTask, setNewTask] = useState({ assignee: 'ceo', title: '', instructions: '' });
  const [taskFilter, setTaskFilter] = useState<{ status: string; assignee: string; q: string }>({ status: '', assignee: '', q: '' });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [goalEdit, setGoalEdit] = useState<Goal | null>(null);

  const load = useCallback(async () => {
    const d = (await api.get('/company/status')).data as Status;
    setS(d);
    setSettings((cur) => cur ?? d.settings);
  }, []);
  useEffect(() => { load().catch((e) => setError(e?.response?.status === 403 ? '管理者のみ利用できます。' : '読み込みに失敗しました。')); }, [load]);
  // 動いているエージェントがいる間は6秒ごと、いなければ30秒ごとに更新する
  const active = (s?.activity?.length ?? 0) > 0;
  useEffect(() => { const t = setInterval(() => load().catch(() => {}), active ? 6_000 : 30_000); return () => clearInterval(t); }, [load, active]);
  useEffect(() => { if (tab === 'memory' && !memory) api.get('/company/memory').then((r) => setMemory(r.data.memory)).catch(() => {}); }, [tab, memory]);
  useEffect(() => { if (open) api.get(`/company/tasks/${open}`).then((r) => setDetail(r.data)).catch(() => setDetail(null)); else setDetail(null); }, [open]);

  const run = async (name: string, fn: () => Promise<unknown>, ok: string | ((r: any) => string)) => {
    setBusy(name);
    setError('');
    setMsg('');
    try { const r = await fn(); setMsg(typeof ok === 'function' ? ok(r) : ok); await load(); } catch (e: any) { setError(e?.response?.data?.error || '処理できませんでした。'); } finally { setBusy(''); }
  };

  const filteredTasks = useMemo(() => (s?.tasks ?? []).filter((t) =>
    (!taskFilter.status || t.status === taskFilter.status) && (!taskFilter.assignee || t.assignee === taskFilter.assignee) && (!taskFilter.q || t.title.includes(taskFilter.q))
  ), [s, taskFilter]);

  if (!s) return <div className="p-6 text-sm text-gray-500">{error || '読み込み中…'}</div>;
  const goal = s.goals.find((g) => g.status === 'active');
  const actual: Record<string, number> = {
    users: s.metrics.totals.users, users_q1: s.metrics.totals.users, users_q2: s.metrics.totals.users, users_q3: s.metrics.totals.users,
    active7_rate: s.metrics.totals.users ? Math.round((s.metrics.totals.activeUsers7d / s.metrics.totals.users) * 100) : 0
  };
  const cost30 = s.costs.companyAgents30d.reduce((a, c) => a + c.costUsd, 0);
  const agentName = (k: string) => s.org.find((a) => a.key === k)?.name ?? (k === 'owner' || k === 'human' ? 'あなた' : k === 'system' ? '定期' : k);
  const tickAge = s.health.lastTickAt ? Math.round((Date.now() - new Date(s.health.lastTickAt).getTime()) / 60_000) : null;
  const selftestDone = s.org.filter((a) => a.selftest?.status === 'done').length;

  return (
    <div className="px-4 py-6 md:px-8 max-w-4xl space-y-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-black">AI企業</h1>
          <Link href="/admin/company/chat" className="shrink-0 rounded-full bg-violet-600 text-white text-xs font-bold px-4 py-2">💬 AWP Intelligence</Link>
        </div>
        <p className="text-sm text-gray-600 mt-1">あなたが目標・設定・重要な判断を決め、CEO以下のAIエージェントが日々の運営を進めます。</p>
        {!s.configured && <p className="mt-2 text-sm text-red-600">ANTHROPIC_API_KEY が未設定のため、エージェントは動きません。</p>}
        <div className="mt-3"><AiHealthBanner /></div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={() => run('pause', () => api.post('/company/pause', { paused: !s.paused }), s.paused ? 'AI企業を開始しました。' : 'AI企業を停止しました。')}
            className={`rounded-full px-5 py-2 text-sm font-bold ${s.paused ? 'bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white' : 'border text-gray-700'}`}>
            {s.paused ? '▶ AI企業を開始する' : '⏸ 停止する'}
          </button>
          <span className={`text-xs ${s.paused ? 'text-gray-500' : 'text-green-700 font-bold'}`}>{s.paused ? '停止中（承認待ちの操作はそのまま残ります）' : '稼働中'}</span>
          {s.actions.length > 0 && <button onClick={() => setTab('approvals')} className="rounded-full bg-amber-400 text-white text-xs font-bold px-3 py-1.5">承認待ち {s.actions.length}</button>}
        </div>
      </div>

      <div className="flex gap-1 text-xs overflow-x-auto">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`shrink-0 rounded-full px-4 py-1.5 font-bold ${tab === k ? 'bg-gray-900 text-white' : 'bg-white border'}`}>{l}{k === 'approvals' && s.actions.length > 0 ? `（${s.actions.length}）` : ''}</button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {s.activity.length > 0 && (
        <section className="rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm space-y-1">
          <p className="text-xs font-bold text-violet-800">いま動いているエージェント</p>
          {s.activity.map((a) => (
            <p key={a.taskId} className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
              <span className="font-bold">{a.emoji} {a.agentName}</span>
              <span className="text-violet-900">{a.text}</span>
              <span className="text-[11px] text-gray-500">{a.phase === 'waiting_approval' ? '承認待ち' : `${Math.max(0, Math.round((Date.now() - new Date(a.since).getTime()) / 1000))}秒`}{a.toolCalls ? `・道具${a.toolCalls}回` : ''}</span>
            </p>
          ))}
        </section>
      )}

      {tab === 'overview' && (
        <div className="space-y-4">
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            {[
              ['待機', s.health.queued], ['実行中', s.health.running], ['承認待ち', s.health.awaitingApproval], ['検証中', s.health.verifying],
              ['24時間の失敗', s.health.failed24h], ['登録ユーザー', s.metrics.totals.users], ['7日アクティブ', s.metrics.totals.activeUsers7d], ['公開ページ', s.metrics.totals.publishedPages]
            ].map(([l, v]) => (
              <div key={l as string} className="bg-white border rounded-xl p-2"><p className="text-[10px] text-gray-500">{l}</p><p className="font-black text-lg">{(v as number).toLocaleString('ja-JP')}</p></div>
            ))}
          </section>
          <p className="text-[11px] text-gray-500">
            最後の巡回: {s.health.lastTickAt ? `${tickAge}分前` : 'まだ'}{tickAge !== null && tickAge > 3 && !s.paused ? '（⚠ 巡回が止まっている可能性）' : ''}・CEOの最後の日次見直し: {s.health.lastCeoDay ?? 'まだ'}・
            今月の費用 {usd(s.monthly.spentUsd)} / 上限 {usd(s.monthly.capUsd)}・30日: 会社 {usd(cost30)} / 利用者向けAI {usd(s.costs.userFacingAi30d.costUsd)}
          </p>

          <section className="bg-white border rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-black">🎯 目標</h2>
                <p className="text-sm font-bold mt-1">{goal?.title ?? '（未設定）'}</p>
                {goal && <p className="text-xs text-gray-600 mt-1">{goal.description}</p>}
              </div>
              {goal && <button onClick={() => setGoalEdit(JSON.parse(JSON.stringify(goal)))} className="shrink-0 text-xs text-violet-700 underline">編集</button>}
            </div>
            {goal && (
              <table className="mt-3 w-full text-xs">
                <thead><tr className="text-gray-500"><th className="text-left font-normal py-1">KPI</th><th className="text-right font-normal">実績</th><th className="text-right font-normal">目標</th><th className="text-right font-normal">期限</th></tr></thead>
                <tbody>
                  {goal.kpis.map((k) => (
                    <tr key={k.key} className="border-t">
                      <td className="py-1.5">{k.label}</td>
                      <td className="text-right font-bold">{actual[k.key] != null ? `${actual[k.key].toLocaleString('ja-JP')}${k.unit}` : '—'}</td>
                      <td className="text-right">{k.target.toLocaleString('ja-JP')}{k.unit}</td>
                      <td className="text-right text-gray-500">{k.by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {goalEdit && (
              <div className="mt-4 border-t pt-3 space-y-2 text-sm">
                <input value={goalEdit.title} onChange={(e) => setGoalEdit({ ...goalEdit, title: e.target.value })} className="w-full border rounded-lg px-3 py-2 font-bold" />
                <textarea value={goalEdit.description} onChange={(e) => setGoalEdit({ ...goalEdit, description: e.target.value })} rows={3} className="w-full border rounded-lg px-3 py-2" />
                <p className="text-xs font-bold text-gray-500">KPI（キー / 名前 / 目標 / 単位 / 期限）</p>
                {goalEdit.kpis.map((k, i) => (
                  <div key={i} className="grid grid-cols-6 gap-1 text-xs">
                    <input value={k.key} onChange={(e) => setGoalEdit({ ...goalEdit, kpis: goalEdit.kpis.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} className="border rounded px-2 py-1" />
                    <input value={k.label} onChange={(e) => setGoalEdit({ ...goalEdit, kpis: goalEdit.kpis.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className="border rounded px-2 py-1 col-span-2" />
                    <input type="number" value={k.target} onChange={(e) => setGoalEdit({ ...goalEdit, kpis: goalEdit.kpis.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)) })} className="border rounded px-2 py-1" />
                    <input value={k.unit} onChange={(e) => setGoalEdit({ ...goalEdit, kpis: goalEdit.kpis.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })} className="border rounded px-2 py-1" />
                    <div className="flex gap-1"><input value={k.by} onChange={(e) => setGoalEdit({ ...goalEdit, kpis: goalEdit.kpis.map((x, j) => (j === i ? { ...x, by: e.target.value } : x)) })} className="border rounded px-2 py-1 min-w-0" /><button onClick={() => setGoalEdit({ ...goalEdit, kpis: goalEdit.kpis.filter((_, j) => j !== i) })} className="text-gray-400">✕</button></div>
                  </div>
                ))}
                <button onClick={() => setGoalEdit({ ...goalEdit, kpis: [...goalEdit.kpis, { key: '', label: '', target: 0, unit: '', by: '' }] })} className="text-xs text-violet-700 font-bold">＋ KPIを追加</button>
                <div className="flex gap-2">
                  <button onClick={() => run('goal', () => api.put(`/company/goals/${goalEdit.id}/edit`, goalEdit), '目標を保存しました。').then(() => setGoalEdit(null))} className="rounded-full bg-violet-600 text-white text-xs font-bold px-4 py-2">保存</button>
                  <button onClick={() => setGoalEdit(null)} className="rounded-full border text-xs px-4 py-2">やめる</button>
                </div>
              </div>
            )}
          </section>

          <section className="bg-white border rounded-2xl p-4 space-y-3">
            <h2 className="font-black">⚙️ 運用の設定</h2>
            {settings && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <label>CEOの日次見直し（時・JST）<input type="number" min={0} max={23} value={settings.ceoHour} onChange={(e) => setSettings({ ...settings, ceoHour: Number(e.target.value) })} className="mt-1 w-full border rounded-lg px-3 py-2" /></label>
                <label>月の費用上限（ドル）<input type="number" min={0} value={settings.monthlyCapUsd} onChange={(e) => setSettings({ ...settings, monthlyCapUsd: Number(e.target.value) })} className="mt-1 w-full border rounded-lg px-3 py-2" /></label>
                <label>同時実行数<input type="number" min={1} max={6} value={settings.concurrency} onChange={(e) => setSettings({ ...settings, concurrency: Number(e.target.value) })} className="mt-1 w-full border rounded-lg px-3 py-2" /></label>
                <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={settings.discordApprovals} onChange={(e) => setSettings({ ...settings, discordApprovals: e.target.checked })} />承認待ちをDiscordに通知</label>
                <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={settings.discordActivity !== false} onChange={(e) => setSettings({ ...settings, discordActivity: e.target.checked })} />進行状況（考え中・実行中）をDiscordに出す</label>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button disabled={!!busy} onClick={() => run('settings', () => api.put('/company/settings', settings), '設定を保存しました。')} className="rounded-full bg-violet-600 text-white text-xs font-bold px-4 py-2">設定を保存</button>
              <button disabled={!!busy} onClick={() => run('daily', () => api.post('/company/cycle/daily'), 'CEOの日次見直しを開始しました（数分で結果が出ます）。')} className="rounded-full border text-xs font-bold px-4 py-2">日次サイクルを今すぐ</button>
              <button disabled={!!busy} onClick={() => run('weekly', () => api.post('/company/cycle/weekly'), '週次（財務・データ・監査）を開始しました。')} className="rounded-full border text-xs font-bold px-4 py-2">週次サイクルを今すぐ</button>
              <button disabled={!!busy} onClick={() => confirm('全エージェントに自己点検タスクを配ります（約$3〜5のAI費用）。よろしいですか？') && run('selftest', () => api.post('/company/selftest'), '自己点検を開始しました。「組織」タブで結果が順に表示されます。')} className="rounded-full border text-xs font-bold px-4 py-2">🧪 全エージェントを自己点検</button>
            </div>
            <p className="text-[11px] text-gray-500">自己点検の結果: {selftestDone}/{s.org.length} が合格（詳細は「組織」タブ）</p>
          </section>
        </div>
      )}

      {tab === 'approvals' && (
        <div className="space-y-4">
          <section className="space-y-3">
            <h2 className="font-bold text-sm">🧑‍⚖️ あなたの承認待ち（{s.actions.length}）</h2>
            {s.actions.length === 0 && <p className="text-sm text-gray-500 bg-white border rounded-2xl p-4">承認待ちの操作はありません</p>}
            {s.actions.map((a) => (
              <div key={a.id} className="bg-white border-2 border-amber-300 rounded-2xl p-4 text-sm">
                <p className="text-[11px] font-bold text-amber-700">{agentName(a.agent)} → {a.tool}（リスク: {a.risk}）・{when(a.createdAt)}</p>
                <p className="font-bold mt-0.5">{a.task.title}</p>
                <p className="mt-1 whitespace-pre-wrap">{a.reason}</p>
                <details className="mt-2"><summary className="text-xs text-gray-500 cursor-pointer">操作の内容</summary><pre className="text-xs bg-gray-50 rounded-lg p-3 mt-1 overflow-x-auto">{JSON.stringify(a.input, null, 2)}</pre></details>
                <div className="flex gap-2 mt-3">
                  <button disabled={!!busy} onClick={() => confirm('この操作を承認して実行しますか？') && run(a.id, () => api.post(`/company/actions/${a.id}/approve`), '承認して実行しました。')} className="rounded-full bg-violet-600 text-white font-bold px-5 py-2">承認して実行</button>
                  <button disabled={!!busy} onClick={() => { const note = prompt('却下の理由（エージェントに伝わります）') ?? ''; run(a.id, () => api.post(`/company/actions/${a.id}/reject`, { note }), '却下しました。'); }} className="rounded-full border px-5 py-2 text-gray-600">却下</button>
                </div>
              </div>
            ))}
          </section>
          {s.decided.length > 0 && (
            <section>
              <h2 className="font-bold text-sm mb-2">これまでの判断</h2>
              <ul className="bg-white border rounded-2xl divide-y text-xs">
                {s.decided.map((a) => (
                  <li key={a.id} className="px-4 py-2 flex justify-between gap-3">
                    <span className="min-w-0 truncate">{agentName(a.agent)} → {a.tool}：{a.task.title}</span>
                    <span className="shrink-0 text-gray-500">{ACTION_STATUS[a.status] ?? a.status}・{when(a.decidedAt)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <section className="space-y-3">
          <form onSubmit={(e) => { e.preventDefault(); run('newtask', () => api.post('/company/tasks', newTask), '指示を出しました。').then(() => setNewTask({ assignee: 'ceo', title: '', instructions: '' })); }} className="bg-white border rounded-2xl p-4 space-y-2 text-sm">
            <p className="font-bold">エージェントに指示する（バックグラウンドで実行。会話で指示したいときは「AWP Intelligence」）</p>
            <div className="flex gap-2">
              <select value={newTask.assignee} onChange={(e) => setNewTask({ ...newTask, assignee: e.target.value })} className="border rounded-lg px-2 py-2 text-sm">
                {s.org.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
              </select>
              <input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="題名" maxLength={120} className="flex-1 border rounded-lg px-3 py-2 text-base" required />
            </div>
            <textarea value={newTask.instructions} onChange={(e) => setNewTask({ ...newTask, instructions: e.target.value })} rows={3} placeholder="やってほしいこと（目的・期待する成果物）" maxLength={6000} className="w-full border rounded-lg px-3 py-2 text-base" required />
            <button disabled={!!busy} className="rounded-full bg-violet-600 text-white font-bold px-5 py-2">指示を出す</button>
          </form>
          <div className="flex flex-wrap gap-2 text-xs">
            <select value={taskFilter.status} onChange={(e) => setTaskFilter({ ...taskFilter, status: e.target.value })} className="border rounded-lg px-2 py-1.5 bg-white"><option value="">すべての状態</option>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <select value={taskFilter.assignee} onChange={(e) => setTaskFilter({ ...taskFilter, assignee: e.target.value })} className="border rounded-lg px-2 py-1.5 bg-white"><option value="">すべての担当</option>{s.org.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</select>
            <input value={taskFilter.q} onChange={(e) => setTaskFilter({ ...taskFilter, q: e.target.value })} placeholder="題名で検索" className="border rounded-lg px-2 py-1.5 flex-1 min-w-[8rem]" />
          </div>
          <ul className="bg-white border rounded-2xl divide-y">
            {filteredTasks.length === 0 && <li className="px-4 py-3 text-sm text-gray-400">該当するタスクはありません</li>}
            {filteredTasks.map((t) => (
              <li key={t.id} className="px-4 py-3 text-sm">
                <button onClick={() => setOpen(open === t.id ? null : t.id)} className="w-full text-left flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-bold truncate">{t.title}</span>
                    <span className="block text-[11px] text-gray-500">{agentName(t.assignee)}・from {agentName(t.createdBy)}・{when(t.createdAt)}{t.costUsd ? `・${usd(t.costUsd)}` : ''}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLS[t.status] ?? ''}`}>{STATUS[t.status] ?? t.status}{t.verification?.passed === false ? '（監査NG）' : t.verification?.passed === true ? '（監査OK）' : ''}</span>
                </button>
                {open === t.id && (
                  <div className="mt-3 space-y-2 text-xs">
                    {detail?.task?.instructions && <pre className="whitespace-pre-wrap bg-gray-50 rounded-xl p-3 font-sans">{detail.task.instructions}</pre>}
                    {t.result && (
                      <div className="bg-violet-50 rounded-xl p-3 space-y-1">
                        <p className="font-bold">報告</p>
                        <p className="whitespace-pre-wrap">{t.result.summary}</p>
                        {t.result.facts?.length > 0 && <p><span className="font-bold">事実:</span> {t.result.facts.join(' / ')}</p>}
                        {t.result.assumptions?.length > 0 && <p><span className="font-bold">推測:</span> {t.result.assumptions.join(' / ')}</p>}
                        {t.result.artifacts?.length > 0 && <p><span className="font-bold">成果物:</span> {t.result.artifacts.join(' / ')}</p>}
                        {t.result.nextActions?.length > 0 && <p><span className="font-bold">次:</span> {t.result.nextActions.join(' / ')}</p>}
                        {t.result.blocked && <p className="text-amber-700"><span className="font-bold">止まっている:</span> {t.result.blocked}</p>}
                      </div>
                    )}
                    {t.verification && <p className={`rounded-xl p-3 whitespace-pre-wrap ${t.verification.passed ? 'bg-green-50' : 'bg-red-50'}`}><span className="font-bold">監査:</span> {String(t.verification.findings ?? '').slice(0, 1200)}</p>}
                    {t.error && <p className="text-red-600">エラー: {t.error}</p>}
                    {detail?.children?.length > 0 && <p>子タスク: {detail.children.map((c: any) => `${c.title}（${agentName(c.assignee)}・${STATUS[c.status]}）`).join(' / ')}</p>}
                    {detail?.task?.runs?.length > 0 && (
                      <p className="text-gray-500">実行: {detail.task.runs.map((r: any, i: number) => (
                        <span key={r.id}>{i > 0 ? ' / ' : ''}{r.model} 道具{r.toolCalls}回 {usd(r.costUsd)} {r.status}{r.error ? `（${r.error.slice(0, 80)}）` : ''}{r.consoleUrl && <> <a href={r.consoleUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 underline">Console で見る</a></>}</span>
                      ))}</p>
                    )}
                    <div className="flex gap-2">
                      {['queued', 'failed', 'canceled'].includes(t.status) && <button onClick={() => run(t.id, () => api.post(`/company/tasks/${t.id}/run`), '実行を開始しました。')} className="rounded-full bg-gray-900 text-white px-4 py-1.5 font-bold">いますぐ実行</button>}
                      {['queued', 'awaiting_approval', 'verifying', 'failed'].includes(t.status) && <button onClick={() => run(t.id, () => api.post(`/company/tasks/${t.id}/cancel`), '取り消しました。')} className="rounded-full border px-4 py-1.5">取り消す</button>}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'org' && (
        <section className="space-y-2">
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-3 text-xs text-violet-900 space-y-1">
            <p className="font-bold">実行基盤: {s.engine.kind === 'managed' ? 'Claude Platform（Managed Agents）' : '自前ループ（Messages API）'}</p>
            {s.engine.kind === 'managed' ? (
              <p>各エージェントの定義（役割・決まり・道具）は Claude Platform に「版」として保存され、1タスク = 1セッションとして実行されます。全過程は Console（platform.claude.com → Managed Agents → Sessions）で追えます。{s.engine.environmentId ? `環境: ${s.engine.environmentId}` : '環境は最初のタスク実行時に自動で作られます。'}</p>
            ) : (
              <p>Render の COMPANY_ENGINE を外す（または managed にする）と Claude Platform に移行します。</p>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={() => run('sync', async () => (await api.post('/company/managed/sync', {})).data, (r: any) => { const c = r.results.filter((x: any) => x.status === 'created').length, u = r.results.filter((x: any) => x.status === 'updated').length, e = r.results.filter((x: any) => x.status === 'error'); return `同期しました（新規 ${c} / 更新 ${u} / 変更なし ${r.results.length - c - u - e.length}${e.length ? ` / 失敗 ${e.length}: ${e.map((x: any) => `${x.key} ${x.error}`).join('; ')}` : ''}）`; })} disabled={busy === 'sync'} className="rounded-full bg-violet-600 text-white px-3 py-1 font-bold disabled:opacity-40">Claude Platform に同期</button>
            </div>
          </div>
          <p className="text-xs text-gray-500">モデル: 強い = {s.models.strong} / 標準 = {s.models.balanced} / 速い = {s.models.fast}。予算は1日の上限（ドル）。「30日」は完了 / 失敗の件数。</p>
          {s.org.map((a) => (
            <div key={a.key} className="bg-white border rounded-2xl p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black">{a.name} <span className="text-[11px] font-bold text-gray-500">{DEPT[a.department] ?? a.department}{a.reportsTo ? `・報告先 ${agentName(a.reportsTo)}` : '・独立'}</span></p>
                  <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{a.mission.split('\n')[0]}</p>
                  <p className="text-[11px] text-gray-500 mt-2">道具: {a.tools.join(', ')}{a.webSearch ? ', web_search' : ''}　｜　自動実行の上限: {a.maxAutoRisk}</p>
                  {s.activity.filter((x) => x.agent === a.key).map((x) => <p key={x.taskId} className="text-xs text-violet-800 font-bold"><span className="inline-block w-2 h-2 rounded-full bg-violet-500 animate-pulse mr-1" />{x.text}</p>)}
                  <p className="text-[11px] text-gray-500">30日: 完了 {a.stats30d.done} / 失敗 {a.stats30d.failed} / 進行中 {a.stats30d.other}・最終実行 {when(a.lastRunAt)}{a.managed ? `・Platform 版 v${a.managed.version ?? '?'}（${when(a.managed.syncedAt)} 同期）` : '・Platform 未同期（最初の実行時に自動同期）'}</p>
                  {a.selftest && (
                    <p className={`text-[11px] mt-1 rounded-lg px-2 py-1 ${a.selftest.status === 'done' ? 'bg-green-50 text-green-800' : a.selftest.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}>
                      🧪 自己点検 {STATUS[a.selftest.status]}（{when(a.selftest.at)}・道具{a.selftest.toolCalls}回・{usd(a.selftest.costUsd)}）{a.selftest.summary ? `：${a.selftest.summary}` : ''}{a.selftest.error ? `：${a.selftest.error}` : ''}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs space-y-1">
                  <p>{usd(a.spentTodayUsd)} / {usd(a.dailyBudgetUsd)} 今日</p>
                  <button onClick={() => run(a.key, () => api.put(`/company/agents/${a.key}`, { enabled: !a.enabled }), a.enabled ? '停止しました。' : '再開しました。')} className={`rounded-full px-3 py-1 font-bold ${a.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{a.enabled ? '稼働中' : '停止中'}</button>
                  <select value={a.model} onChange={(e) => run(a.key, () => api.put(`/company/agents/${a.key}`, { model: e.target.value }), 'モデルを変更しました。')} className="block w-full border rounded px-1 py-0.5 text-[11px]">
                    <option value={s.models.strong}>強い（Opus）</option>
                    <option value={s.models.balanced}>標準（Sonnet）</option>
                    <option value={s.models.fast}>速い（Haiku）</option>
                    {![s.models.strong, s.models.balanced, s.models.fast].includes(a.model) && <option value={a.model}>{a.model}</option>}
                  </select>
                  <button onClick={() => { const v = prompt('1日の予算（ドル）', String(a.dailyBudgetUsd)); if (v !== null) run(a.key, () => api.put(`/company/agents/${a.key}`, { dailyBudgetUsd: Number(v) }), '予算を更新しました。'); }} className="block w-full text-violet-700 underline">予算</button>
                  <button onClick={() => run(a.key, () => api.post('/company/selftest', { agents: [a.key] }), `${a.name}の自己点検を開始しました。`)} className="block w-full text-violet-700 underline">自己点検</button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'reports' && (
        <section className="space-y-3">
          <p className="text-xs text-gray-500">CEOからあなたへの報告（Discord #🏢-AI企業 にも届きます）。</p>
          {s.reports.length === 0 && <p className="text-sm text-gray-500 bg-white border rounded-2xl p-4">まだ報告はありません。日次サイクルが動くと、ここに並びます。</p>}
          {s.reports.map((r) => (
            <article key={r.key} className="bg-white border rounded-2xl p-4 text-sm">
              <p className="text-[11px] text-gray-500">{r.key.replace('report-', '')}・{when(r.updatedAt)}</p>
              <pre className="whitespace-pre-wrap font-sans mt-1">{r.content}</pre>
            </article>
          ))}
        </section>
      )}

      {tab === 'memory' && (
        <section className="space-y-2">
          <p className="text-xs text-gray-500">company/strategy が計画の正本です。あなたが直接編集することもできます。</p>
          <ul className="bg-white border rounded-2xl divide-y text-sm">
            {(memory ?? []).map((m) => (
              <li key={`${m.scope}/${m.key}`} className="px-4 py-3">
                <button onClick={() => setMemOpen(memOpen === `${m.scope}/${m.key}` ? null : `${m.scope}/${m.key}`)} className="w-full text-left flex justify-between gap-3">
                  <span className="truncate"><span className="text-violet-700 font-bold">{m.scope}</span> / {m.key}</span>
                  <span className="text-[11px] text-gray-500 shrink-0">{agentName(m.updatedBy)}・{new Date(m.updatedAt).toLocaleDateString('ja-JP')}</span>
                </button>
                {memOpen === `${m.scope}/${m.key}` && (
                  <div className="mt-2">
                    <textarea defaultValue={m.content} id={`mem-${m.scope}-${m.key}`} rows={14} className="w-full border rounded-xl px-3 py-2 text-xs font-mono" />
                    <button onClick={() => { const el = document.getElementById(`mem-${m.scope}-${m.key}`) as HTMLTextAreaElement; run('mem', () => api.put('/company/memory', { scope: m.scope, key: m.key, content: el.value }), '保存しました。').then(() => setMemory(null)); }} className="mt-1 rounded-full bg-violet-600 text-white text-xs font-bold px-4 py-1.5">保存</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'events' && (
        <ul className="bg-white border rounded-2xl divide-y text-xs">
          {s.events.map((e) => (
            <li key={e.id} className="px-4 py-2 flex gap-3">
              <span className="text-gray-400 shrink-0 w-24">{when(e.createdAt)}</span>
              <span className="min-w-0 break-words"><span className="font-bold">{agentName(e.actor)}</span> {e.type} {e.payload ? JSON.stringify(e.payload).slice(0, 160) : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
