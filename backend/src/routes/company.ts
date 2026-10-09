import { Router } from 'express';
import prisma from '../prisma';
import { describeAiError } from '../lib/aiUsage';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { getFlag, setFlag, SETTING_KEYS } from '../lib/systemSettings';
import { AGENTS, isAgentKey, COMPANY_MODELS } from '../company/registry';
import { consoleSessionUrl, managedEnabled, syncManagedAgents } from '../company/managed';
import { collectCosts, collectMetrics, emitEvent } from '../company/tools';
import { agentConfig, executeAction, monthlyCapUsd, runTask, spentThisMonthUsd, spentTodayUsd } from '../company/runtime';
import { getCompanySettings, setCompanySettings } from '../company/settings';
import { ceoDailyCycle, weeklyCycle } from '../company/loop';
import { companyTick } from '../company/loop';
import { chatWithAgent, type ChatTurn } from '../company/chat';
import { seedCompany } from '../company/seed';

// AI企業の管理画面用API（運営者のみ）: 組織図・目標・タスク・承認待ち・メモリ・イベント・費用
const router = Router();
router.use(authenticate);
router.use(async (req: AuthRequest, res, next) => {
  const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!u?.isAdmin) return res.status(403).json({ error: '管理者のみ利用できます' });
  next();
});

router.get('/status', async (_req, res) => {
  await seedCompany();
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const since24 = new Date(Date.now() - 86_400_000);
  const [goals, tasks, actions, decided, events, costs, metrics, paused, configs, settings, reports, lastTick, counts, stats, lastRuns, selftests] = await Promise.all([
    prisma.companyGoal.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.companyTask.findMany({ orderBy: { createdAt: 'desc' }, take: 120, select: { id: true, title: true, assignee: true, createdBy: true, status: true, risk: true, result: true, verification: true, error: true, parentId: true, costUsd: true, runAt: true, createdAt: true, finishedAt: true } }),
    prisma.companyAction.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, include: { task: { select: { title: true } } } }),
    prisma.companyAction.findMany({ where: { status: { not: 'pending' } }, orderBy: { decidedAt: 'desc' }, take: 20, include: { task: { select: { title: true } } } }),
    prisma.companyEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }),
    collectCosts(),
    collectMetrics(30),
    getFlag(SETTING_KEYS.pauseCompany),
    prisma.companyAgentConfig.findMany(),
    getCompanySettings(),
    prisma.companyMemory.findMany({ where: { scope: 'dept:executive', key: { startsWith: 'report-' } }, orderBy: { updatedAt: 'desc' }, take: 10 }),
    prisma.crewState.findUnique({ where: { key: 'company:lastTick' } }),
    prisma.companyTask.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.companyTask.groupBy({ by: ['assignee', 'status'], _count: { _all: true }, where: { createdAt: { gte: since30 } } }),
    prisma.agentRun.groupBy({ by: ['agent'], _max: { startedAt: true } }),
    prisma.companyTask.findMany({ where: { title: { startsWith: '自己点検:' } }, orderBy: { createdAt: 'desc' }, take: 40, select: { assignee: true, status: true, costUsd: true, result: true, error: true, createdAt: true, runs: { select: { toolCalls: true } } } })
  ]);
  const cfgBy = Object.fromEntries(configs.map((c) => [c.key, c]));
  const todayBy = Object.fromEntries(costs.companyAgentsToday.map((c) => [c.agent, c.costUsd]));
  const lastBy = Object.fromEntries(lastRuns.map((r) => [r.agent, r._max.startedAt]));
  const statBy: Record<string, { done: number; failed: number; other: number }> = {};
  for (const st of stats) {
    const b = (statBy[st.assignee] ||= { done: 0, failed: 0, other: 0 });
    if (st.status === 'done') b.done += st._count._all; else if (st.status === 'failed' || st.status === 'rejected') b.failed += st._count._all; else b.other += st._count._all;
  }
  const selfBy: Record<string, any> = {};
  for (const t of selftests) if (!selfBy[t.assignee]) selfBy[t.assignee] = { status: t.status, costUsd: t.costUsd, toolCalls: t.runs.reduce((a, r) => a + r.toolCalls, 0), summary: (t.result as any)?.summary?.slice(0, 200) ?? null, error: t.error, at: t.createdAt };
  const org = AGENTS.map((a) => ({
    key: a.key, name: a.name, department: a.department, reportsTo: a.reportsTo, mission: a.mission, tools: a.tools, maxAutoRisk: a.maxAutoRisk, webSearch: !!a.webSearch,
    model: cfgBy[a.key]?.model || a.model, defaultModel: a.model, enabled: cfgBy[a.key]?.enabled ?? true, dailyBudgetUsd: cfgBy[a.key]?.dailyBudgetUsd ?? a.dailyBudgetUsd, spentTodayUsd: todayBy[a.key] ?? 0,
    stats30d: statBy[a.key] ?? { done: 0, failed: 0, other: 0 }, lastRunAt: lastBy[a.key] ?? null, selftest: selfBy[a.key] ?? null,
    managed: cfgBy[a.key]?.managedAgentId ? { id: cfgBy[a.key]!.managedAgentId, version: cfgBy[a.key]!.managedVersion, syncedAt: cfgBy[a.key]!.managedSyncedAt } : null
  }));
  const countBy = Object.fromEntries(counts.map((c) => [c.status, c._count._all]));
  const failed24h = await prisma.companyTask.count({ where: { status: 'failed', updatedAt: { gte: since24 } } });
  const ceoDay = await prisma.crewState.findUnique({ where: { key: 'company:ceoDay' } });
  const managedEnv = await prisma.systemSetting.findUnique({ where: { key: 'company_managed_environment' } });
  res.json({
    configured: !!process.env.ANTHROPIC_API_KEY, paused, goals, org, tasks, actions, decided, events, costs, metrics, settings, reports,
    monthly: { spentUsd: await spentThisMonthUsd(), capUsd: await monthlyCapUsd() },
    health: { lastTickAt: lastTick?.value ?? null, queued: countBy.queued ?? 0, running: countBy.running ?? 0, awaitingApproval: countBy.awaiting_approval ?? 0, verifying: countBy.verifying ?? 0, failed24h, lastCeoDay: ceoDay?.value ?? null },
    models: COMPANY_MODELS,
    engine: { kind: managedEnabled() ? 'managed' : 'messages', environmentId: managedEnv?.value ?? null, workspace: (process.env.ANTHROPIC_WORKSPACE_ID || '').trim() || 'default' }
  });
});

