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
import { accountHealth, crossLink, enroll, matchGate, processDueEnrollments, surveyHooks, webhookKey, type HarnessChannel } from '../automation/harnessEngine';
import { MessageSpecSchema, type MessageSpec } from '../line/messages';
import { botInfo, ensureLineAccounts, pushSpec, registerWebhook } from '../line/send';
import { AudienceSchema, ConditionSchema } from '../crm/conditions';
import { previewBroadcast, runBroadcast } from '../crm/broadcast';
import { SurveySchema, startSurvey } from '../crm/surveys';

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
const StepSchema = z.object({ delayMinutes: z.number().int().min(0).max(60 * 24 * 60), template: short(3000).default(''), mediaUrl: short(500).optional().nullable(), linkPath: short(300).optional().nullable(), message: MessageSpecSchema.optional().nullable(), condition: ConditionSchema.optional().nullable(), onSkip: z.enum(['next', 'stop']).default('next') }).refine((s) => s.template.trim() || s.message, { message: '文面かメッセージを入れてください' });
const ScenarioSchema = z.object({ name: short(60).min(1), channel: z.enum(['line', 'x', 'instagram']).default('line'), trigger: z.enum(['manual', 'gate', 'line_follow', 'tag', 'booking']).default('manual'), triggerRef: short(60).optional().nullable(), lineAccountId: z.string().optional().nullable(), active: z.boolean().default(true), steps: z.array(StepSchema).min(1).max(20) });

