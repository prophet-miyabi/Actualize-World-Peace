#!/usr/bin/env node
// AWP を Claude Code から運営・開発するための MCP サーバー（stdio）。
// Claude Code（このアプリ）が AWP の管理画面兼開発環境になる: ここで定義した道具を通して、
// AI企業の状況・タスク・承認・メモリ・設定・ローンチ・クルー・本番の健全性を、会話の中から直接操作できる。
//
// 認証: 管理者が管理画面（AWP Intelligence）で発行した「開発環境トークン」を
//   ~/.claude/awp-admin-token（1行）または環境変数 AWP_ADMIN_TOKEN に置く。リポジトリには入れない。
// 接続先: AWP_API_BASE（既定は本番）。ローカルの backend を使うときは http://localhost:8000
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import os from 'os';
import path from 'path';

const BASE = (process.env.AWP_API_BASE || 'https://awp-backend-sm9z.onrender.com').replace(/\/$/, '');
const FRONT = (process.env.AWP_FRONTEND_BASE || 'https://awp-frontend-bf17.onrender.com').replace(/\/$/, '');

function token(): string | null {
  const env = (process.env.AWP_ADMIN_TOKEN || '').trim();
  if (env) return env;
  try { return fs.readFileSync(path.join(os.homedir(), '.claude', 'awp-admin-token'), 'utf8').trim() || null; } catch { return null; }
}

async function api(method: string, p: string, body?: unknown) {
  const t = token();
  const res = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000)
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 文字列のまま */ }
  if (!res.ok) {
    const msg = json?.error || text.slice(0, 300) || res.statusText;
    if (res.status === 401) throw new Error(`認証に失敗しました（${msg}）。管理画面の AWP Intelligence →「Claude Code に接続」でトークンを発行し、~/.claude/awp-admin-token に保存してください`);
    if (res.status === 403) throw new Error('管理者権限が必要です（このトークンの利用者は管理者ではありません）');
    throw new Error(`${method} ${p} → ${res.status}: ${msg}`);
  }
  return json ?? text;
}

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (e: any) => ({ content: [{ type: 'text' as const, text: `エラー: ${e?.message ?? e}` }], isError: true });
const guard = <T>(fn: () => Promise<T>) => fn().then(text).catch(fail);

const server = new McpServer({ name: 'awp', version: '1.0.0' });

// ---- 健全性（認証不要） ----
server.registerTool('awp_health', {
  title: 'AWP の本番の健全性',
  description: '本番のバックエンドが起動しているか、デプロイ中のコミット、AI接続（Anthropic）の可否、Claude Platform の利用可否を返す。認証不要'
}, async () => guard(async () => {
  const [h, ai] = await Promise.all([api('GET', '/health'), fetch(`${BASE}/api/health/ai`).then((r) => r.json())]);
  return { backend: h, ai, frontend: FRONT };
}));

// ---- AI企業: 状況 ----
server.registerTool('awp_company_status', {
  title: 'AI企業の状況',
  description: 'AI企業の全体像: 目標とKPI、いま動いているエージェント（口調つき進行状況）、承認待ち、タスクの件数、今月のAI費用と上限、組織（各エージェントの稼働・モデル・予算）、直近の報告。長いので section で絞れる',
  inputSchema: { section: z.enum(['summary', 'activity', 'approvals', 'org', 'tasks', 'reports', 'events', 'costs', 'all']).default('summary').describe('返す部分') }
}, async ({ section }) => guard(async () => {
  const s = await api('GET', '/company/status');
  if (section === 'all') return s;
  if (section === 'summary') {
    return {
      paused: s.paused, engine: s.engine, health: s.health, monthly: s.monthly,
      goals: s.goals?.map((g: any) => ({ id: g.id, title: g.title, status: g.status, kpis: g.kpis })),
      activity: s.activity, pendingApprovals: s.actions?.length ?? 0,
      taskCounts: Object.fromEntries(['queued', 'running', 'awaiting_approval', 'verifying', 'done', 'failed'].map((k) => [k, s.tasks?.filter((t: any) => t.status === k).length ?? 0])),
      adminUrl: `${FRONT}/admin/company`
    };
  }
  if (section === 'activity') return s.activity;
  if (section === 'approvals') return s.actions;
  if (section === 'org') return s.org;
  if (section === 'tasks') return s.tasks?.slice(0, 100);
  if (section === 'reports') return s.reports;
  if (section === 'events') return s.events?.slice(0, 80);
  if (section === 'costs') return { monthly: s.monthly, costs: s.costs };
  return s;
}));

