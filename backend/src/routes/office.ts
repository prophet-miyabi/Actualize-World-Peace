// AWP Operations Office の API（管理者のみ）。
//   GET  /state                              部署・役割・タスク・承認・警報・ループ・KPI・今日の優先・判断が必要なこと
//   GET  /stream                             リアルタイム更新（SSE。Authorization ヘッダー付きの fetch で読む）
//   POST /delegate/plan                      目的から委任プランを作る（Orchestrator）
//   POST /delegate/confirm                   プランを承認してタスクを作る
//   POST /tasks                              役割へ直接タスクを委任する
//   GET  /tasks/:id                          詳細（履歴・操作・承認・子タスク・イベント）
//   POST /tasks/:id/(priority|pause|resume|retry|cancel|instruct)
//   POST /approvals/:id/(approve|reject)     承認トレイ（AgentApproval と CompanyAction の両方）
//   POST /alerts/:id/(ack|resolve)
//   GET  /loops  POST /loops/:key/run  PUT /loops/:key  POST /loops/runs/:id/cancel
import { Router } from 'express';
import { z } from 'zod/v4';
import prisma from '../prisma';
import { authenticate, type AuthRequest } from '../middlewares/auth';
import { executeAction } from '../company/runtime';
import { emitEvent } from '../company/tools';
import {
  DEPARTMENTS, ROLES, ROLE_BY_KEY, TASK_STATES, AGENT_STATES, isRoleKey, roleBrief,
  createDelegation, decideApproval, officeState, officeTick, planDelegation, runTask, startLoop, taskDetail
} from '../company/office';

const router = Router();
router.use(authenticate);
router.use(async (req: AuthRequest, res, next) => {
  const u = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!u?.isAdmin) return res.status(403).json({ error: '管理者のみ利用できます' });
  next();
});

const short = (n: number) => z.string().trim().max(n);
const Risk = z.enum(['low', 'medium', 'high']);
const Recurrence = z.enum(['none', 'daily', 'weekly', 'monthly']);
const DelegateBase = z.object({
  title: short(120).min(1),
  objective: short(4000).min(1),
  priority: z.number().int().min(1).max(5).default(3),
  dueAt: z.string().datetime().optional().nullable(),
  kpi: short(80).optional().nullable(),
  info: short(3000).optional().nullable(),
  approvalRequired: z.boolean().default(false),
  recurrence: Recurrence.optional().nullable(),
  doneCriteria: short(500).optional().nullable(),
  feature: short(80).optional().nullable(),
  services: z.array(short(40)).max(10).default([]),
  risk: Risk.default('low')
});
const fail = (res: any, e: unknown, fb: string) => {
  const msg = e instanceof z.ZodError ? '入力の形式が正しくありません' : (e as any)?.message || fb;
  res.status(e instanceof z.ZodError ? 400 : 500).json({ error: msg });
};

router.get('/meta', (_req, res) => res.json({ departments: DEPARTMENTS, roles: ROLES, taskStates: TASK_STATES, agentStates: AGENT_STATES }));

router.get('/state', async (_req, res) => {
  try { res.json(await officeState()); } catch (e) { fail(res, e, '状態を取得できませんでした'); }
});

// SSE: CompanyEvent と状態の要約を 3 秒ごとに確認し、変化があれば流す
router.get('/stream', async (req: AuthRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const send = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  send('hello', { at: new Date().toISOString() });
  let lastEventAt = new Date();
  let lastSig = '';
  const timer = setInterval(async () => {
    try {
      const events = await prisma.companyEvent.findMany({ where: { createdAt: { gt: lastEventAt } }, orderBy: { createdAt: 'asc' }, take: 50 });
      if (events.length) { lastEventAt = events[events.length - 1].createdAt; send('events', events); }
      const [counts, approvals, actions, alerts] = await Promise.all([
        prisma.companyTask.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.agentApproval.count({ where: { status: 'pending' } }),
        prisma.companyAction.count({ where: { status: 'pending' } }),
        prisma.operationsAlert.count({ where: { status: 'open' } })
      ]);
      const sig = JSON.stringify({ counts, approvals, actions, alerts });
      if (sig !== lastSig) { lastSig = sig; send('summary', { counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])), approvals: approvals + actions, alerts }); }
      res.write(': ping\n\n');
    } catch { /* 次回 */ }
  }, 3000);
  req.on('close', () => clearInterval(timer));
});

router.post('/delegate/plan', async (req: AuthRequest, res) => {
  try {
    const body = DelegateBase.pick({ objective: true, priority: true, dueAt: true, kpi: true, feature: true, services: true }).parse(req.body ?? {});
    const plan = await planDelegation(body.objective, { priority: body.priority, dueAt: body.dueAt ?? null, kpi: body.kpi ?? undefined, feature: body.feature ?? undefined, services: body.services });
    res.json({ plan, roles: plan.steps.map((s) => ({ ...s, roleName: ROLE_BY_KEY.get(s.role)?.name ?? s.role, agent: ROLE_BY_KEY.get(s.role)?.agent ?? null })) });
  } catch (e) { fail(res, e, 'プランを作れませんでした'); }
});

