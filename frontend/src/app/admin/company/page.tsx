'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Agent = { key: string; name: string; department: string; reportsTo: string | null; mission: string; tools: string[]; maxAutoRisk: string; webSearch: boolean; model: string; enabled: boolean; dailyBudgetUsd: number; spentTodayUsd: number };
type Goal = { id: string; title: string; description: string; kpis: { key: string; label: string; target: number; unit: string; by: string }[]; status: string };
type Task = { id: string; title: string; assignee: string; createdBy: string; status: string; risk: string; result: any; verification: any; error: string | null; parentId: string | null; costUsd: number; runAt: string; createdAt: string; finishedAt: string | null };
type Action = { id: string; taskId: string; agent: string; tool: string; input: any; reason: string; risk: string; createdAt: string; task: { title: string } };
type Status = {
  configured: boolean; paused: boolean; goals: Goal[]; org: Agent[]; tasks: Task[]; actions: Action[];
  events: { id: string; type: string; actor: string; payload: any; createdAt: string }[];
  costs: { companyAgents30d: { agent: string; runs: number; costUsd: number }[]; userFacingAi30d: { costUsd: number; calls: number } };
  monthly: { spentUsd: number; capUsd: number };
  metrics: { totals: { users: number; publishedPages: number; activeUsers7d: number }; period: { signups: number; pages: number; posts: number; bookings: number; orders: number; planSales: { yen: number }; confirmedRewards: { toPlatformYen: number } } };
};

const STATUS: Record<string, string> = { queued: '待機', running: '実行中', awaiting_approval: '承認待ち', verifying: '検証中', done: '完了', failed: '失敗', rejected: '却下', canceled: '取り消し' };
const STATUS_CLS: Record<string, string> = { queued: 'bg-gray-100 text-gray-600', running: 'bg-sky-100 text-sky-700', awaiting_approval: 'bg-amber-100 text-amber-700', verifying: 'bg-violet-100 text-violet-700', done: 'bg-green-100 text-green-700', failed: 'bg-red-100 text-red-700', rejected: 'bg-red-50 text-red-600', canceled: 'bg-gray-100 text-gray-400' };
const DEPT: Record<string, string> = { executive: '経営', product: 'プロダクト', engineering: '開発', data: 'データ', marketing: 'マーケ', growth: 'グロース', cs: 'CS', finance: '財務', security: 'セキュリティ', legal: '法務', audit: '監査' };
const usd = (n: number) => `$${n.toFixed(2)}`;

