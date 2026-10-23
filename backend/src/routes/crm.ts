// AWP Harness（自社実装）の API。/api/harness/crm 配下。ログイン中の利用者（事業者）のデータだけを扱う。
//   GET  /summary                      顧客数・段階・ゲート・シナリオ・配信アカウントの健全性
//   GET  /contacts?q=&stage=           顧客一覧（スコア順）  PATCH /contacts/:id  POST /contacts/:id/tags
//   GET/POST /tags                     タグ
//   GET/POST /scenarios  PUT /scenarios/:id  DELETE /scenarios/:id   POST /scenarios/:id/enroll { contactId }
//   GET/POST /gates  PUT /gates/:id  DELETE /gates/:id
//   GET/POST /rules  PUT /rules/:id  DELETE /rules/:id
//   GET/POST /pools  PUT /pools/:id
//   POST /link { contactId, path }     クロスUUID 付きリンク
//   GET  /webhook-key                  外部からゲートを叩くためのキー
//   POST /webhook/:ownerId/:channel    外部（自前の受信口・連携ツール）からの受信 { key, externalUserId, text, displayName?, postExternalId? }
import { Router } from 'express';
import { z } from 'zod/v4';
import prisma from '../prisma';
import { authenticate, type AuthRequest } from '../middlewares/auth';
import { accountHealth, crossLink, enroll, matchGate, processDueEnrollments, webhookKey, type HarnessChannel } from '../automation/harnessEngine';

const router = Router();
const short = (n: number) => z.string().trim().max(n);
const Channel = z.enum(['line', 'x', 'instagram', 'tiktok']);
const bad = (res: any, e: unknown, fb: string) => res.status(e instanceof z.ZodError ? 400 : 500).json({ error: e instanceof z.ZodError ? '入力の形式が正しくありません' : (e as any)?.message || fb });

// ---- 外部からの受信（認証はキーで） ----
router.post('/webhook/:ownerId/:channel', async (req, res) => {
  try {
    const ownerId = String(req.params.ownerId);
    const channel = Channel.parse(req.params.channel) as HarnessChannel;
    const body = z.object({ key: z.string(), externalUserId: short(120).min(1), text: short(2000).min(1), displayName: short(80).optional(), postExternalId: short(120).optional() }).parse(req.body ?? {});
    if (body.key !== webhookKey(ownerId)) return res.status(403).json({ error: 'キーが正しくありません' });
    const hit = await matchGate(ownerId, channel, body.externalUserId, body.text, body.displayName ?? null, body.postExternalId ?? null);
    res.json({ matched: !!hit, reply: hit?.reply ?? null, cid: hit?.cid ?? null });
  } catch (e) { bad(res, e, '受信に失敗しました'); }
});

router.use(authenticate);

router.get('/summary', async (req: AuthRequest, res) => {
  const ownerId = req.user!.id;
  const [total, stages, scenarios, health, recent] = await Promise.all([
    prisma.crmContact.count({ where: { ownerId } }),
    prisma.crmContact.groupBy({ by: ['stage'], _count: { _all: true }, where: { ownerId } }),
    prisma.crmScenario.count({ where: { ownerId, active: true } }),
    accountHealth(ownerId),
    prisma.crmContactEvent.findMany({ where: { contact: { ownerId } }, orderBy: { createdAt: 'desc' }, take: 20, include: { contact: { select: { id: true, displayName: true, cid: true } } } })
  ]);
  res.json({ total, stages: Object.fromEntries(stages.map((s) => [s.stage, s._count._all])), scenarios, health, recent, webhookKey: webhookKey(ownerId), ownerId });
});