router.get('/scenarios', async (req: AuthRequest, res) => {
  const scenarios = await prisma.crmScenario.findMany({ where: { ownerId: req.user!.id }, orderBy: { createdAt: 'desc' }, include: { steps: { orderBy: { order: 'asc' } }, _count: { select: { enrollments: true } } } });
  res.json({ scenarios });
});
router.post('/scenarios', async (req: AuthRequest, res) => {
  try {
    const body = ScenarioSchema.parse(req.body ?? {});
    const sc = await prisma.crmScenario.create({ data: { ownerId: req.user!.id, name: body.name, channel: body.channel, trigger: body.trigger, triggerRef: body.triggerRef ?? null, lineAccountId: body.lineAccountId ?? null, active: body.active, steps: { create: body.steps.map((s, i) => ({ order: i, delayMinutes: s.delayMinutes, template: s.template, mediaUrl: s.mediaUrl ?? null, linkPath: s.linkPath ?? null, message: (s.message ?? null) as any, condition: (s.condition ?? null) as any, onSkip: s.onSkip })) } }, include: { steps: { orderBy: { order: 'asc' } } } });
    res.status(201).json({ scenario: sc });
  } catch (e) { bad(res, e, 'シナリオを作れませんでした'); }
});
router.put('/scenarios/:id', async (req: AuthRequest, res) => {
  try {
    const body = ScenarioSchema.partial().parse(req.body ?? {});
    const sc = await prisma.crmScenario.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id } });
    if (!sc) return res.status(404).json({ error: '見つかりません' });
    await prisma.$transaction(async (db) => {
      await db.crmScenario.update({ where: { id: sc.id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.channel ? { channel: body.channel } : {}), ...(body.trigger ? { trigger: body.trigger } : {}), ...(body.triggerRef !== undefined ? { triggerRef: body.triggerRef } : {}), ...(body.lineAccountId !== undefined ? { lineAccountId: body.lineAccountId } : {}), ...(body.active !== undefined ? { active: body.active } : {}) } });
      if (body.steps) { await db.crmScenarioStep.deleteMany({ where: { scenarioId: sc.id } }); await db.crmScenarioStep.createMany({ data: body.steps.map((s, i) => ({ scenarioId: sc.id, order: i, delayMinutes: s.delayMinutes, template: s.template, mediaUrl: s.mediaUrl ?? null, linkPath: s.linkPath ?? null, message: (s.message ?? null) as any, condition: (s.condition ?? null) as any, onSkip: s.onSkip })) }); }
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
const GateSchema = z.object({ channel: Channel, keyword: short(40).min(1), postExternalId: short(120).optional().nullable(), replyTemplate: short(2000).min(1), linkPath: short(300).optional().nullable(), scenarioId: z.string().optional().nullable(), tagName: short(30).optional().nullable(), replyMessage: MessageSpecSchema.optional().nullable(), surveyId: z.string().optional().nullable(), active: z.boolean().default(true) });
router.get('/gates', async (req: AuthRequest, res) => res.json({ gates: await prisma.engagementGate.findMany({ where: { ownerId: req.user!.id }, orderBy: { createdAt: 'desc' }, include: { scenario: { select: { name: true } } } }) }));
router.post('/gates', async (req: AuthRequest, res) => {
  try {
    const body = GateSchema.parse(req.body ?? {});
    if (body.scenarioId && !(await prisma.crmScenario.findFirst({ where: { id: body.scenarioId, ownerId: req.user!.id } }))) return res.status(404).json({ error: 'シナリオが見つかりません' });
    res.status(201).json({ gate: await prisma.engagementGate.create({ data: { ownerId: req.user!.id, ...body, postExternalId: body.postExternalId ?? null, linkPath: body.linkPath ?? null, scenarioId: body.scenarioId ?? null, tagName: body.tagName ?? null, replyMessage: (body.replyMessage ?? null) as any, surveyId: body.surveyId ?? null } }) });
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
    res.json({ matched: !!hit, reply: hit?.reply ?? null, cid: hit?.cid ?? null, spec: hit?.spec ?? null, surveyId: hit?.gate.surveyId ?? null });
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

// ---- LINE 公式アカウント（複数・スマホだけで接続） ----
//   GET  /line-accounts                 一覧（秘密情報は返さない）
//   POST /line-accounts                 { label, channelId, channelSecret, channelAccessToken } → トークン検証 → Webhook 登録
//   PUT  /line-accounts/:id             { label?, active?, isDefault?, channelAccessToken?, channelSecret?, reset? }
//   POST /line-accounts/:id/reconnect   Webhook の再登録と疎通確認
//   DELETE /line-accounts/:id
const accountView = (a: any) => ({ id: a.id, label: a.label, channelId: a.channelId, botBasicId: a.botBasicId, webhookActivated: a.webhookActivated, isDefault: a.isDefault, active: a.active, healthScore: a.healthScore, errorCount: a.errorCount, cooldownUntil: a.cooldownUntil, lastError: a.lastError, friendsAdded: a.friendsAdded, addUrl: a.botBasicId ? `https://line.me/R/ti/p/${a.botBasicId}` : null, webhookUrl: `${(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/api/webhook/${a.id}`, createdAt: a.createdAt });
router.get('/line-accounts', async (req: AuthRequest, res) => res.json({ accounts: (await ensureLineAccounts(req.user!.id)).map(accountView) }));
router.post('/line-accounts', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ label: short(60).default('LINE 公式アカウント'), channelId: short(40).min(1), channelSecret: short(120).min(1), channelAccessToken: short(400).min(1) }).parse(req.body ?? {});
    const info = await botInfo(body.channelAccessToken);
    if (!info.ok) return res.status(400).json({ error: info.reason });
    const count = await prisma.crmLineAccount.count({ where: { ownerId: req.user!.id } });
    const a = await prisma.crmLineAccount.create({ data: { ownerId: req.user!.id, label: body.label || info.displayName, channelId: body.channelId, channelSecret: body.channelSecret, channelAccessToken: body.channelAccessToken, botBasicId: info.basicId, isDefault: count === 0 } });
    const wh = await registerWebhook(a.id, body.channelAccessToken);
    const updated = await prisma.crmLineAccount.update({ where: { id: a.id }, data: { webhookActivated: wh.ok } });
    res.status(201).json({ account: accountView(updated), webhook: wh, bot: { displayName: info.displayName, basicId: info.basicId } });
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(400).json({ error: 'このチャネル ID は既に登録されています' });
    bad(res, e, '登録できませんでした');
  }
});
router.put('/line-accounts/:id', async (req: AuthRequest, res) => {
  try {
    const body = z.object({ label: short(60).optional(), active: z.boolean().optional(), isDefault: z.boolean().optional(), channelAccessToken: short(400).optional(), channelSecret: short(120).optional(), reset: z.boolean().optional() }).parse(req.body ?? {});
    const a = await prisma.crmLineAccount.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id } });
    if (!a) return res.status(404).json({ error: '見つかりません' });
    if (body.channelAccessToken) { const info = await botInfo(body.channelAccessToken); if (!info.ok) return res.status(400).json({ error: info.reason }); }
    if (body.isDefault) await prisma.crmLineAccount.updateMany({ where: { ownerId: req.user!.id }, data: { isDefault: false } });
    const { reset, ...rest } = body;
    const updated = await prisma.crmLineAccount.update({ where: { id: a.id }, data: { ...rest, ...(reset ? { healthScore: 100, errorCount: 0, cooldownUntil: null, lastError: null } : {}) } });
    res.json({ account: accountView(updated) });
  } catch (e) { bad(res, e, '更新できませんでした'); }
});
router.post('/line-accounts/:id/reconnect', async (req: AuthRequest, res) => {
  const a = await prisma.crmLineAccount.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id } });
  if (!a) return res.status(404).json({ error: '見つかりません' });
  const info = await botInfo(a.channelAccessToken);
  if (!info.ok) return res.status(400).json({ error: info.reason });
  const wh = await registerWebhook(a.id, a.channelAccessToken);
  const updated = await prisma.crmLineAccount.update({ where: { id: a.id }, data: { webhookActivated: wh.ok, botBasicId: info.basicId, healthScore: wh.ok ? 100 : a.healthScore, cooldownUntil: wh.ok ? null : a.cooldownUntil } });
  res.json({ account: accountView(updated), webhook: wh });
});
router.delete('/line-accounts/:id', async (req: AuthRequest, res) => { await prisma.crmLineAccount.deleteMany({ where: { id: String(req.params.id), ownerId: req.user!.id } }); res.json({ ok: true }); });