// ---- タスク ----
server.registerTool('awp_tasks', {
  title: 'タスク一覧',
  description: 'AI企業のタスクを状態・担当で絞って一覧する',
  inputSchema: { status: z.string().optional().describe('queued / running / awaiting_approval / verifying / done / failed / cancelled'), assignee: z.string().optional().describe('エージェントのキー（ceo, coo, research, …）'), limit: z.number().int().min(1).max(200).default(50) }
}, async ({ status, assignee, limit }) => guard(async () => {
  const s = await api('GET', '/company/status');
  return (s.tasks ?? []).filter((t: any) => (!status || t.status === status) && (!assignee || t.assignee === assignee)).slice(0, limit)
    .map((t: any) => ({ id: t.id, title: t.title, assignee: t.assignee, status: t.status, risk: t.risk, costUsd: t.costUsd, createdAt: t.createdAt, summary: t.result?.summary?.slice(0, 200) ?? null, error: t.error ?? null }));
}));

server.registerTool('awp_task', {
  title: 'タスクの詳細',
  description: 'タスクの指示・結果（報告・事実・成果物・次の行動）・実行履歴（費用、Claude Platform の Console リンク）・承認・子タスクを返す',
  inputSchema: { id: z.string() }
}, async ({ id }) => guard(() => api('GET', `/company/tasks/${encodeURIComponent(id)}`)));

server.registerTool('awp_create_task', {
  title: 'タスクを作る',
  description: 'エージェントにタスクを割り当てる。作ったタスクは AI企業のループが拾って（Claude Platform のセッションとして）実行する。実行はバックグラウンドで、結果は awp_task で確認する',
  inputSchema: {
    assignee: z.string().describe('ceo / coo / research / product / engineering / qa / data / marketing / content / growth / cs / finance / partnership / security / legal / auditor'),
    title: z.string().max(120),
    instructions: z.string().max(8000).describe('目的・期待する成果物・制約を具体的に'),
    risk: z.enum(['low', 'medium', 'high']).default('low')
  }
}, async (args) => guard(() => api('POST', '/company/tasks', args)));

server.registerTool('awp_run_task', { title: 'タスクを今すぐ実行', description: '待機中のタスクを順番を待たずに実行する', inputSchema: { id: z.string() } },
  async ({ id }) => guard(() => api('POST', `/company/tasks/${encodeURIComponent(id)}/run`)));
server.registerTool('awp_cancel_task', { title: 'タスクを取り消す', description: '待機中・実行中のタスクを取り消す', inputSchema: { id: z.string() } },
  async ({ id }) => guard(() => api('POST', `/company/tasks/${encodeURIComponent(id)}/cancel`)));

// ---- 承認（human on the loop） ----
server.registerTool('awp_decide_action', {
  title: '承認待ちの操作を承認／却下',
  description: 'エージェントが求めている高リスク操作（お金・設定・公開に関わるもの）を承認または却下する。承認すると実行され、結果はエージェントに新しいタスクとして返る。必ず内容（awp_company_status section=approvals）を確認してから使う',
  inputSchema: { actionId: z.string(), decision: z.enum(['approve', 'reject']), note: z.string().max(1000).optional().describe('却下の理由など（エージェントに伝わる）') }
}, async ({ actionId, decision, note }) => guard(() => api('POST', `/company/actions/${encodeURIComponent(actionId)}/${decision}`, { note: note ?? '' })));

// ---- メモリ ----
server.registerTool('awp_memory', {
  title: '会社のメモリを読む',
  description: 'エージェントが共有するメモリ（company/strategy、dept:*、agent:* など）を一覧・取得する',
  inputSchema: { scope: z.string().optional().describe('例: company, dept:finance, agent:ceo'), key: z.string().optional().describe('指定すると全文を返す') }
}, async ({ scope, key }) => guard(async () => {
  const q = new URLSearchParams(scope ? { scope } : {});
  const r = await api('GET', `/company/memory${q.toString() ? `?${q}` : ''}`);
  const rows: any[] = r.memory ?? [];
  if (key) return rows.filter((m) => m.key === key);
  return rows.map((m) => ({ scope: m.scope, key: m.key, updatedAt: m.updatedAt, updatedBy: m.updatedBy, preview: String(m.content ?? '').slice(0, 160) }));
}));
server.registerTool('awp_memory_write', {
  title: '会社のメモリに書く',
  description: 'オーナーとして方針や事実をメモリに残す（エージェント全員が次のタスクから読める）',
  inputSchema: { scope: z.string(), key: z.string(), content: z.string().max(20000) }
}, async (args) => guard(() => api('PUT', '/company/memory', args)));

// ---- 目標・設定・運転 ----
server.registerTool('awp_set_goal', {
  title: '目標・KPIを設定',
  description: '会社の目標を新しく作る（既存の目標は保持）。KPI は {key: {target, unit, by}} の形',
  inputSchema: { title: z.string().max(200), kpis: z.record(z.any()).optional(), deadline: z.string().optional() }
}, async (args) => guard(() => api('POST', '/company/goals', args)));
server.registerTool('awp_settings', {
  title: 'AI企業の設定を見る／変える',
  description: 'CEOの日次時刻・月のAI費用上限・同時実行数・Discord 通知。引数なしで現在値',
  inputSchema: { ceoHour: z.number().int().min(0).max(23).optional(), monthlyCapUsd: z.number().min(0).optional(), concurrency: z.number().int().min(1).max(6).optional(), discordApprovals: z.boolean().optional(), discordActivity: z.boolean().optional() }
}, async (args) => guard(() => Object.keys(args).length ? api('PUT', '/company/settings', args) : api('GET', '/company/settings')));
server.registerTool('awp_pause', { title: 'AI企業を一時停止／再開', description: 'paused=true で全エージェントを止める、false で再開', inputSchema: { paused: z.boolean() } },
  async ({ paused }) => guard(() => api('POST', '/company/pause', { paused })));