router.get('/contacts', async (req: AuthRequest, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const stage = typeof req.query.stage === 'string' && req.query.stage ? req.query.stage : undefined;
  const contacts = await prisma.crmContact.findMany({
    where: { ownerId: req.user!.id, ...(stage ? { stage } : {}), ...(q ? { OR: [{ displayName: { contains: q } }, { email: { contains: q } }, { note: { contains: q } }] } : {}) },
    orderBy: [{ leadScore: 'desc' }, { lastSeenAt: 'desc' }], take: 200, include: { tags: { include: { tag: true } }, enrollments: { select: { scenarioId: true, status: true, currentStep: true } } }
  });
  res.json({ contacts: contacts.map((c) => ({ ...c, tags: c.tags.map((t) => t.tag.name) })) });
});
router.patch('/contacts/:id', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ displayName: short(80).optional(), note: short(2000).optional(), stage: z.enum(['lead', 'engaged', 'booked', 'customer', 'lost']).optional(), email: short(120).optional(), phone: short(40).optional() }).parse(req.body ?? {});
    const r = await prisma.crmContact.updateMany({ where: { id: String(req.params.id), ownerId: req.user!.id }, data: body });
    if (!r.count) return res.status(404).json({ error: '見つかりません' });
    res.json({ ok: true });
  } catch (e) { bad(res, e, '更新できませんでした'); }
});
router.post('/contacts/:id/tags', async (req: AuthRequest, res) => {
  try {
    const { name } = z.object({ name: short(30).min(1) }).parse(req.body ?? {});
    const c = await prisma.crmContact.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id }, select: { id: true } });
    if (!c) return res.status(404).json({ error: '見つかりません' });
    const { addTag } = await import('../automation/harnessEngine');
    await addTag(req.user!.id, c.id, name);
    res.json({ ok: true });
  } catch (e) { bad(res, e, 'タグを付けられませんでした'); }
});
router.get('/contacts/:id', async (req: AuthRequest, res) => {
  const c = await prisma.crmContact.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id }, include: { tags: { include: { tag: true } }, events: { orderBy: { createdAt: 'desc' }, take: 50 }, enrollments: { include: { scenario: { select: { name: true } } } } } });
  if (!c) return res.status(404).json({ error: '見つかりません' });
  res.json({ contact: { ...c, tags: c.tags.map((t) => t.tag.name) } });
});

router.get('/tags', async (req: AuthRequest, res) => res.json({ tags: await prisma.crmTag.findMany({ where: { ownerId: req.user!.id }, orderBy: { name: 'asc' }, include: { _count: { select: { contacts: true } } } }) }));
router.post('/tags', async (req: AuthRequest, res) => {
  try {
    const { name, color } = z.object({ name: short(30).min(1), color: short(20).optional() }).parse(req.body ?? {});
    res.status(201).json({ tag: await prisma.crmTag.upsert({ where: { ownerId_name: { ownerId: req.user!.id, name } }, update: { color: color ?? null }, create: { ownerId: req.user!.id, name, color: color ?? null } }) });
  } catch (e) { bad(res, e, 'タグを作れませんでした'); }
});

// ---- シナリオ（ステップ配信） ----
const StepSchema = z.object({ delayMinutes: z.number().int().min(0).max(60 * 24 * 60), template: short(3000).min(1), mediaUrl: short(500).optional().nullable(), linkPath: short(300).optional().nullable() });
const ScenarioSchema = z.object({ name: short(60).min(1), channel: z.enum(['line', 'x', 'instagram']).default('line'), trigger: z.enum(['manual', 'gate', 'line_follow', 'tag', 'booking']).default('manual'), triggerRef: short(60).optional().nullable(), active: z.boolean().default(true), steps: z.array(StepSchema).min(1).max(20) });