// Claude Platform（Managed Agents）へエージェント定義を同期する。変更があった分だけ新しい版になる
router.post('/managed/sync', async (req: AuthRequest, res) => {
  const keys = Array.isArray(req.body?.agents) ? req.body.agents.map(String).filter(isAgentKey) : undefined;
  try {
    const r = await syncManagedAgents(keys);
    await emitEvent('managed.synced', 'owner', { environmentId: r.environmentId, results: r.results.map((x) => `${x.key}:${x.status}${x.version ? ' v' + x.version : ''}`) });
    res.json(r);
  } catch (e: any) {
    res.status(500).json({ error: describeAiError(e) });
  }
});

router.get('/settings', async (_req, res) => res.json({ settings: await getCompanySettings() }));
router.put('/settings', async (req: AuthRequest, res) => {
  const settings = await setCompanySettings(req.body ?? {}, req.user!.id);
  await emitEvent('settings.changed', 'owner', settings as any);
  res.json({ settings });
});

// 目標の編集（KPIも）
router.put('/goals/:id/edit', async (req: AuthRequest, res) => {
  const g = await prisma.companyGoal.findUnique({ where: { id: String(req.params.id) } });
  if (!g) return res.status(404).json({ error: '見つかりません' });
  const title = String(req.body?.title ?? g.title).trim().slice(0, 200);
  const description = String(req.body?.description ?? g.description).trim().slice(0, 4000);
  const kpis = Array.isArray(req.body?.kpis)
    ? req.body.kpis.slice(0, 20).map((k: any) => ({ key: String(k.key ?? '').slice(0, 40), label: String(k.label ?? '').slice(0, 60), target: Number(k.target) || 0, unit: String(k.unit ?? '').slice(0, 10), by: String(k.by ?? '').slice(0, 20) })).filter((k: any) => k.key && k.label)
    : (g.kpis as any);
  const updated = await prisma.companyGoal.update({ where: { id: g.id }, data: { title, description, kpis } });
  await emitEvent('goal.edited', 'owner', { id: g.id, title });
  res.json({ goal: updated });
});