// ---- 受信箱（オペレーターチャット） ----
//   GET  /inbox?filter=unread|all        会話一覧（未読順）
//   GET  /contacts/:id/messages          会話ログ
//   POST /contacts/:id/messages          { message: MessageSpec } 手動で送る
//   POST /contacts/:id/handled           対応済みにする（未読を 0 に）
//   POST /contacts/:id/survey            { surveyId } アンケートを送る
router.get('/inbox', async (req: AuthRequest, res) => {
  const unreadOnly = req.query.filter !== 'all';
  const contacts = await prisma.crmContact.findMany({
    where: { ownerId: req.user!.id, lastInboundAt: { not: null }, ...(unreadOnly ? { unreadCount: { gt: 0 } } : {}) },
    orderBy: [{ unreadCount: 'desc' }, { lastInboundAt: 'desc' }], take: 100,
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { direction: true, kind: true, text: true, createdAt: true } }, tags: { include: { tag: true } } }
  });
  res.json({ conversations: contacts.map((c) => ({ id: c.id, displayName: c.displayName, stage: c.stage, leadScore: c.leadScore, unreadCount: c.unreadCount, lastInboundAt: c.lastInboundAt, assignee: c.assignee, blocked: c.blocked, tags: c.tags.map((t) => t.tag.name), last: c.messages[0] ?? null })) });
});
router.get('/contacts/:id/messages', async (req: AuthRequest, res) => {
  const c = await prisma.crmContact.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id }, select: { id: true } });
  if (!c) return res.status(404).json({ error: '見つかりません' });
  const messages = await prisma.crmMessage.findMany({ where: { contactId: c.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ messages: messages.reverse() });
});
router.post('/contacts/:id/messages', async (req: AuthRequest, res) => {
  try {
    const { message } = z.object({ message: MessageSpecSchema }).parse(req.body ?? {});
    const c = await prisma.crmContact.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id } });
    if (!c) return res.status(404).json({ error: '見つかりません' });
    const r = await pushSpec(req.user!.id, c, message as MessageSpec, { kind: 'manual' });
    if (!r.ok) return res.status(400).json({ error: r.error });
    await prisma.crmContact.update({ where: { id: c.id }, data: { unreadCount: 0, handledAt: new Date() } });
    res.json({ ok: true });
  } catch (e) { bad(res, e, '送れませんでした'); }
});
router.post('/contacts/:id/handled', async (req: AuthRequest, res) => {
  const r = await prisma.crmContact.updateMany({ where: { id: String(req.params.id), ownerId: req.user!.id }, data: { unreadCount: 0, handledAt: new Date(), assignee: typeof req.body?.assignee === 'string' ? req.body.assignee.slice(0, 40) : undefined } });
  if (!r.count) return res.status(404).json({ error: '見つかりません' });
  res.json({ ok: true });
});
router.post('/contacts/:id/survey', async (req: AuthRequest, res) => {
  try {
    const { surveyId } = z.object({ surveyId: z.string().min(1) }).parse(req.body ?? {});
    const c = await prisma.crmContact.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id } });
    if (!c) return res.status(404).json({ error: '見つかりません' });
    const ok = await startSurvey(req.user!.id, surveyId, c, null, surveyHooks);
    if (!ok) return res.status(400).json({ error: 'アンケートを送れませんでした（LINE 未接続か、顧客に LINE ID がありません）' });
    res.json({ ok: true });
  } catch (e) { bad(res, e, '送れませんでした'); }
});