router.get('/scenarios', async (req: AuthRequest, res) => {
  const scenarios = await prisma.crmScenario.findMany({ where: { ownerId: req.user!.id }, orderBy: { createdAt: 'desc' }, include: { steps: { orderBy: { order: 'asc' } }, _count: { select: { enrollments: true } } } });
  res.json({ scenarios });
});
router.post('/scenarios', async (req: AuthRequest, res) => {
  try {
    const body = ScenarioSchema.parse(req.body ?? {});
    const sc = await prisma.crmScenario.create({ data: { ownerId: req.user!.id, name: body.name, channel: body.channel, trigger: body.trigger, triggerRef: body.triggerRef ?? null, active: body.active, steps: { create: body.steps.map((s, i) => ({ order: i, delayMinutes: s.delayMinutes, template: s.template, mediaUrl: s.mediaUrl ?? null, linkPath: s.linkPath ?? null })) } }, include: { steps: { orderBy: { order: 'asc' } } } });
    res.status(201).json({ scenario: sc });
  } catch (e) { bad(res, e, 'シナリオを作れませんでした'); }
});
router.put('/scenarios/:id', async (req: AuthRequest, res) => {
  try {
    const body = ScenarioSchema.partial().parse(req.body ?? {});
    const sc = await prisma.crmScenario.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id } });
    if (!sc) return res.status(404).json({ error: '見つかりません' });
    await prisma.$transaction(async (db) => {
      await db.crmScenario.update({ where: { id: sc.id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.channel ? { channel: body.channel } : {}), ...(body.trigger ? { trigger: body.trigger } : {}), ...(body.triggerRef !== undefined ? { triggerRef: body.triggerRef } : {}), ...(body.active !== undefined ? { active: body.active } : {}) } });
      if (body.steps) { await db.crmScenarioStep.deleteMany({ where: { scenarioId: sc.id } }); await db.crmScenarioStep.createMany({ data: body.steps.map((s, i) => ({ scenarioId: sc.id, order: i, delayMinutes: s.delayMinutes, template: s.template, mediaUrl: s.mediaUrl ?? null, linkPath: s.linkPath ?? null })) }); }
    });
    res.json({ scenario: await prisma.crmScenario.findUnique({ where: { id: sc.id }, include: { steps: { orderBy: { order: 'asc' } } } }) });
  } catch (e) { bad(res, e, '更新できませんでした'); }
});
router.delete('/scenarios/:id', async (req: AuthRequest, res) => { await prisma.crmScenario.deleteMany({ where: { id: String(req.params.id), ownerId: req.user!.id } }); res.json({ ok: true }); });
router.post('/scenarios/:id/enroll', async (req: AuthRequest, res) => {
  try {
    const { contactId } = z.object({ contactId: z.string().min(1) }).parse(req.body ?? {});
    const [sc, c] = await Promise.all([prisma.crmScenario.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id }, select: { id: true } }), prisma.crmContact.findFirst({ where: { id: contactId, ownerId: req.user!.id }, select: { id: true } })]);
    if (!sc || !c) return res.status(404).json({ error: '見つかりません' });
    res.status(201).json({ enrollment: await enroll(sc.id, c.id) });
  } catch (e) { bad(res, e, '登録できませんでした'); }
});
router.post('/scenarios/run-queue', async (_req: AuthRequest, res) => res.json(await processDueEnrollments()));

// ---- エンゲージメントゲート ----
const GateSchema = z.object({ channel: Channel, keyword: short(40).min(1), postExternalId: short(120).optional().nullable(), replyTemplate: short(2000).min(1), linkPath: short(300).optional().nullable(), scenarioId: z.string().optional().nullable(), tagName: short(30).optional().nullable(), active: z.boolean().default(true) });
router.get('/gates', async (req: AuthRequest, res) => res.json({ gates: await prisma.engagementGate.findMany({ where: { ownerId: req.user!.id }, orderBy: { createdAt: 'desc' }, include: { scenario: { select: { name: true } } } }) }));
router.post('/gates', async (req: AuthRequest, res) => {
  try {
    const body = GateSchema.parse(req.body ?? {});
    if (body.scenarioId && !(await prisma.crmScenario.findFirst({ where: { id: body.scenarioId, ownerId: req.user!.id } }))) return res.status(404).json({ error: 'シナリオが見つかりません' });
    res.status(201).json({ gate: await prisma.engagementGate.create({ data: { ownerId: req.user!.id, ...body, postExternalId: body.postExternalId ?? null, linkPath: body.linkPath ?? null, scenarioId: body.scenarioId ?? null, tagName: body.tagName ?? null } }) });
  } catch (e) { bad(res, e, 'ゲートを作れませんでした'); }
});
router.put('/gates/:id', async (req: AuthRequest, res) => {
  try {
    const body = GateSchema.partial().parse(req.body ?? {});
    const r = await prisma.engagementGate.updateMany({ where: { id: String(req.params.id), ownerId: req.user!.id }, data: body as any });
    if (!r.count) return res.status(404).json({ error: '見つかりません' });
    res.json({ ok: true });
  } catch (e) { bad(res, e, '更新できませんでした'); }
});
router.delete('/gates/:id', async (req: AuthRequest, res) => { await prisma.engagementGate.deleteMany({ where: { id: String(req.params.id), ownerId: req.user!.id } }); res.json({ ok: true }); });
// ゲートの試し打ち（自分のテキストで反応を確認。返信は送らない）
router.post('/gates/test', async (req: AuthRequest, res) => {
  try {
    const { channel, text } = z.object({ channel: Channel, text: short(500).min(1) }).parse(req.body ?? {});
    const hit = await matchGate(req.user!.id, channel as HarnessChannel, `test:${req.user!.id}`, text, 'テスト');
    res.json({ matched: !!hit, reply: hit?.reply ?? null, cid: hit?.cid ?? null });
  } catch (e) { bad(res, e, '試せませんでした'); }
});