// 経営サイクルを手動で動かす（日次／週次）
router.post('/cycle/:kind', async (req: AuthRequest, res) => {
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  if (req.params.kind === 'daily') await ceoDailyCycle(day);
  else if (req.params.kind === 'weekly') await weeklyCycle(day);
  else return res.status(400).json({ error: 'daily か weekly' });
  await emitEvent('cycle.manual', 'owner', { kind: req.params.kind, day });
  void companyTick();
  res.json({ ok: true });
});

// 自己点検: 全エージェントに小さなタスクを配り、道具が使えるか・報告できるかを確かめる（低リスクのみ）
router.post('/selftest', async (req: AuthRequest, res) => {
  const keys: string[] = Array.isArray(req.body?.agents) && req.body.agents.length ? req.body.agents.filter(isAgentKey) : AGENTS.map((a) => a.key);
  const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
  let created = 0;
  for (const key of keys) {
    const a = AGENTS.find((x) => x.key === key)!;
    const readTool = a.tools.find((t) => t.startsWith('get_') || t === 'list_tasks' || t === 'list_events') ?? 'read_memory';
    await prisma.companyTask.create({
      data: {
        assignee: key, createdBy: 'human', risk: 'low', title: `自己点検: ${a.name} ${stamp}`.slice(0, 120),
        instructions: [
          'これは自己点検です。次を順に行ってください。',
          `1. 道具 ${readTool} を1回使って、実際のデータを1つ以上読む`,
          '2. read_memory で company スコープの一覧を読む',
          `3. write_memory(agent:${key}, selftest) に「点検日時・使った道具・自分の役割の一言」を保存する`,
          '4. finish_task で報告する。facts には道具で取れた具体的な値を1つ以上、artifacts にはメモリのキーを書く',
          '新しいタスクや実装依頼は作らないこと。'
        ].join(String.fromCharCode(10))
      }
    });
    created++;
  }
  await emitEvent('selftest.started', 'owner', { agents: keys });
  void companyTick();
  res.json({ ok: true, created });
});

router.get('/tasks/:id', async (req, res) => {
  const t = await prisma.companyTask.findUnique({ where: { id: String(req.params.id) }, include: { actions: true, runs: true } });
  if (!t) return res.status(404).json({ error: '見つかりません' });
  const children = await prisma.companyTask.findMany({ where: { parentId: t.id }, select: { id: true, title: true, assignee: true, status: true } });
  const runs = t.runs.map((r) => ({ ...r, consoleUrl: r.sessionId ? consoleSessionUrl(r.sessionId) : null }));
  res.json({ task: { ...t, runs }, children });
});

router.get('/memory', async (req, res) => {
  const scope = typeof req.query.scope === 'string' ? req.query.scope : undefined;
  const rows = await prisma.companyMemory.findMany({ where: scope ? { scope } : {}, orderBy: { updatedAt: 'desc' }, take: 200 });
  res.json({ memory: rows });
});

router.put('/memory', async (req: AuthRequest, res) => {
  const scope = String(req.body?.scope ?? '').slice(0, 60);
  const key = String(req.body?.key ?? '').slice(0, 80);
  const content = String(req.body?.content ?? '').slice(0, 40_000);
  if (!scope || !key || !content) return res.status(400).json({ error: 'scope・key・content が必要です' });
  const row = await prisma.companyMemory.upsert({ where: { scope_key: { scope, key } }, update: { content, updatedBy: 'owner' }, create: { scope, key, content, updatedBy: 'owner' } });
  await emitEvent('memory.written', 'owner', { scope, key });
  res.json({ memory: row });
});

router.post('/goals', async (req: AuthRequest, res) => {
  const title = String(req.body?.title ?? '').trim().slice(0, 200);
  const description = String(req.body?.description ?? '').trim().slice(0, 4000);
  const kpis = Array.isArray(req.body?.kpis) ? req.body.kpis.slice(0, 20) : [];
  if (!title) return res.status(400).json({ error: '目標を入力してください' });
  const g = await prisma.companyGoal.create({ data: { title, description, kpis, setBy: req.user!.id } });
  await emitEvent('goal.set', 'owner', { id: g.id, title });
  res.status(201).json({ goal: g });
});