// ---- 一斉・セグメント配信 ----
//   POST /broadcasts/preview { audience }         対象の件数
//   GET  /broadcasts   POST /broadcasts { name, audience, message, scheduledAt?, lineAccountId? }
//   POST /broadcasts/:id/send   POST /broadcasts/:id/cancel   DELETE /broadcasts/:id
const BroadcastSchema = z.object({ name: short(60).min(1), audience: AudienceSchema, message: MessageSpecSchema, scheduledAt: z.string().datetime({ offset: true }).optional().nullable(), lineAccountId: z.string().optional().nullable() });
router.post('/broadcasts/preview', async (req: AuthRequest, res) => {
  try { res.json(await previewBroadcast(req.user!.id, AudienceSchema.parse(req.body?.audience ?? {}))); } catch (e) { bad(res, e, '件数を出せませんでした'); }
});
router.get('/broadcasts', async (req: AuthRequest, res) => res.json({ broadcasts: await prisma.crmBroadcast.findMany({ where: { ownerId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 }) }));
router.post('/broadcasts', async (req: AuthRequest, res) => {
  try {
    const body = BroadcastSchema.parse(req.body ?? {});
    const preview = await previewBroadcast(req.user!.id, body.audience);
    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    const b = await prisma.crmBroadcast.create({ data: { ownerId: req.user!.id, name: body.name, audience: body.audience as any, message: body.message as any, scheduledAt, lineAccountId: body.lineAccountId ?? null, status: scheduledAt && scheduledAt > new Date() ? 'scheduled' : 'draft', targetCount: preview.count } });
    res.status(201).json({ broadcast: b });
  } catch (e) { bad(res, e, '配信を作れませんでした'); }
});
router.post('/broadcasts/:id/send', async (req: AuthRequest, res) => {
  const b = await prisma.crmBroadcast.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id } });
  if (!b) return res.status(404).json({ error: '見つかりません' });
  const r = await runBroadcast(b.id);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, sent: r.sent, failed: r.failed, broadcast: await prisma.crmBroadcast.findUnique({ where: { id: b.id } }) });
});
router.post('/broadcasts/:id/cancel', async (req: AuthRequest, res) => {
  const r = await prisma.crmBroadcast.updateMany({ where: { id: String(req.params.id), ownerId: req.user!.id, status: { in: ['draft', 'scheduled'] } }, data: { status: 'canceled' } });
  if (!r.count) return res.status(400).json({ error: '取り消せる状態ではありません' });
  res.json({ ok: true });
});
router.delete('/broadcasts/:id', async (req: AuthRequest, res) => { await prisma.crmBroadcast.deleteMany({ where: { id: String(req.params.id), ownerId: req.user!.id, status: { not: 'sending' } } }); res.json({ ok: true }); });