router.post('/delegate/confirm', async (req: AuthRequest, res) => {
  try {
    const body = DelegateBase.extend({ plan: z.object({ summary: z.string(), steps: z.array(z.object({ role: z.string(), title: z.string(), instructions: z.string(), doneCriteria: z.string(), approval: z.boolean(), risk: z.string(), dependsOn: z.array(z.number()).default([]) })).min(1).max(7), approvalPoints: z.array(z.string()).default([]), kpi: z.string().default(''), risks: z.array(z.string()).default([]) }) }).parse(req.body ?? {});
    if (body.plan.steps.some((s) => !isRoleKey(s.role))) return res.status(400).json({ error: '役割が正しくありません' });
    const out = await createDelegation(body.plan, { ...body, dueAt: body.dueAt ? new Date(body.dueAt) : null, recurrence: body.recurrence === 'none' ? null : body.recurrence ?? null }, 'human');
    res.status(201).json({ parent: out.parent, children: out.children });
  } catch (e) { fail(res, e, '委任できませんでした'); }
});

router.post('/tasks', async (req: AuthRequest, res) => {
  try {
    const body = DelegateBase.extend({ role: z.string() }).parse(req.body ?? {});
    if (!isRoleKey(body.role)) return res.status(400).json({ error: '役割が正しくありません' });
    const role = ROLE_BY_KEY.get(body.role)!;
    const goal = await prisma.companyGoal.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });
    const t = await prisma.companyTask.create({ data: {
      title: body.title, assignee: role.agent, role: role.key, createdBy: 'human', goalId: goal?.id ?? null, risk: body.risk, priority: body.priority,
      instructions: `${roleBrief(role.key)}\n\n【目的】${body.objective}${body.info ? `\n【必要な情報】${body.info}` : ''}${body.doneCriteria ? `\n【完了条件】${body.doneCriteria}` : ''}\n\n終わったら finish_task で報告する。`.slice(0, 6000),
      dueAt: body.dueAt ? new Date(body.dueAt) : null, kpi: body.kpi ?? null, approvalRequired: body.approvalRequired, recurrence: body.recurrence === 'none' ? null : body.recurrence ?? null,
      doneCriteria: body.doneCriteria ?? null, feature: body.feature ?? null, services: body.services
    } });
    await emitEvent('office.task.created', 'owner', { id: t.id, role: role.key, title: t.title }, t.id);
    res.status(201).json({ task: t });
  } catch (e) { fail(res, e, 'タスクを作れませんでした'); }
});

router.get('/tasks/:id', async (req, res) => {
  const d = await taskDetail(String(req.params.id));
  if (!d) return res.status(404).json({ error: '見つかりません' });
  res.json(d);
});

router.post('/tasks/:id/:action', async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  const action = String(req.params.action);
  const t = await prisma.companyTask.findUnique({ where: { id } });
  if (!t) return res.status(404).json({ error: '見つかりません' });
  try {
    if (action === 'priority') {
      const priority = z.number().int().min(1).max(5).parse(req.body?.priority);
      await prisma.companyTask.update({ where: { id }, data: { priority } });
    } else if (action === 'pause') {
      if (!['queued', 'awaiting_approval', 'verifying'].includes(t.status)) return res.status(400).json({ error: '実行前・承認待ちのタスクだけ一時停止できます' });
      await prisma.companyTask.update({ where: { id }, data: { status: 'paused', pausedAt: new Date() } });
    } else if (action === 'resume') {
      if (t.status !== 'paused') return res.status(400).json({ error: '一時停止中ではありません' });
      await prisma.companyTask.update({ where: { id }, data: { status: 'queued', pausedAt: null, runAt: new Date() } });
    } else if (action === 'retry') {
      if (!['failed', 'rejected', 'canceled', 'queued', 'paused'].includes(t.status)) return res.status(400).json({ error: 'このタスクは再実行できません' });
      await prisma.companyTask.update({ where: { id }, data: { status: 'queued', pausedAt: null, runAt: new Date(), error: null } });
      void runTask(id).catch((e) => console.error('office retry failed', e?.message));
    } else if (action === 'cancel') {
      await prisma.companyTask.updateMany({ where: { id, status: { in: ['queued', 'paused', 'awaiting_approval', 'verifying', 'failed', 'draft'] } }, data: { status: 'canceled' } });
    } else if (action === 'instruct') {
      const text = z.string().trim().min(1).max(3000).parse(req.body?.text);
      const child = await prisma.companyTask.create({ data: {
        parentId: id, title: `追加指示: ${t.title}`.slice(0, 120), assignee: t.assignee, role: t.role, createdBy: 'human', risk: t.risk, priority: Math.min(t.priority, 2), approvalRequired: t.approvalRequired, kpi: t.kpi, feature: t.feature, services: t.services,
        instructions: `${roleBrief(t.role ?? '')}\n\n【管理者からの追加指示】${text}\n\n【元のタスク】${t.title}\n${t.instructions.slice(0, 2500)}\n\n追加指示を反映して進め、finish_task で報告する。`.slice(0, 6000)
      } });
      await emitEvent('office.task.instructed', 'owner', { taskId: id, childId: child.id }, id);
      return res.status(201).json({ task: child });
    } else if (action === 'run') {
      await prisma.companyTask.update({ where: { id }, data: { status: 'queued', pausedAt: null, runAt: new Date(), error: null } });
      void runTask(id).catch((e) => console.error('office run failed', e?.message));
    } else {
      return res.status(400).json({ error: '操作が正しくありません' });
    }
    await emitEvent(`office.task.${action}`, 'owner', { taskId: id }, id);
    res.json({ ok: true });
  } catch (e) { fail(res, e, '操作に失敗しました'); }
});