server.registerTool('awp_cycle', { title: '日次／週次サイクルを今すぐ', description: 'CEOの日次見直し（daily）または週次の財務・指標（weekly）を今すぐ開始する', inputSchema: { kind: z.enum(['daily', 'weekly']) } },
  async ({ kind }) => guard(() => api('POST', `/company/cycle/${kind}`)));
server.registerTool('awp_selftest', { title: '自己点検', description: 'エージェントの自己点検（道具が使えるか・役割どおりか）を配る。agents を省くと全員（約$3〜5）', inputSchema: { agents: z.array(z.string()).optional() } },
  async ({ agents }) => guard(() => api('POST', '/company/selftest', agents ? { agents } : {})));
server.registerTool('awp_agent_config', {
  title: 'エージェントの設定（稼働・モデル・予算）',
  description: 'エージェント1体の稼働／停止、モデル（強い=Opus / 標準=Sonnet / 速い=Haiku のID）、1日の予算を変える',
  inputSchema: { key: z.string(), enabled: z.boolean().optional(), model: z.string().optional(), dailyBudgetUsd: z.number().min(0).max(100).optional() }
}, async ({ key, ...rest }) => guard(() => api('PUT', `/company/agents/${encodeURIComponent(key)}`, rest)));
server.registerTool('awp_managed_sync', { title: 'Claude Platform に同期', description: 'エージェント定義を Claude Platform（Managed Agents）に同期する。変更があった分だけ新しい版になる', inputSchema: { agents: z.array(z.string()).optional() } },
  async ({ agents }) => guard(() => api('POST', '/company/managed/sync', agents ? { agents } : {})));

// ---- ローンチ・クルー ----
server.registerTool('awp_crew_status', {
  title: 'ローンチ・クルーの状況',
  description: '公開（10/28）までのタスク、今日の15分刻みの予定、設定の状態（Discord / GitHub / 暗号化キー）、直近のログ',
  inputSchema: { part: z.enum(['summary', 'tasks', 'today', 'logs', 'all']).default('summary') }
}, async ({ part }) => guard(async () => {
  const s = await api('GET', '/crew/admin/status');
  if (part === 'all') return s;
  if (part === 'tasks') return s.tasks;
  if (part === 'today') return s.today;
  if (part === 'logs') return s.logs;
  const all = s.tasks ?? [];
  const done = all.filter((t: any) => ['done', 'skipped'].includes(t.status)).length;
  return {
    config: s.config, paused: s.paused, launchDay: s.launchDay, today: s.today?.label, progress: `${done}/${all.length}`,
    late: all.filter((t: any) => !['done', 'skipped'].includes(t.status) && t.planDay < s.today?.day).map((t: any) => `${t.key} ${t.title}`),
    blocked: all.filter((t: any) => t.status === 'blocked').map((t: any) => `${t.key} ${t.title}（${t.notes ?? ''}）`),
    inProgress: all.filter((t: any) => ['doing', 'review'].includes(t.status)).map((t: any) => `${t.key} ${t.title} [${t.status}${t.reviewState ? '/' + t.reviewState : ''}] ${t.prUrl ?? t.issueUrl ?? ''}`),
    nextUser: all.filter((t: any) => t.owner === 'user' && t.status === 'todo').slice(0, 5).map((t: any) => `${t.key} ${t.title}（${t.planDay}・${t.estimateMin}分）`)
  };
}));
server.registerTool('awp_crew_task', {
  title: 'クルーのタスクを更新',
  description: 'タスクの状態（todo/doing/done/blocked/skipped）・メモ・予定日を変える。「未着手」に戻すと GitHub の課題との紐づけが外れる',
  inputSchema: { key: z.string(), status: z.string().optional(), notes: z.string().optional(), planDay: z.string().optional(), remainingMin: z.number().int().optional() }
}, async ({ key, ...rest }) => guard(() => api('PUT', `/crew/admin/tasks/${encodeURIComponent(key)}`, rest)));
server.registerTool('awp_crew_tick', { title: 'クルーを今すぐ動かす', description: '5分ごとの処理（予定の案内・GitHub の同期・エージェント担当の配布）を今すぐ実行', inputSchema: {} },
  async () => guard(() => api('POST', '/crew/admin/tick')));

// ---- 運営の全体像 ----
server.registerTool('awp_ops_overview', { title: '運営の全体像', description: '登録・ページ・エラー・通報・注文など、運営者ダッシュボードの数字', inputSchema: {} },
  async () => guard(() => api('GET', '/ops/overview')));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch((e) => { console.error(e); process.exit(1); });