// AI企業の管理画面: 目標・組織・承認待ち・タスク・メモリ・費用。人間のオーナーはここで目標と重要な判断だけを行う
export default function CompanyPage() {
  const [s, setS] = useState<Status | null>(null);
  const [tab, setTab] = useState<'tasks' | 'org' | 'memory' | 'events'>('tasks');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [memory, setMemory] = useState<{ scope: string; key: string; content: string; updatedBy: string; updatedAt: string }[] | null>(null);
  const [memOpen, setMemOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [newTask, setNewTask] = useState({ assignee: 'ceo', title: '', instructions: '' });

  const load = useCallback(async () => setS((await api.get('/company/status')).data), []);
  useEffect(() => { load().catch((e) => setError(e?.response?.status === 403 ? '管理者のみ利用できます。' : '読み込みに失敗しました。')); }, [load]);
  useEffect(() => { if (tab === 'memory' && !memory) api.get('/company/memory').then((r) => setMemory(r.data.memory)).catch(() => {}); }, [tab, memory]);
  useEffect(() => { if (open) api.get(`/company/tasks/${open}`).then((r) => setDetail(r.data)).catch(() => setDetail(null)); else setDetail(null); }, [open]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError('');
    setMsg('');
    try { await fn(); setMsg(ok); await load(); } catch (e: any) { setError(e?.response?.data?.error || '処理できませんでした。'); }
  };

  if (!s) return <div className="p-6 text-sm text-gray-500">{error || '読み込み中…'}</div>;
  const goal = s.goals.find((g) => g.status === 'active');
  const actual: Record<string, number> = {
    users: s.metrics.totals.users, users_q1: s.metrics.totals.users, users_q2: s.metrics.totals.users, users_q3: s.metrics.totals.users,
    active7_rate: s.metrics.totals.users ? Math.round((s.metrics.totals.activeUsers7d / s.metrics.totals.users) * 100) : 0
  };
  const cost30 = s.costs.companyAgents30d.reduce((a, c) => a + c.costUsd, 0);
  const agentName = (k: string) => s.org.find((a) => a.key === k)?.name ?? k;

  return (
    <div className="px-4 py-6 md:px-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-black">AI企業</h1>
        <p className="text-sm text-gray-600 mt-1">あなたが目標と重要な判断を決め、CEO以下のAIエージェントが日々の運営を進めます。お金・設定・公開に関わる操作は、ここで承認したときだけ実行されます。</p>
        {!s.configured && <p className="mt-2 text-sm text-red-600">ANTHROPIC_API_KEY が未設定のため、エージェントは動きません。</p>}
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => run(() => api.post('/company/pause', { paused: !s.paused }), s.paused ? 'AI企業を開始しました。毎朝8時（JST）にCEOの経営見直しが動きます。' : 'AI企業を停止しました。')}
            className={`rounded-full px-5 py-2 text-sm font-bold ${s.paused ? 'bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white' : 'border text-gray-700'}`}>
            {s.paused ? '▶ AI企業を開始する' : '⏸ 停止する'}
          </button>
          <span className="text-xs text-gray-500">{s.paused ? '停止中（承認待ちの操作はそのまま残ります）' : '稼働中。費用はAPIの従量課金（Maxプランとは別）です'}</span>
        </div>
      </div>

      {s.actions.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-bold text-sm">🧑‍⚖️ あなたの承認待ち（{s.actions.length}）</h2>
          {s.actions.map((a) => (
            <div key={a.id} className="bg-white border-2 border-amber-300 rounded-2xl p-4 text-sm">
              <p className="text-[11px] font-bold text-amber-700">{agentName(a.agent)} → {a.tool}（リスク: {a.risk}）</p>
              <p className="font-bold mt-0.5">{a.task.title}</p>
              <p className="mt-1 whitespace-pre-wrap">{a.reason}</p>
              <details className="mt-2"><summary className="text-xs text-gray-500 cursor-pointer">操作の内容</summary><pre className="text-xs bg-gray-50 rounded-lg p-3 mt-1 overflow-x-auto">{JSON.stringify(a.input, null, 2)}</pre></details>
              <div className="flex gap-2 mt-3">
                <button onClick={() => confirm('この操作を承認して実行しますか？') && run(() => api.post(`/company/actions/${a.id}/approve`), '承認して実行しました。')} className="rounded-full bg-violet-600 text-white font-bold px-5 py-2">承認して実行</button>
                <button onClick={() => { const note = prompt('却下の理由（エージェントに伝わります）') ?? ''; run(() => api.post(`/company/actions/${a.id}/reject`, { note }), '却下しました。'); }} className="rounded-full border px-5 py-2 text-gray-600">却下</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="bg-white border rounded-2xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-black">🎯 目標</h2>
            <p className="text-sm font-bold mt-1">{goal?.title ?? '（未設定）'}</p>
            {goal && <p className="text-xs text-gray-600 mt-1">{goal.description}</p>}
          </div>
          <button onClick={() => run(() => api.post('/company/tick'), 'CEOの日次見直しを開始しました（数分で結果が出ます）。')} className="shrink-0 rounded-full bg-gray-900 text-white text-xs font-bold px-4 py-2">いますぐ経営サイクルを回す</button>
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
        <div className="grid grid-cols-3 gap-2 mt-3 text-center">
          {[['30日の登録', s.metrics.period.signups], ['公開ページ', s.metrics.totals.publishedPages], ['7日アクティブ', s.metrics.totals.activeUsers7d]].map(([l, v]) => (
            <div key={l as string} className="bg-gray-50 rounded-xl p-2"><p className="text-[10px] text-gray-500">{l}</p><p className="font-black">{(v as number).toLocaleString('ja-JP')}</p></div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">AI費用（30日）: 会社のエージェント {usd(cost30)} / 利用者向けAI {usd(s.costs.userFacingAi30d.costUsd)}（見積もり）</p>
        <p className="text-[11px] text-gray-500">今月の会社のエージェントの費用 {usd(s.monthly.spentUsd)} / 上限 {usd(s.monthly.capUsd)}（上限に達すると来月まで休みます。COMPANY_MONTHLY_CAP_USD で変更）</p>
      </section>

      <div className="flex gap-1 text-xs">
        {([['tasks', 'タスク'], ['org', '組織'], ['memory', 'メモリ'], ['events', 'ログ']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 font-bold ${tab === k ? 'bg-gray-900 text-white' : 'bg-white border'}`}>{l}</button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-green-700">{msg}</p>}

      {tab === 'tasks' && (
        <section className="space-y-3">
          <form onSubmit={(e) => { e.preventDefault(); run(() => api.post('/company/tasks', newTask), '指示を出しました。').then(() => setNewTask({ assignee: 'ceo', title: '', instructions: '' })); }} className="bg-white border rounded-2xl p-4 space-y-2 text-sm">
            <p className="font-bold">エージェントに指示する</p>
            <div className="flex gap-2">
              <select value={newTask.assignee} onChange={(e) => setNewTask({ ...newTask, assignee: e.target.value })} className="border rounded-lg px-2 py-2 text-sm">
                {s.org.filter((a) => a.key !== 'auditor').map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
              </select>
              <input value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} placeholder="題名" maxLength={120} className="flex-1 border rounded-lg px-3 py-2 text-base" required />
            </div>
            <textarea value={newTask.instructions} onChange={(e) => setNewTask({ ...newTask, instructions: e.target.value })} rows={3} placeholder="やってほしいこと（目的・期待する成果物）" maxLength={6000} className="w-full border rounded-lg px-3 py-2 text-base" required />
            <button className="rounded-full bg-violet-600 text-white font-bold px-5 py-2">指示を出す</button>
          </form>
          <ul className="bg-white border rounded-2xl divide-y">
            {s.tasks.map((t) => (
              <li key={t.id} className="px-4 py-3 text-sm">
                <button onClick={() => setOpen(open === t.id ? null : t.id)} className="w-full text-left flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block font-bold truncate">{t.title}</span>
                    <span className="block text-[11px] text-gray-500">{agentName(t.assignee)}・from {t.createdBy === 'human' || t.createdBy === 'owner' ? 'あなた' : t.createdBy === 'system' ? '定期' : agentName(t.createdBy)}・{new Date(t.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{t.costUsd ? `・${usd(t.costUsd)}` : ''}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLS[t.status] ?? ''}`}>{STATUS[t.status] ?? t.status}{t.verification?.passed === false ? '（監査NG）' : ''}</span>
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
                    {t.verification && <p className={`rounded-xl p-3 ${t.verification.passed ? 'bg-green-50' : 'bg-red-50'}`}><span className="font-bold">監査:</span> {String(t.verification.findings ?? '').slice(0, 800)}</p>}
                    {t.error && <p className="text-red-600">エラー: {t.error}</p>}
                    {detail?.children?.length > 0 && <p>子タスク: {detail.children.map((c: any) => `${c.title}（${agentName(c.assignee)}・${STATUS[c.status]}）`).join(' / ')}</p>}
                    <div className="flex gap-2">
                      {['queued', 'failed', 'canceled'].includes(t.status) && <button onClick={() => run(() => api.post(`/company/tasks/${t.id}/run`), '実行を開始しました。')} className="rounded-full bg-gray-900 text-white px-4 py-1.5 font-bold">いますぐ実行</button>}
                      {['queued', 'awaiting_approval', 'verifying', 'failed'].includes(t.status) && <button onClick={() => run(() => api.post(`/company/tasks/${t.id}/cancel`), '取り消しました。')} className="rounded-full border px-4 py-1.5">取り消す</button>}
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
          {s.org.map((a) => (
            <div key={a.key} className="bg-white border rounded-2xl p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black">{a.name} <span className="text-[11px] font-bold text-gray-500">{DEPT[a.department] ?? a.department}{a.reportsTo ? `・報告先 ${agentName(a.reportsTo)}` : '・独立'}</span></p>
                  <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{a.mission}</p>
                  <p className="text-[11px] text-gray-500 mt-2">道具: {a.tools.join(', ')}{a.webSearch ? ', web_search' : ''}　｜　自動実行の上限: {a.maxAutoRisk}　｜　モデル: {a.model}</p>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p>{usd(a.spentTodayUsd)} / {usd(a.dailyBudgetUsd)} 今日</p>
                  <button onClick={() => run(() => api.put(`/company/agents/${a.key}`, { enabled: !a.enabled }), a.enabled ? '停止しました。' : '再開しました。')} className={`mt-1 rounded-full px-3 py-1 font-bold ${a.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>{a.enabled ? '稼働中' : '停止中'}</button>
                  <button onClick={() => { const v = prompt('1日の予算（ドル）', String(a.dailyBudgetUsd)); if (v !== null) run(() => api.put(`/company/agents/${a.key}`, { dailyBudgetUsd: Number(v) }), '予算を更新しました。'); }} className="block mt-1 text-violet-700 underline">予算</button>
                </div>
              </div>
            </div>
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
                  <span className="text-[11px] text-gray-500 shrink-0">{m.updatedBy}・{new Date(m.updatedAt).toLocaleDateString('ja-JP')}</span>
                </button>
                {memOpen === `${m.scope}/${m.key}` && (
                  <div className="mt-2">
                    <textarea defaultValue={m.content} id={`mem-${m.key}`} rows={14} className="w-full border rounded-xl px-3 py-2 text-xs font-mono" />
                    <button onClick={() => { const el = document.getElementById(`mem-${m.key}`) as HTMLTextAreaElement; run(() => api.put('/company/memory', { scope: m.scope, key: m.key, content: el.value }), '保存しました。').then(() => setMemory(null)); }} className="mt-1 rounded-full bg-violet-600 text-white text-xs font-bold px-4 py-1.5">保存</button>
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
              <span className="text-gray-400 shrink-0 w-24">{new Date(e.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              <span className="min-w-0 break-words"><span className="font-bold">{agentName(e.actor)}</span> {e.type} {e.payload ? JSON.stringify(e.payload).slice(0, 160) : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