// ---- リマインダー ----
const ReminderSchema = z.object({ name: short(60).min(1), basis: z.enum(['booking', 'enrollment']).default('booking'), basisRef: z.string().optional().nullable(), offsetMinutes: z.number().int().min(-60 * 24 * 30).max(60 * 24 * 30), message: MessageSpecSchema, lineAccountId: z.string().optional().nullable(), active: z.boolean().default(true) });
router.get('/reminders', async (req: AuthRequest, res) => res.json({ reminders: await prisma.crmReminder.findMany({ where: { ownerId: req.user!.id }, orderBy: { createdAt: 'desc' } }) }));
router.post('/reminders', async (req: AuthRequest, res) => {
  try { const b = ReminderSchema.parse(req.body ?? {}); res.status(201).json({ reminder: await prisma.crmReminder.create({ data: { ownerId: req.user!.id, name: b.name, basis: b.basis, basisRef: b.basisRef ?? null, offsetMinutes: b.offsetMinutes, message: b.message as any, lineAccountId: b.lineAccountId ?? null, active: b.active } }) }); } catch (e) { bad(res, e, 'リマインダーを作れませんでした'); }
});
router.put('/reminders/:id', async (req: AuthRequest, res) => {
  try {
    const b = ReminderSchema.partial().parse(req.body ?? {});
    const r = await prisma.crmReminder.updateMany({ where: { id: String(req.params.id), ownerId: req.user!.id }, data: { ...b, message: b.message as any } as any });
    if (!r.count) return res.status(404).json({ error: '見つかりません' });
    res.json({ ok: true });
  } catch (e) { bad(res, e, '更新できませんでした'); }
});
router.delete('/reminders/:id', async (req: AuthRequest, res) => { await prisma.crmReminder.deleteMany({ where: { id: String(req.params.id), ownerId: req.user!.id } }); res.json({ ok: true }); });

// ---- アンケート（ボタン選択） ----
router.get('/surveys', async (req: AuthRequest, res) => res.json({ surveys: await prisma.crmSurvey.findMany({ where: { ownerId: req.user!.id }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { answers: true } } } }) }));
router.post('/surveys', async (req: AuthRequest, res) => {
  try { const b = SurveySchema.parse(req.body ?? {}); res.status(201).json({ survey: await prisma.crmSurvey.create({ data: { ownerId: req.user!.id, name: b.name, questions: b.questions as any, onComplete: (b.onComplete ?? null) as any, active: b.active } }) }); } catch (e) { bad(res, e, 'アンケートを作れませんでした'); }
});
router.put('/surveys/:id', async (req: AuthRequest, res) => {
  try {
    const b = SurveySchema.partial().parse(req.body ?? {});
    const r = await prisma.crmSurvey.updateMany({ where: { id: String(req.params.id), ownerId: req.user!.id }, data: { ...b, questions: b.questions as any, onComplete: b.onComplete as any } as any });
    if (!r.count) return res.status(404).json({ error: '見つかりません' });
    res.json({ ok: true });
  } catch (e) { bad(res, e, '更新できませんでした'); }
});
router.delete('/surveys/:id', async (req: AuthRequest, res) => { await prisma.crmSurvey.deleteMany({ where: { id: String(req.params.id), ownerId: req.user!.id } }); res.json({ ok: true }); });
router.get('/surveys/:id/answers', async (req: AuthRequest, res) => {
  const s = await prisma.crmSurvey.findFirst({ where: { id: String(req.params.id), ownerId: req.user!.id } });
  if (!s) return res.status(404).json({ error: '見つかりません' });
  const answers = await prisma.crmSurveyAnswer.findMany({ where: { surveyId: s.id }, orderBy: { updatedAt: 'desc' }, take: 500, include: { contact: { select: { id: true, displayName: true, stage: true } } } });
  // 設問ごとの集計（選択肢の件数）
  const qs = s.questions as { key: string; options: { label: string; value: string }[] }[];
  const tally = qs.map((q) => ({ key: q.key, options: q.options.map((o) => ({ label: o.label, value: o.value, count: answers.filter((a) => ((a.answers ?? {}) as Record<string, unknown>)[q.key] === o.value).length })) }));
  res.json({ survey: s, answers, tally });
});

// ---- 配信ログ ----
router.get('/deliveries', async (req: AuthRequest, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [rows, byKind] = await Promise.all([
    prisma.crmDelivery.findMany({ where: { ownerId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { contact: { select: { displayName: true } } } }),
    prisma.crmDelivery.groupBy({ by: ['kind', 'ok'], _count: { _all: true }, where: { ownerId: req.user!.id, createdAt: { gte: since } } })
  ]);
  res.json({ deliveries: rows, last30d: byKind.map((b) => ({ kind: b.kind, ok: b.ok, count: b._count._all })) });
});

export default router;