router.put('/goals/:id', async (req: AuthRequest, res) => {
  const status = String(req.body?.status);
  if (!['active', 'paused', 'achieved', 'dropped'].includes(status)) return res.status(400).json({ error: '状態が正しくありません' });
  const g = await prisma.companyGoal.update({ where: { id: String(req.params.id) }, data: { status } });
  res.json({ goal: g });
});

// 人間からの直接の指示（CEO または任意のエージェントへ）
router.post('/tasks', async (req: AuthRequest, res) => {
  const assignee = String(req.body?.assignee ?? 'ceo');
  if (!isAgentKey(assignee)) return res.status(400).json({ error: '担当が正しくありません' });
  const title = String(req.body?.title ?? '').trim().slice(0, 120);
  const instructions = String(req.body?.instructions ?? '').trim().slice(0, 6000);
  if (!title || !instructions) return res.status(400).json({ error: '題名と指示を入力してください' });
  const goal = await prisma.companyGoal.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });
  const t = await prisma.companyTask.create({ data: { assignee, title, instructions, createdBy: 'human', goalId: goal?.id ?? null, risk: req.body?.risk === 'medium' ? 'medium' : 'low' } });
  await emitEvent('task.created', 'owner', { id: t.id, assignee, title });
  res.status(201).json({ task: t });
});

router.post('/tasks/:id/run', async (req: AuthRequest, res) => {
  const t = await prisma.companyTask.findUnique({ where: { id: String(req.params.id) } });
  if (!t) return res.status(404).json({ error: '見つかりません' });
  if (t.status !== 'queued') await prisma.companyTask.update({ where: { id: t.id }, data: { status: 'queued', runAt: new Date(), error: null } });
  void runTask(t.id).catch((e) => console.error('run task failed', e?.message));
  res.json({ ok: true });
});

router.post('/tasks/:id/cancel', async (req: AuthRequest, res) => {
  await prisma.companyTask.updateMany({ where: { id: String(req.params.id), status: { in: ['queued', 'awaiting_approval', 'verifying', 'failed'] } }, data: { status: 'canceled' } });
  res.json({ ok: true });
});

router.post('/actions/:id/:decision', async (req: AuthRequest, res) => {
  const decision = String(req.params.decision);
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: '操作が正しくありません' });
  const a = await prisma.companyAction.findUnique({ where: { id: String(req.params.id) } });
  if (!a || a.status !== 'pending') return res.status(400).json({ error: '承認待ちの操作ではありません' });
  await prisma.companyAction.update({ where: { id: a.id }, data: { status: decision === 'approve' ? 'approved' : 'rejected', decidedBy: req.user!.id, decidedAt: new Date() } });
  await emitEvent(decision === 'approve' ? 'action.approved' : 'action.rejected', 'owner', { actionId: a.id, tool: a.tool }, a.taskId);
  if (decision === 'approve') {
    await executeAction(a.id, req.user!.id);
  } else {
    await prisma.companyTask.update({ where: { id: a.taskId }, data: { status: 'rejected' } }).catch(() => {});
    await prisma.companyTask.create({
      data: { parentId: a.taskId, assignee: a.agent, createdBy: 'human', title: `却下された操作の見直し: ${a.tool}`.slice(0, 120), instructions: `あなたが依頼した操作「${a.tool}」（理由: ${a.reason}）は人間に却下されました${req.body?.note ? `（コメント: ${String(req.body.note).slice(0, 500)}）` : ''}。別の方法を検討し、finish_task で報告してください。`, risk: 'low' }
    });
  }
  res.json({ ok: true });
});

router.put('/agents/:key', async (req, res) => {
  const key = String(req.params.key);
  if (!isAgentKey(key)) return res.status(404).json({ error: '見つかりません' });
  const data: any = {};
  if (req.body?.enabled !== undefined) data.enabled = !!req.body.enabled;
  if (req.body?.model !== undefined) data.model = String(req.body.model).slice(0, 80) || null;
  if (req.body?.dailyBudgetUsd !== undefined) {
    const n = Number(req.body.dailyBudgetUsd);
    if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ error: '予算は0〜100ドル' });
    data.dailyBudgetUsd = n;
  }
  const c = await prisma.companyAgentConfig.upsert({ where: { key }, update: data, create: { key, ...data } });
  res.json({ config: c, spentTodayUsd: await spentTodayUsd(key), effective: await agentConfig(AGENTS.find((a) => a.key === key)!) });
});

