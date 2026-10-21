'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import api from '@/lib/api';
import { STATE_COLOR } from '@/components/admin/OfficeScene';
import OfficeMap2D from '@/components/admin/OfficeMap2D';

// AWP Operations Office — 運営業務を intelligence エージェントに委任し、3D オフィスで監視・指示・承認する（管理者専用）。
// PC: 左に 3D、右に操作パネル。スマホ（375px）: 上に 3D（高さ 42vh）、下にタブ。横スクロールは出さない。
const OfficeScene = dynamic(() => import('@/components/admin/OfficeScene'), { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center text-sm text-gray-500">オフィスを読み込んでいます…</div> });

type Dept = { key: string; name: string; color: string; summary: string; position: [number, number]; members: number; working: number; attention: number; done7: number; failed7: number; health: string };
type Agent = { key: string; name: string; department: string; agent: string; agentName: string; duties: string[]; color: string; enabled: boolean; state: string; currentTask: { id: string; title: string; since: string | null; text: string | null; tool: string | null } | null; counts: { done7: number; failed7: number; open: number }; avgMs: number; lastArtifact: { id: string; title: string; summary: string | null; at: string | null } | null; pendingApprovals: number; recentLogs: { type: string; at: string }[]; health: number };
type Task = { id: string; title: string; assignee: string; role: string | null; status: string; state: string; risk: string; priority: number; dueAt: string | null; kpi: string | null; approvalRequired: boolean; recurrence: string | null; parentId: string | null; loopRunId: string | null; error: string | null; summary: string | null; createdAt: string; updatedAt: string; finishedAt: string | null; createdBy: string };
type Approval = { id: string; source: 'approval' | 'action'; kind: string; title: string; reason: string; impact: string; options: { key: string; label: string; effect?: string }[]; taskId: string | null; createdAt: string; input?: unknown };
type Alert = { id: string; level: string; title: string; body: string; source: string; taskId: string | null; agent: string | null; status: string; createdAt: string };
type Loop = { key: string; name: string; department: string; description: string; steps: { role: string; label: string; approval?: boolean }[]; schedule: string | null; autoRun: boolean; enabled: boolean; runs: { id: string; status: string; currentStep: number; startedAt: string; finishedAt: string | null; tasks: { id: string; title: string; status: string; role: string | null }[] }[]; stats: { total: number; completed: number; failed: number; successRate: number | null; failureRate: number | null; avgStepMs: number; bottleneck: string | null } };
type State = { generatedAt: string; paused: boolean; configured: boolean; departments: Dept[]; agents: Agent[]; tasks: Task[]; approvals: Approval[]; alerts: Alert[]; loops: Loop[]; today: Task[]; decisions: { kind: string; id: string; title: string; source: string }[]; counts: { running: number; done: number; waitingApproval: number; failed: number; open: number }; kpi: { totals: Record<string, number>; period: Record<string, any>; series: { day: string; signups: number; pages: number; posts: number }[]; goals: { id: string; title: string; kpis: any }[] } | null; events: { id: string; type: string; actor: string; createdAt: string; payload: any }[] };
type Plan = { summary: string; steps: { role: string; title: string; instructions: string; doneCriteria: string; approval: boolean; risk: string; dependsOn: number[]; roleName?: string }[]; approvalPoints: string[]; kpi: string; risks: string[] };

const TABS = ['今日', '承認', '警報', 'タスク', 'ループ', '委任'] as const;
const STATE_LABEL: Record<string, string> = { DRAFT: '下書き', ASSIGNED: '割当済み', IN_PROGRESS: '実行中', WAITING_INPUT: '入力待ち', WAITING_APPROVAL: '承認待ち', BLOCKED: '一時停止', RETRYING: '再試行中', COMPLETED: '完了', FAILED: '失敗', CANCELLED: '取消' };
const STATE_CLS: Record<string, string> = { DRAFT: 'bg-gray-100 text-gray-600', ASSIGNED: 'bg-sky-100 text-sky-800', IN_PROGRESS: 'bg-green-100 text-green-800', WAITING_INPUT: 'bg-violet-100 text-violet-800', WAITING_APPROVAL: 'bg-yellow-100 text-yellow-800', BLOCKED: 'bg-slate-200 text-slate-700', RETRYING: 'bg-rose-100 text-rose-700', COMPLETED: 'bg-amber-100 text-amber-800', FAILED: 'bg-red-100 text-red-700', CANCELLED: 'bg-gray-100 text-gray-500' };
const ms = (n: number) => (n >= 60_000 ? `${Math.round(n / 60_000)}分` : `${Math.round(n / 1000)}秒`);
const ago = (s: string | null) => { if (!s) return ''; const d = Date.now() - new Date(s).getTime(); return d < 60_000 ? 'たった今' : d < 3_600_000 ? `${Math.round(d / 60_000)}分前` : d < 86_400_000 ? `${Math.round(d / 3_600_000)}時間前` : `${Math.round(d / 86_400_000)}日前`; };
const btn = 'rounded-full text-xs font-bold px-3 py-1.5 disabled:opacity-40';

export default function OfficePage() {
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<(typeof TABS)[number]>('今日');
  const [agentKey, setAgentKey] = useState<string | null>(null);
  const [deptKey, setDeptKey] = useState<string | null>(null);
  const [focusDept, setFocusDept] = useState<string | null>(null);
  const [showLoops, setShowLoops] = useState<string>('all');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [taskFilter, setTaskFilter] = useState<string>('open');
  const [live, setLive] = useState(false);
  const [prefillRole, setPrefillRole] = useState<string>('');
  const [view, setView] = useState<'3d' | '2d'>('3d');
  const [glLost, setGlLost] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try { setS((await api.get('/office/state')).data); setErr(''); } catch (e: any) { setErr(e?.response?.data?.error || '読み込めませんでした'); }
  }, []);
  const scheduleReload = useCallback(() => { if (reloadTimer.current) clearTimeout(reloadTimer.current); reloadTimer.current = setTimeout(() => void load(), 1200); }, [load]);
  useEffect(() => { void load(); }, [load]);

  // リアルタイム更新（SSE。Authorization ヘッダーを付けるため fetch でストリームを読む）
  useEffect(() => {
    const ctrl = new AbortController();
    let stopped = false;
    const connect = async () => {
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
        const base = (process.env.NEXT_PUBLIC_API_URL || '/api').replace(/\/$/, '');
        const res = await fetch(`${base}/office/stream`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error('stream');
        setLive(true);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
          for (const p of parts) { if (/^event: (events|summary)/m.test(p)) scheduleReload(); }
        }
      } catch { /* 再接続 */ }
      setLive(false);
      if (!stopped) setTimeout(connect, 5000);
    };
    void connect();
    return () => { stopped = true; ctrl.abort(); };
  }, [scheduleReload]);

  useEffect(() => { if (taskId) api.get(`/office/tasks/${taskId}`).then((r) => setDetail(r.data)).catch(() => setDetail(null)); else setDetail(null); }, [taskId, s?.generatedAt]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key); setErr('');
    try { await fn(); setToast(ok); setTimeout(() => setToast(''), 2500); await load(); } catch (e: any) { setErr(e?.response?.data?.error || '失敗しました'); } finally { setBusy(''); }
  };

  const agent = useMemo(() => s?.agents.find((a) => a.key === agentKey) ?? null, [s, agentKey]);
  const dept = useMemo(() => s?.departments.find((d) => d.key === deptKey) ?? null, [s, deptKey]);
  const tasksFiltered = useMemo(() => {
    if (!s) return [];
    const open = ['ASSIGNED', 'IN_PROGRESS', 'WAITING_INPUT', 'WAITING_APPROVAL', 'BLOCKED', 'RETRYING'];
    let list = s.tasks;
    if (taskFilter === 'open') list = list.filter((t) => open.includes(t.state));
    else if (taskFilter !== 'all') list = list.filter((t) => t.state === taskFilter);
    if (deptKey) { const roles = new Set(s.agents.filter((a) => a.department === deptKey).map((a) => a.key)); const agents = new Set(s.agents.filter((a) => a.department === deptKey).map((a) => a.agent)); list = list.filter((t) => (t.role && roles.has(t.role)) || (!t.role && agents.has(t.assignee))); }
    if (agentKey && agent) list = list.filter((t) => t.role === agent.key || (!t.role && t.assignee === agent.agent));
    return list.slice(0, 80);
  }, [s, taskFilter, deptKey, agentKey, agent]);

  if (err && !s) return <div className="p-6 text-sm text-red-600">{err}</div>;
  if (!s) return <div className="p-6 text-sm text-gray-500">読み込み中…</div>;

  const roleName = (k: string | null) => s.agents.find((a) => a.key === k)?.name ?? (k ?? '');
  const deptOf = (k: string | null) => s.departments.find((d) => d.key === s.agents.find((a) => a.key === k)?.department);

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* 上部: 状態サマリー */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h1 className="text-lg font-black mr-2">AWP Operations Office</h1>
        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${live ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{live ? '● リアルタイム' : '○ 再接続中'}</span>
        {s.paused && <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-red-100 text-red-700">AWP企業は停止中</span>}
        {!s.configured && <span className="text-[11px] font-bold rounded-full px-2 py-0.5 bg-amber-100 text-amber-800">intelligence 未接続（タスクは実行されません）</span>}
        <div className="ml-auto grid grid-cols-5 gap-1 text-center">
          {[['稼働', s.agents.filter((a) => ['実行中', '調査中', '作成中', '外部API呼び出し中'].includes(a.state)).length, 'text-green-700'], ['実行中', s.counts.running, 'text-green-700'], ['完了', s.counts.done, 'text-amber-700'], ['承認待ち', s.counts.waitingApproval, 'text-yellow-700'], ['失敗', s.counts.failed, 'text-red-700']].map(([l, v, c]) => (
            <div key={String(l)} className="rounded-xl bg-white border px-2 py-1 min-w-[52px]"><div className={`text-base font-black leading-tight ${c}`}>{String(v)}</div><div className="text-[10px] text-gray-500">{String(l)}</div></div>
          ))}
        </div>
      </div>
      {err && <p className="mb-2 text-xs text-red-600">{err}</p>}
      {toast && <p className="mb-2 text-xs text-green-700 font-bold">{toast}</p>}

      <div className="grid lg:grid-cols-[1fr_400px] gap-3">
        {/* 3D オフィス */}
        <div className="min-w-0">
          <div className="flex gap-1.5 overflow-x-auto pb-2">
            <button onClick={() => { setFocusDept(null); setDeptKey(null); }} className={`${btn} shrink-0 border ${!focusDept ? 'bg-gray-900 text-white' : 'bg-white'}`}>全体</button>
            {s.departments.map((d) => (
              <button key={d.key} onClick={() => { setFocusDept(d.key); setDeptKey(d.key); setAgentKey(null); }} className={`${btn} shrink-0 border flex items-center gap-1.5 ${focusDept === d.key ? 'bg-gray-900 text-white' : 'bg-white'}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: d.color }} />{d.name.split(' / ')[0].replace('部', '')}{d.attention > 0 && <span className="text-red-500">●</span>}
              </button>
            ))}
            <select value={showLoops} onChange={(e) => setShowLoops(e.target.value)} className="shrink-0 text-xs border rounded-full px-2 bg-white">
              <option value="all">ループ: すべて</option><option value="none">ループ: 非表示</option>
              {s.loops.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
            </select>
          </div>
          <div className="rounded-2xl overflow-hidden border bg-white h-[42vh] lg:h-[72vh] relative">
            {view === '3d' && !glLost ? (
              <OfficeScene departments={s.departments} agents={s.agents} loops={s.loops} counts={s.counts} selectedAgent={agentKey} selectedDept={deptKey} focusDept={focusDept} showLoops={showLoops}
                onSelectAgent={(k) => { setAgentKey(k); setDeptKey(null); setTab('タスク'); }} onSelectDept={(k) => { setDeptKey(k || null); setAgentKey(null); if (k) setFocusDept(k); }}
                onContextLost={() => { setGlLost(true); setView('2d'); }} />
            ) : (
              <OfficeMap2D departments={s.departments} agents={s.agents} loops={s.loops} selectedAgent={agentKey} selectedDept={deptKey} showLoops={showLoops}
                onSelectAgent={(k) => { setAgentKey(k); setDeptKey(null); setTab('タスク'); }} onSelectDept={(k) => { setDeptKey(k || null); setAgentKey(null); setFocusDept(k || null); }} />
            )}
            <div className="absolute right-2 top-2 flex gap-1">
              <button onClick={() => { setGlLost(false); setView('3d'); }} className={`${btn} border bg-white/90 ${view === '3d' && !glLost ? 'bg-gray-900 text-white' : ''}`}>3D</button>
              <button onClick={() => setView('2d')} className={`${btn} border bg-white/90 ${view === '2d' || glLost ? 'bg-gray-900 text-white' : ''}`}>2D</button>
            </div>
            {glLost && <p className="absolute left-2 top-2 text-[10px] bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">3D の描画が止まったため 2D に切り替えました</p>}
            <div className="absolute left-2 bottom-2 flex flex-wrap gap-1 text-[10px]">
              {['実行中', '承認待ち', '要対応', '待機中', '停止中'].map((k) => <span key={k} className="rounded-full bg-white/90 border px-2 py-0.5 flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: STATE_COLOR[k] }} />{k}</span>)}
              <span className="rounded-full bg-white/90 border px-2 py-0.5">線: 青=委任 黄=承認待ち 赤=失敗 金=完了</span>
            </div>
          </div>

          {/* 選択したエージェント／部署の詳細 */}
          {agent && (
            <div className="mt-3 rounded-2xl border bg-white p-4 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[11px] font-bold" style={{ color: agent.color }}>{deptOf(agent.key)?.name}</p><p className="text-lg font-black">{agent.name}</p><p className="text-xs text-gray-500">実体: {agent.agentName}（{agent.agent}）・{agent.duties.join('・')}</p></div>
                <span className="text-xs font-bold rounded-full px-2 py-1 text-white" style={{ background: STATE_COLOR[agent.state] }}>{agent.state}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                {[['7日の完了', agent.counts.done7], ['7日の失敗', agent.counts.failed7], ['平均処理', agent.avgMs ? ms(agent.avgMs) : '—'], ['健全性', `${agent.health}`]].map(([l, v]) => <div key={String(l)} className="rounded-xl bg-gray-50 p-2"><div className="font-black">{String(v)}</div><div className="text-[10px] text-gray-500">{String(l)}</div></div>)}
              </div>
              {agent.currentTask && <p className="mt-3 text-xs"><span className="font-bold">実行中:</span> {agent.currentTask.title}{agent.currentTask.text ? ` — ${agent.currentTask.text}` : ''}</p>}
              {agent.lastArtifact && <p className="mt-1 text-xs text-gray-600"><span className="font-bold">直近の成果物:</span> <button className="underline" onClick={() => setTaskId(agent.lastArtifact!.id)}>{agent.lastArtifact.title}</button>{agent.lastArtifact.summary ? ` — ${agent.lastArtifact.summary.slice(0, 120)}` : ''}</p>}
              {agent.recentLogs.length > 0 && <p className="mt-1 text-[11px] text-gray-500">ログ: {agent.recentLogs.map((l) => `${l.type}（${ago(l.at)}）`).join(' / ')}</p>}
              <div className="mt-3 flex gap-2"><button className={`${btn} bg-violet-600 text-white`} onClick={() => { setPrefillRole(agent.key); setTab('委任'); }}>この役割にタスクを委任</button><button className={`${btn} border`} onClick={() => setAgentKey(null)}>閉じる</button></div>
            </div>
          )}
          {dept && !agent && (
            <div className="mt-3 rounded-2xl border bg-white p-4 text-sm">
              <p className="text-lg font-black" style={{ color: dept.color }}>{dept.name}</p>
              <p className="text-xs text-gray-500">{dept.summary}</p>
              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                {[['メンバー', dept.members], ['稼働中', dept.working], ['7日の完了', dept.done7], ['要対応', dept.attention]].map(([l, v]) => <div key={String(l)} className="rounded-xl bg-gray-50 p-2"><div className="font-black">{String(v)}</div><div className="text-[10px] text-gray-500">{String(l)}</div></div>)}
              </div>
              <ul className="mt-3 grid sm:grid-cols-2 gap-1 text-xs">
                {s.agents.filter((a) => a.department === dept.key).map((a) => <li key={a.key}><button className="w-full text-left rounded-xl border px-3 py-2 flex items-center justify-between" onClick={() => setAgentKey(a.key)}><span className="font-bold">{a.name}</span><span className="rounded-full px-2 py-0.5 text-white text-[10px]" style={{ background: STATE_COLOR[a.state] }}>{a.state}</span></button></li>)}
              </ul>
            </div>
          )}
        </div>

        {/* 右（スマホは下）: 操作パネル */}
        <div className="min-w-0">
          <div className="flex gap-1 overflow-x-auto pb-2">
            {TABS.map((t) => {
              const badge = t === '承認' ? s.approvals.length : t === '警報' ? s.alerts.filter((a) => a.status === 'open').length : t === '今日' ? s.decisions.length : 0;
              return <button key={t} onClick={() => setTab(t)} className={`${btn} shrink-0 border ${tab === t ? 'bg-gray-900 text-white' : 'bg-white'}`}>{t}{badge > 0 && <span className="ml-1 rounded-full bg-red-500 text-white px-1.5">{badge}</span>}</button>;
            })}
          </div>
          <div className="rounded-2xl border bg-white p-3 text-sm max-h-[70vh] overflow-y-auto">
            {tab === '今日' && (
              <div className="space-y-4">
                <section>
                  <h2 className="font-black mb-2">管理者の判断が必要なこと <span className="text-xs text-gray-500">{s.decisions.length}件</span></h2>
                  {s.decisions.length === 0 && <p className="text-xs text-gray-500">いまはありません。</p>}
                  <ul className="space-y-1.5">{s.decisions.slice(0, 10).map((d) => <li key={`${d.kind}:${d.id}`}><button className="w-full text-left rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs" onClick={() => { if (d.kind === 'approval') setTab('承認'); else if (d.kind === 'alert') setTab('警報'); else setTaskId(d.id); }}><span className="font-bold mr-1">{d.kind === 'approval' ? '承認' : d.kind === 'alert' ? '警報' : '入力'}</span>{d.title}</button></li>)}</ul>
                </section>
                <section>
                  <h2 className="font-black mb-2">今日やるべきこと（優先度順）</h2>
                  {s.today.length === 0 && <p className="text-xs text-gray-500">優先度の高い未完了タスクはありません。</p>}
                  <ul className="space-y-1.5">{s.today.map((t) => <li key={t.id}><TaskRow t={t} roleName={roleName} onOpen={() => setTaskId(t.id)} /></li>)}</ul>
                </section>
                <section>
                  <h2 className="font-black mb-2">部署の健康状態</h2>
                  <ul className="grid grid-cols-2 gap-1.5 text-xs">{s.departments.map((d) => <li key={d.key} className={`rounded-xl border px-2.5 py-2 ${d.health === 'ok' ? '' : 'border-red-200 bg-red-50'}`}><div className="font-bold flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: d.color }} />{d.name.split(' / ')[0]}</div><div className="text-gray-600">稼働{d.working} / 完了{d.done7} / 失敗{d.failed7}{d.attention ? ` / 要対応${d.attention}` : ''}</div></li>)}</ul>
                </section>
                {s.kpi && (
                  <section>
                    <h2 className="font-black mb-2">KPI（30日）</h2>
                    <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
                      {[['利用者', s.kpi.totals.users], ['公開ページ', s.kpi.totals.publishedPages], ['7日アクティブ', s.kpi.totals.activeUsers7d], ['登録', s.kpi.period.signups], ['投稿', s.kpi.period.posts], ['予約', s.kpi.period.bookings]].map(([l, v]) => <div key={String(l)} className="rounded-xl bg-gray-50 p-2"><div className="font-black text-base">{String(v ?? 0)}</div><div className="text-[10px] text-gray-500">{String(l)}</div></div>)}
                    </div>
                    <div className="mt-2 flex items-end gap-[2px] h-12">{s.kpi.series.map((d) => { const max = Math.max(1, ...s.kpi!.series.map((x) => x.signups + x.pages + x.posts)); const v = d.signups + d.pages + d.posts; return <div key={d.day} title={`${d.day}: ${v}`} className="flex-1 bg-violet-400 rounded-t" style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />; })}</div>
                    <p className="text-[10px] text-gray-500 mt-1">直近14日の 登録＋ページ＋投稿</p>
                    {s.kpi.goals.length > 0 && <ul className="mt-2 text-xs space-y-1">{s.kpi.goals.map((g) => <li key={g.id} className="rounded-xl border px-2.5 py-1.5"><span className="font-bold">{g.title}</span></li>)}</ul>}
                  </section>
                )}
              </div>
            )}

            {tab === '承認' && (
              <div className="space-y-2">
                <h2 className="font-black">承認トレイ <span className="text-xs text-gray-500">{s.approvals.length}件</span></h2>
                {s.approvals.length === 0 && <p className="text-xs text-gray-500">承認待ちはありません。</p>}
                {s.approvals.map((a) => (
                  <div key={a.id} className="rounded-2xl border border-yellow-200 bg-yellow-50 p-3">
                    <p className="text-[10px] font-bold text-yellow-800">{a.kind} ・ {ago(a.createdAt)}</p>
                    <p className="font-bold mt-0.5">{a.title}</p>
                    <p className="text-xs text-gray-700 mt-1 whitespace-pre-line">{a.reason}</p>
                    <p className="text-[11px] text-gray-500 mt-1">影響範囲: {a.impact}</p>
                    {a.options?.length > 0 && <ul className="mt-1 text-[11px] text-gray-600">{a.options.map((o) => <li key={o.key}>・{o.label}{o.effect ? `：${o.effect}` : ''}</li>)}</ul>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button disabled={!!busy} className={`${btn} bg-violet-600 text-white`} onClick={() => confirm('承認しますか？') && run(a.id, () => api.post(`/office/approvals/${a.id}/approve`), '承認しました。')}>承認</button>
                      <button disabled={!!busy} className={`${btn} border bg-white`} onClick={() => { const note = prompt('差し戻し・却下の理由（担当に伝わります）') ?? ''; void run(a.id, () => api.post(`/office/approvals/${a.id}/reject`, { note }), '差し戻しました。'); }}>差し戻す</button>
                      {a.taskId && <button className={`${btn} border bg-white`} onClick={() => setTaskId(a.taskId)}>タスクを見る</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === '警報' && (
              <div className="space-y-2">
                <h2 className="font-black">警報 <span className="text-xs text-gray-500">{s.alerts.length}件</span></h2>
                {s.alerts.length === 0 && <p className="text-xs text-gray-500">警報はありません。</p>}
                {s.alerts.map((a) => (
                  <div key={a.id} className={`rounded-2xl border p-3 ${a.level === 'critical' ? 'border-red-300 bg-red-50' : a.level === 'warning' ? 'border-amber-200 bg-amber-50' : 'bg-gray-50'} ${a.status === 'acked' ? 'opacity-70' : ''}`}>
                    <p className="text-[10px] font-bold uppercase">{a.level} ・ {a.source} ・ {ago(a.createdAt)}</p>
                    <p className="font-bold mt-0.5">{a.title}</p>
                    <p className="text-xs text-gray-700 mt-1">{a.body}</p>
                    <div className="mt-2 flex gap-2">
                      {a.status === 'open' && <button disabled={!!busy} className={`${btn} border bg-white`} onClick={() => run(a.id, () => api.post(`/office/alerts/${a.id}/ack`), '確認済みにしました。')}>確認した</button>}
                      <button disabled={!!busy} className={`${btn} border bg-white`} onClick={() => run(a.id, () => api.post(`/office/alerts/${a.id}/resolve`), '解決にしました。')}>解決</button>
                      {a.taskId && <button className={`${btn} border bg-white`} onClick={() => setTaskId(a.taskId)}>タスクを見る</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'タスク' && (
              <div className="space-y-2">
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {[['open', '未完了'], ['all', 'すべて'], ['WAITING_APPROVAL', '承認待ち'], ['FAILED', '失敗'], ['COMPLETED', '完了']].map(([k, l]) => <button key={k} onClick={() => setTaskFilter(k)} className={`${btn} shrink-0 border ${taskFilter === k ? 'bg-gray-900 text-white' : 'bg-white'}`}>{l}</button>)}
                  {(agentKey || deptKey) && <button onClick={() => { setAgentKey(null); setDeptKey(null); }} className={`${btn} shrink-0 border bg-white`}>絞り込み解除</button>}
                </div>
                {tasksFiltered.length === 0 && <p className="text-xs text-gray-500">該当するタスクはありません。</p>}
                <ul className="space-y-1.5">{tasksFiltered.map((t) => <li key={t.id}><TaskRow t={t} roleName={roleName} onOpen={() => setTaskId(t.id)} /></li>)}</ul>
              </div>
            )}

            {tab === 'ループ' && (
              <div className="space-y-3">
                {s.loops.map((l) => {
                  const run0 = l.runs[0];
                  return (
                    <div key={l.key} className="rounded-2xl border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div><p className="font-black">{l.name}</p><p className="text-[11px] text-gray-500">{l.description}</p></div>
                        <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${run0?.status === 'running' ? 'bg-green-100 text-green-700' : run0?.status === 'waiting_approval' ? 'bg-yellow-100 text-yellow-800' : run0?.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{run0 ? run0.status : '未実行'}</span>
                      </div>
                      <ol className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                        {l.steps.map((st, i) => {
                          const active = run0 && ['running', 'waiting_approval'].includes(run0.status) && run0.currentStep === i;
                          const bottleneck = l.stats.bottleneck === st.role;
                          return <li key={i} className="flex items-center gap-1"><span className={`rounded-full px-2 py-0.5 border ${active ? 'bg-blue-600 text-white border-blue-600' : bottleneck ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white'}`} title={roleName(st.role)}>{i + 1}. {st.label}{st.approval ? ' ✋' : ''}</span>{i < l.steps.length - 1 && <span className="text-gray-400">→</span>}</li>;
                        })}
                      </ol>
                      <p className="text-[11px] text-gray-600 mt-2">回数 {l.stats.total} ・ 成功率 {l.stats.successRate ?? '—'}% ・ 失敗率 {l.stats.failureRate ?? '—'}% ・ 平均 {l.stats.avgStepMs ? ms(l.stats.avgStepMs) : '—'}/ステップ{l.stats.bottleneck ? ` ・ ボトルネック: ${roleName(l.stats.bottleneck)}` : ''}</p>
                      {run0 && <ul className="mt-1 text-[11px] text-gray-600">{run0.tasks.map((t) => <li key={t.id}><button className="underline" onClick={() => setTaskId(t.id)}>{t.title}</button> <span className={`rounded px-1 ${STATE_CLS[t.status === 'done' ? 'COMPLETED' : t.status === 'running' ? 'IN_PROGRESS' : t.status === 'awaiting_approval' ? 'WAITING_APPROVAL' : t.status === 'failed' ? 'FAILED' : 'ASSIGNED']}`}>{t.status}</span></li>)}</ul>}
                      <div className="mt-2 flex flex-wrap gap-2 items-center">
                        <button disabled={!!busy || !!(run0 && ['running', 'waiting_approval'].includes(run0.status))} className={`${btn} bg-gray-900 text-white`} onClick={() => run(l.key, () => api.post(`/office/loops/${l.key}/run`), 'ループを開始しました。')}>今すぐ回す</button>
                        <label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={l.autoRun} onChange={(e) => run(l.key + 'auto', () => api.put(`/office/loops/${l.key}`, { autoRun: e.target.checked }), '自動実行を更新しました。')} />自動実行</label>
                        <select value={l.schedule ?? 'none'} onChange={(e) => run(l.key + 'sch', () => api.put(`/office/loops/${l.key}`, { schedule: e.target.value }), '周期を更新しました。')} className="text-[11px] border rounded-full px-2 py-1"><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option><option value="none">手動</option></select>
                        {run0 && ['running', 'waiting_approval'].includes(run0.status) && <button disabled={!!busy} className={`${btn} border text-red-600`} onClick={() => confirm('この回を中止しますか？') && run(run0.id, () => api.post(`/office/loops/runs/${run0.id}/cancel`), '中止しました。')}>中止</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {tab === '委任' && <DelegatePanel agents={s.agents} prefillRole={prefillRole} onDone={() => { setPrefillRole(''); void load(); setTab('タスク'); }} />}
          </div>
        </div>
      </div>

      {/* タスク詳細（ドロワー） */}
      {taskId && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/40 p-0 lg:p-6" onClick={() => setTaskId(null)}>
          <div className="w-full lg:max-w-2xl max-h-[88vh] overflow-y-auto rounded-t-3xl lg:rounded-3xl bg-white p-4 text-sm" onClick={(e) => e.stopPropagation()}>
            {!detail ? <p className="text-gray-500">読み込み中…</p> : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-[11px] text-gray-500">{detail.role?.name ?? detail.assignee} ・ 優先度 {detail.priority} ・ リスク {detail.risk}{detail.kpi ? ` ・ KPI ${detail.kpi}` : ''}{detail.dueAt ? ` ・ 期限 ${new Date(detail.dueAt).toLocaleDateString('ja-JP')}` : ''}</p><h3 className="text-lg font-black">{detail.title}</h3></div>
                  <span className={`text-[11px] font-bold rounded-full px-2 py-1 ${STATE_CLS[detail.state]}`}>{STATE_LABEL[detail.state]}</span>
                </div>
                {detail.result?.summary && <div className="mt-3 rounded-2xl bg-gray-50 p-3"><p className="text-[11px] font-bold text-gray-500 mb-1">成果の要約</p><p className="whitespace-pre-line">{detail.result.summary}</p>{Array.isArray(detail.result.nextActions) && detail.result.nextActions.length > 0 && <p className="text-xs text-gray-600 mt-2">次の一手: {detail.result.nextActions.join(' / ')}</p>}</div>}
                {detail.error && <p className="mt-2 text-xs text-red-600">エラー: {detail.error}</p>}
                {detail.doneCriteria && <p className="mt-2 text-xs"><span className="font-bold">完了条件:</span> {detail.doneCriteria}</p>}
                <details className="mt-2 text-xs"><summary className="cursor-pointer font-bold">指示の全文</summary><pre className="whitespace-pre-wrap mt-1 text-gray-700">{detail.instructions}</pre></details>
                <div className="mt-3 flex flex-wrap gap-2 items-center">
                  <label className="text-xs flex items-center gap-1">優先度<select value={detail.priority} onChange={(e) => run('prio', () => api.post(`/office/tasks/${detail.id}/priority`, { priority: Number(e.target.value) }), '優先度を変更しました。')} className="border rounded-full px-2 py-1">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
                  {['queued', 'awaiting_approval', 'verifying'].includes(detail.status) && <button disabled={!!busy} className={`${btn} border`} onClick={() => run('pause', () => api.post(`/office/tasks/${detail.id}/pause`), '一時停止しました。')}>一時停止</button>}
                  {detail.status === 'paused' && <button disabled={!!busy} className={`${btn} border`} onClick={() => run('resume', () => api.post(`/office/tasks/${detail.id}/resume`), '再開しました。')}>再開</button>}
                  {['failed', 'rejected', 'canceled', 'queued', 'paused'].includes(detail.status) && <button disabled={!!busy} className={`${btn} bg-gray-900 text-white`} onClick={() => run('retry', () => api.post(`/office/tasks/${detail.id}/retry`), '再実行を開始しました。')}>再実行</button>}
                  {!['done', 'canceled', 'running'].includes(detail.status) && <button disabled={!!busy} className={`${btn} border text-red-600`} onClick={() => confirm('取り消しますか？') && run('cancel', () => api.post(`/office/tasks/${detail.id}/cancel`), '取り消しました。')}>取り消し</button>}
                  <button disabled={!!busy} className={`${btn} bg-violet-600 text-white`} onClick={() => { const text = prompt('追加の指示（担当に新しいタスクとして渡ります）'); if (text) void run('instruct', () => api.post(`/office/tasks/${detail.id}/instruct`, { text }), '追加指示を出しました。'); }}>追加指示</button>
                </div>
                {detail.approvals?.length > 0 && <div className="mt-3"><p className="text-[11px] font-bold text-gray-500">承認</p><ul className="text-xs">{detail.approvals.map((a: any) => <li key={a.id}>{a.status} ・ {a.title}{a.note ? `（${a.note}）` : ''}</li>)}</ul></div>}
                {detail.actions?.length > 0 && <div className="mt-3"><p className="text-[11px] font-bold text-gray-500">道具の操作</p><ul className="text-xs">{detail.actions.map((a: any) => <li key={a.id}>{a.status} ・ {a.tool} ・ {a.reason}</li>)}</ul></div>}
                {detail.children?.length > 0 && <div className="mt-3"><p className="text-[11px] font-bold text-gray-500">子タスク</p><ul className="text-xs space-y-1">{detail.children.map((c: any) => <li key={c.id}><button className="underline" onClick={() => setTaskId(c.id)}>{c.title}</button> <span className="text-gray-500">{c.status}</span></li>)}</ul></div>}
                <div className="mt-3"><p className="text-[11px] font-bold text-gray-500">履歴</p><ul className="text-[11px] text-gray-600 space-y-0.5 max-h-40 overflow-y-auto">{(detail.events ?? []).map((e: any) => <li key={e.id}>{new Date(e.createdAt).toLocaleString('ja-JP')} ・ {e.type} ・ {e.actor}</li>)}{(detail.runs ?? []).map((r: any) => <li key={r.id}>{new Date(r.startedAt).toLocaleString('ja-JP')} ・ 実行 {r.status} ・ {r.model} ・ ${Number(r.costUsd).toFixed(3)}</li>)}</ul></div>
                <button className={`${btn} border mt-3`} onClick={() => setTaskId(null)}>閉じる</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskRow({ t, roleName, onOpen }: { t: Task; roleName: (k: string | null) => string; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full text-left rounded-xl border px-3 py-2 hover:border-violet-300">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-xs truncate">{t.title}</span>
        <span className={`shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 ${STATE_CLS[t.state]}`}>{STATE_LABEL[t.state]}</span>
      </div>
      <div className="text-[10px] text-gray-500 mt-0.5 truncate">P{t.priority} ・ {t.role ? roleName(t.role) : t.assignee}{t.approvalRequired ? ' ・ 要承認' : ''}{t.dueAt ? ` ・ 期限 ${new Date(t.dueAt).toLocaleDateString('ja-JP')}` : ''}{t.summary ? ` ・ ${t.summary.slice(0, 60)}` : t.error ? ` ・ ${t.error.slice(0, 60)}` : ''}</div>
    </button>
  );
}

function DelegatePanel({ agents, prefillRole, onDone }: { agents: Agent[]; prefillRole: string; onDone: () => void }) {
  const [mode, setMode] = useState<'plan' | 'direct'>(prefillRole ? 'direct' : 'plan');
  const [f, setF] = useState({ title: '', objective: '', role: prefillRole, priority: 3, dueAt: '', kpi: '', info: '', approvalRequired: true, recurrence: 'none', doneCriteria: '', feature: '', services: '', risk: 'low' });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { if (prefillRole) { setF((x) => ({ ...x, role: prefillRole })); setMode('direct'); } }, [prefillRole]);
  const body = () => ({ title: f.title.trim() || f.objective.slice(0, 40), objective: f.objective.trim(), priority: Number(f.priority), dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null, kpi: f.kpi || null, info: f.info || null, approvalRequired: f.approvalRequired, recurrence: f.recurrence, doneCriteria: f.doneCriteria || null, feature: f.feature || null, services: f.services.split(/[、,\s]+/).filter(Boolean), risk: f.risk });
  const makePlan = async () => { setBusy('plan'); setErr(''); try { const { data } = await api.post('/office/delegate/plan', body()); setPlan({ ...data.plan, steps: data.roles }); } catch (e: any) { setErr(e?.response?.data?.error || 'プランを作れませんでした'); } finally { setBusy(''); } };
  const confirmPlan = async () => { if (!plan) return; setBusy('confirm'); setErr(''); try { await api.post('/office/delegate/confirm', { ...body(), plan: { ...plan, steps: plan.steps.map(({ roleName: _r, ...s }: any) => ({ ...s, agent: undefined })) } }); setPlan(null); setF((x) => ({ ...x, title: '', objective: '' })); onDone(); } catch (e: any) { setErr(e?.response?.data?.error || '委任できませんでした'); } finally { setBusy(''); } };
  const direct = async () => { setBusy('direct'); setErr(''); try { await api.post('/office/tasks', { ...body(), role: f.role }); setF((x) => ({ ...x, title: '', objective: '' })); onDone(); } catch (e: any) { setErr(e?.response?.data?.error || '委任できませんでした'); } finally { setBusy(''); } };
  const input = 'w-full border rounded-xl px-3 py-2 text-sm';
  return (
    <div className="space-y-3">
      <div className="flex gap-1"><button onClick={() => setMode('plan')} className={`${btn} border ${mode === 'plan' ? 'bg-gray-900 text-white' : 'bg-white'}`}>目的から分解して委任</button><button onClick={() => setMode('direct')} className={`${btn} border ${mode === 'direct' ? 'bg-gray-900 text-white' : 'bg-white'}`}>1人に直接任せる</button></div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      <input className={input} placeholder="タスク名（空なら目的から自動）" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <textarea className={input} rows={3} placeholder="目的（例: 10月中に受託1件を取るために、LP制作の提案文と見本を整える）" value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} />
      {mode === 'direct' && <select className={input} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="">担当エージェントを選ぶ</option>{agents.map((a) => <option key={a.key} value={a.key}>{a.name}（{a.agentName}）</option>)}</select>}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs">優先度<select className={input} value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}{n === 1 ? '（最優先）' : n === 5 ? '（低）' : ''}</option>)}</select></label>
        <label className="text-xs">期限<input type="date" className={input} value={f.dueAt} onChange={(e) => setF({ ...f, dueAt: e.target.value })} /></label>
        <label className="text-xs">関連KPI<input className={input} placeholder="例: 公開数" value={f.kpi} onChange={(e) => setF({ ...f, kpi: e.target.value })} /></label>
        <label className="text-xs">リスク<select className={input} value={f.risk} onChange={(e) => setF({ ...f, risk: e.target.value })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
        <label className="text-xs">繰り返し<select className={input} value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value })}><option value="none">なし</option><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option></select></label>
        <label className="text-xs">関連する機能<input className={input} placeholder="例: ページ作成" value={f.feature} onChange={(e) => setF({ ...f, feature: e.target.value })} /></label>
      </div>
      <input className={input} placeholder="関連する外部サービス（カンマ区切り。例: Instagram, Stripe）" value={f.services} onChange={(e) => setF({ ...f, services: e.target.value })} />
      <textarea className={input} rows={2} placeholder="必要な情報（渡すべき事実・制約）" value={f.info} onChange={(e) => setF({ ...f, info: e.target.value })} />
      <input className={input} placeholder="完了条件" value={f.doneCriteria} onChange={(e) => setF({ ...f, doneCriteria: e.target.value })} />
      <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={f.approvalRequired} onChange={(e) => setF({ ...f, approvalRequired: e.target.checked })} />完了時に管理者の承認を必須にする（金銭・法務・公開・削除・外部配信は必ずオン）</label>
      {mode === 'plan' && !plan && <button disabled={!!busy || !f.objective.trim()} className={`${btn} bg-gray-900 text-white w-full py-3`} onClick={makePlan}>{busy === 'plan' ? 'Orchestrator が分解中…' : 'Orchestrator に分解させる'}</button>}
      {mode === 'direct' && <button disabled={!!busy || !f.objective.trim() || !f.role} className={`${btn} bg-violet-600 text-white w-full py-3`} onClick={direct}>{busy === 'direct' ? '委任中…' : 'このエージェントに委任する'}</button>}
      {plan && (
        <div className="rounded-2xl border bg-gray-50 p-3 space-y-2">
          <p className="font-bold text-xs">提案されたプラン: {plan.summary}</p>
          <ol className="space-y-1.5">
            {plan.steps.map((st, i) => (
              <li key={i} className="rounded-xl bg-white border p-2 text-xs">
                <div className="flex items-center gap-2"><span className="font-black">{i + 1}.</span>
                  <select value={st.role} onChange={(e) => setPlan({ ...plan, steps: plan.steps.map((x, j) => (j === i ? { ...x, role: e.target.value, roleName: agents.find((a) => a.key === e.target.value)?.name } : x)) })} className="border rounded-full px-2 py-0.5">{agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}</select>
                  <span className="font-bold">{st.title}</span>{st.approval && <span className="rounded-full bg-yellow-100 text-yellow-800 px-2">要承認</span>}<span className="text-gray-500">{st.risk}</span>
                </div>
                <p className="text-gray-700 mt-1">{st.instructions}</p>
                <p className="text-gray-500 mt-0.5">完了条件: {st.doneCriteria}{st.dependsOn?.length ? ` ・ 前提: ${st.dependsOn.map((d) => d + 1).join(',')}` : ''}</p>
              </li>
            ))}
          </ol>
          {plan.approvalPoints.length > 0 && <p className="text-xs"><span className="font-bold">承認ポイント:</span> {plan.approvalPoints.join(' / ')}</p>}
          {plan.risks.length > 0 && <p className="text-xs"><span className="font-bold">リスク:</span> {plan.risks.join(' / ')}</p>}
          <div className="flex gap-2"><button disabled={!!busy} className={`${btn} bg-violet-600 text-white flex-1 py-3`} onClick={confirmPlan}>{busy === 'confirm' ? '委任中…' : 'このプランを承認して委任する'}</button><button className={`${btn} border bg-white`} onClick={() => setPlan(null)}>作り直す</button></div>
        </div>
      )}
    </div>
  );
}