// ---- 自動化ルール ----
const RuleSchema = z.object({ name: short(60).min(1), event: z.enum(['gate_hit', 'line_follow', 'lp_visit', 'booking', 'payment', 'tag_added']), conditions: z.object({ minLeadScore: z.number().int().min(0).max(100).optional(), tag: short(30).optional(), channel: short(20).optional() }).optional().nullable(), actions: z.array(z.object({ type: z.enum(['enroll', 'tag', 'notify', 'score']), scenarioId: z.string().optional(), name: short(30).optional(), text: short(200).optional(), delta: z.number().int().min(-100).max(100).optional() })).min(1).max(10), active: z.boolean().default(true) });
router.get('/rules', async (req: AuthRequest, res) => res.json({ rules: await prisma.crmAutomationRule.findMany({ where: { ownerId: req.user!.id }, orderBy: { createdAt: 'desc' } }) }));
router.post('/rules', async (req: AuthRequest, res) => {
  try { const body = RuleSchema.parse(req.body ?? {}); res.status(201).json({ rule: await prisma.crmAutomationRule.create({ data: { ownerId: req.user!.id, name: body.name, event: body.event, conditions: (body.conditions ?? null) as any, actions: body.actions as any, active: body.active } }) }); } catch (e) { bad(res, e, 'ルールを作れませんでした'); }
});
router.put('/rules/:id', async (req: AuthRequest, res) => {
  try { const body = RuleSchema.partial().parse(req.body ?? {}); const r = await prisma.crmAutomationRule.updateMany({ where: { id: String(req.params.id), ownerId: req.user!.id }, data: body as any }); if (!r.count) return res.status(404).json({ error: '見つかりません' }); res.json({ ok: true }); } catch (e) { bad(res, e, '更新できませんでした'); }
});
router.delete('/rules/:id', async (req: AuthRequest, res) => { await prisma.crmAutomationRule.deleteMany({ where: { id: String(req.params.id), ownerId: req.user!.id } }); res.json({ ok: true }); });

// ---- 配信アカウントのプール ----
router.get('/pools', async (req: AuthRequest, res) => res.json(await accountHealth(req.user!.id)));
router.post('/pools', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ channel: Channel, label: short(60).min(1), socialAccountId: z.string().optional().nullable(), dailyLimit: z.number().int().min(1).max(5000).default(200), minIntervalMs: z.number().int().min(500).max(600000).default(2500) }).parse(req.body ?? {});
    res.status(201).json({ pool: await prisma.channelAccountPool.create({ data: { ownerId: req.user!.id, ...body, socialAccountId: body.socialAccountId ?? null } }) });
  } catch (e) { bad(res, e, '追加できませんでした'); }
});
router.put('/pools/:id', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ label: short(60).optional(), dailyLimit: z.number().int().min(1).max(5000).optional(), minIntervalMs: z.number().int().min(500).max(600000).optional(), active: z.boolean().optional(), reset: z.boolean().optional() }).parse(req.body ?? {});
    const { reset, ...rest } = body;
    const r = await prisma.channelAccountPool.updateMany({ where: { id: String(req.params.id), ownerId: req.user!.id }, data: { ...rest, ...(reset ? { healthScore: 100, errorCount: 0, cooldownUntil: null, lastError: null } : {}) } });
    if (!r.count) return res.status(404).json({ error: '見つかりません' });
    res.json({ ok: true });
  } catch (e) { bad(res, e, '更新できませんでした'); }
});

// ---- クロスUUID リンク ----
router.post('/link', async (req: AuthRequest, res) => {
  try {
    const { contactId, path } = z.object({ contactId: z.string().min(1), path: short(300).min(1) }).parse(req.body ?? {});
    const c = await prisma.crmContact.findFirst({ where: { id: contactId, ownerId: req.user!.id }, select: { cid: true } });
    if (!c) return res.status(404).json({ error: '見つかりません' });
    res.json({ url: crossLink(path, c.cid) });
  } catch (e) { bad(res, e, 'リンクを作れませんでした'); }
});
router.get('/webhook-key', async (req: AuthRequest, res) => res.json({ ownerId: req.user!.id, key: webhookKey(req.user!.id), url: `${(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/api/harness/crm/webhook/${req.user!.id}/{channel}` }));

export default router;