router.post('/pause', async (req: AuthRequest, res) => {
  await setFlag(SETTING_KEYS.pauseCompany, !!req.body?.paused, req.user!.id);
  await emitEvent(req.body?.paused ? 'company.paused' : 'company.started', 'owner');
  res.json({ paused: !!req.body?.paused });
});

// ---- 運営者とエージェントの会話 ----
router.get('/chats', async (_req, res) => {
  const chats = await prisma.companyChat.findMany({ orderBy: { updatedAt: 'desc' }, take: 50, select: { id: true, agent: true, title: true, costUsd: true, updatedAt: true } });
  res.json({ chats });
});

router.post('/chats', async (req, res) => {
  const agent = String(req.body?.agent ?? 'ceo');
  if (!isAgentKey(agent)) return res.status(400).json({ error: 'エージェントが正しくありません' });
  const chat = await prisma.companyChat.create({ data: { agent, title: '新しい会話', messages: [] } });
  res.status(201).json({ chat });
});

router.get('/chats/:id', async (req, res) => {
  const chat = await prisma.companyChat.findUnique({ where: { id: String(req.params.id) } });
  if (!chat) return res.status(404).json({ error: '見つかりません' });
  const actions = chat.taskId ? await prisma.companyAction.findMany({ where: { taskId: chat.taskId }, orderBy: { createdAt: 'asc' } }) : [];
  res.json({ chat, actions });
});

router.delete('/chats/:id', async (req, res) => {
  await prisma.companyChat.deleteMany({ where: { id: String(req.params.id) } });
  res.json({ ok: true });
});

// メッセージを送り、返答をSSEで流す。会話の記録はサーバー側で保存する
router.post('/chats/:id/messages', async (req: AuthRequest, res) => {
  const chat = await prisma.companyChat.findUnique({ where: { id: String(req.params.id) } });
  if (!chat) return res.status(404).json({ error: '見つかりません' });
  const text = String(req.body?.text ?? '').trim().slice(0, 6000);
  if (!text) return res.status(400).json({ error: 'メッセージを入力してください' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY が未設定です' });
  if (await getFlag(SETTING_KEYS.pauseCompany)) return res.status(409).json({ error: 'AI企業は停止中です（管理画面で開始してください）' });

  const prior = ((chat.messages as any[]) ?? []) as { role: 'user' | 'assistant'; content: string }[];
  const history: ChatTurn[] = [...prior.map((m) => ({ role: m.role, content: String(m.content) })), { role: 'user', content: text }];
  const title = prior.length === 0 ? text.slice(0, 40) : chat.title;
  await prisma.companyChat.update({ where: { id: chat.id }, data: { title, messages: [...prior, { role: 'user', content: text }] as any } });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  let reply = '';
  const tools: string[] = [];
  const actions: { id: string; tool: string; reason: string }[] = [];
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  try {
    await chatWithAgent(chat.agent, history, chat.id, (e) => {
      if (e.type === 'text') reply += e.text;
      if (e.type === 'tool') tools.push(e.name);
      if (e.type === 'action') actions.push({ id: e.id, tool: e.tool, reason: e.reason });
      send(e);
    });
  } catch (e: any) {
    send({ type: 'error', message: String(e?.message ?? e).slice(0, 300) });
  }
  const latest = await prisma.companyChat.findUnique({ where: { id: chat.id } });
  await prisma.companyChat.update({ where: { id: chat.id }, data: { messages: [...((latest?.messages as any[]) ?? []), { role: 'assistant', content: reply || '（返答なし）', tools, actions }] as any } });
  await emitEvent('chat.turn', chat.agent, { chatId: chat.id, tools: tools.length, actions: actions.length });
  res.end();
});

router.post('/tick', async (_req, res) => {
  await prisma.crewState.deleteMany({ where: { key: 'company:ceoDay' } });
  await companyTick();
  res.json({ ok: true });
});

export default router;
