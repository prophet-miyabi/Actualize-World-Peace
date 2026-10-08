import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { getFlag, setFlag, SETTING_KEYS } from '../lib/systemSettings';
import { AGENTS, isAgentKey } from '../company/registry';
import { collectCosts, collectMetrics, emitEvent } from '../company/tools';
import { agentConfig, COMPANY_MONTHLY_CAP_USD, executeAction, runTask, spentThisMonthUsd, spentTodayUsd } from '../company/runtime';
import { companyTick } from '../company/loop';
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
  const [goals, tasks, actions, events, costs, metrics, paused, configs] = await Promise.all([
    prisma.companyGoal.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.companyTask.findMany({ orderBy: { createdAt: 'desc' }, take: 80, select: { id: true, title: true, assignee: true, createdBy: true, status: true, risk: true, result: true, verification: true, error: true, parentId: true, costUsd: true, runAt: true, createdAt: true, finishedAt: true } }),
    prisma.companyAction.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, include: { task: { select: { title: true } } } }),
    prisma.companyEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 40 }),
    collectCosts(),
    collectMetrics(30),
    getFlag(SETTING_KEYS.pauseCompany),
    prisma.companyAgentConfig.findMany()
  ]);
  const cfgBy = Object.fromEntries(configs.map((c) => [c.key, c]));
  const todayBy = Object.fromEntries(costs.companyAgentsToday.map((c) => [c.agent, c.costUsd]));
  const org = AGENTS.map((a) => ({
    key: a.key, name: a.name, department: a.department, reportsTo: a.reportsTo, mission: a.mission, tools: a.tools, maxAutoRisk: a.maxAutoRisk, webSearch: !!a.webSearch,
    model: cfgBy[a.key]?.model || a.model, enabled: cfgBy[a.key]?.enabled ?? true, dailyBudgetUsd: cfgBy[a.key]?.dailyBudgetUsd ?? a.dailyBudgetUsd, spentTodayUsd: todayBy[a.key] ?? 0
  }));
  res.json({ configured: !!process.env.ANTHROPIC_API_KEY, paused, goals, org, tasks, actions, events, costs, metrics, monthly: { spentUsd: await spentThisMonthUsd(), capUsd: COMPANY_MONTHLY_CAP_USD } });
});

router.get('/tasks/:id', async (req, res) => {
  const t = await prisma.companyTask.findUnique({ where: { id: String(req.params.id) }, include: { actions: true, runs: true } });
  if (!t) return res.status(404).json({ error: '見つかりません' });
  const children = await prisma.companyTask.findMany({ where: { parentId: t.id }, select: { id: true, title: true, assignee: true, status: true } });
  res.json({ task: t, children });
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

router.post('/tick', async (_req, res) => {
  await prisma.crewState.deleteMany({ where: { key: 'company:ceoDay' } });
  await companyTick();
  res.json({ ok: true });
});

export default router;