router.post('/approvals/:id/:decision', async (req: AuthRequest, res) => {
  const decision = String(req.params.decision);
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: '操作が正しくありません' });
  const id = String(req.params.id);
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 1000) : undefined;
  try {
    const approval = await prisma.agentApproval.findUnique({ where: { id } });
    if (approval) {
      await decideApproval(id, decision as 'approve' | 'reject', req.user!.id, note);
      return res.json({ ok: true });
    }
    const a = await prisma.companyAction.findUnique({ where: { id } });
    if (!a || a.status !== 'pending') return res.status(404).json({ error: '承認待ちの項目がありません' });
    await prisma.companyAction.update({ where: { id: a.id }, data: { status: decision === 'approve' ? 'approved' : 'rejected', decidedBy: req.user!.id, decidedAt: new Date() } });
    await emitEvent(decision === 'approve' ? 'action.approved' : 'action.rejected', 'owner', { actionId: a.id, tool: a.tool }, a.taskId);
    if (decision === 'approve') await executeAction(a.id, req.user!.id);
    else {
      await prisma.companyTask.update({ where: { id: a.taskId }, data: { status: 'rejected' } }).catch(() => {});
      await prisma.companyTask.create({ data: { parentId: a.taskId, assignee: a.agent, createdBy: 'human', title: `却下された操作の見直し: ${a.tool}`.slice(0, 120), instructions: `あなたが依頼した操作「${a.tool}」（理由: ${a.reason}）は管理者に却下されました${note ? `（コメント: ${note}）` : ''}。別の方法を検討し、finish_task で報告してください。`, risk: 'low' } });
    }
    res.json({ ok: true });
  } catch (e) { fail(res, e, '承認処理に失敗しました'); }
});

router.post('/alerts/:id/:action', async (req, res) => {
  const action = String(req.params.action);
  if (!['ack', 'resolve'].includes(action)) return res.status(400).json({ error: '操作が正しくありません' });
  await prisma.operationsAlert.update({ where: { id: String(req.params.id) }, data: { status: action === 'ack' ? 'acked' : 'resolved' } }).catch(() => null);
  res.json({ ok: true });
});

router.get('/loops', async (_req, res) => {
  const loops = await prisma.agentLoopDefinition.findMany({ orderBy: { key: 'asc' }, include: { runs: { orderBy: { startedAt: 'desc' }, take: 10, include: { tasks: { select: { id: true, title: true, status: true, role: true }, orderBy: { createdAt: 'asc' } } } } } });
  res.json({ loops });
});

router.post('/loops/:key/run', async (req: AuthRequest, res) => {
  try { res.status(201).json({ run: await startLoop(String(req.params.key), 'human') }); } catch (e) { fail(res, e, 'ループを開始できませんでした'); }
});

router.put('/loops/:key', async (req, res) => {
  try {
    const body = z.object({ autoRun: z.boolean().optional(), enabled: z.boolean().optional(), schedule: Recurrence.optional() }).parse(req.body ?? {});
    const l = await prisma.agentLoopDefinition.update({ where: { key: String(req.params.key) }, data: { ...(body.autoRun !== undefined ? { autoRun: body.autoRun } : {}), ...(body.enabled !== undefined ? { enabled: body.enabled } : {}), ...(body.schedule ? { schedule: body.schedule } : {}) } });
    await emitEvent('office.loop.updated', 'owner', { loopKey: l.key, autoRun: l.autoRun, enabled: l.enabled, schedule: l.schedule });
    res.json({ loop: l });
  } catch (e) { fail(res, e, '更新できませんでした'); }
});

router.post('/loops/runs/:id/cancel', async (req, res) => {
  const run = await prisma.agentLoopRun.findUnique({ where: { id: String(req.params.id) } });
  if (!run) return res.status(404).json({ error: '見つかりません' });
  await prisma.agentLoopRun.update({ where: { id: run.id }, data: { status: 'canceled', finishedAt: new Date() } });
  await prisma.companyTask.updateMany({ where: { loopRunId: run.id, status: { in: ['queued', 'paused', 'awaiting_approval', 'verifying'] } }, data: { status: 'canceled' } });
  res.json({ ok: true });
});

router.post('/tick', async (_req, res) => { await officeTick(); res.json({ ok: true }); });

export default router;
