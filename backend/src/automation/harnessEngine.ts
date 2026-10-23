// AWP Harness Engine — The Harness の設計概念（API ファースト・エンゲージメントゲート・クロスUUID・ステルス配信・
// アカウント健全性によるフェイルオーバー）を、外部パッケージに依存しない AWP ネイティブの実装として提供する。
//
// 構成:
//   - クロスUUID（CrmContact.cid）: LINE / X / Instagram / TikTok / LP の同一人物を 1 つの ID で束ね、リンクに ?awp_cid= を付けて持ち回る
//   - エンゲージメントゲート: 投稿のコメント・DM・LINE のメッセージに含まれるキーワードで反応し、返信してシナリオに登録する
//   - ステップ配信: 毎分、期限の来た登録（CrmScenarioEnrollment）を処理し、Spintax 展開した文面をジッター付きで送る
//   - 配信アカウントのプール: エラーで健全性を下げ、しきい値を割ったらクールダウンして別アカウントへ切り替える
//   - すべての反応・配信は匿名のデータレイク（recordCommercialIntelligence）にも記録する
// 外部通信は safeExternalFetch（公式 API のホストのみ）。LINE は公式 SDK（api.line.me）を使う。
import crypto from 'crypto';
import prisma from '../prisma';
import { recordCommercialIntelligence, renderTrackedMessage, type Channel } from './awpDataAssetEngine';
import { textSpec, type MessageSpec } from '../line/messages';
import { pushSpec } from '../line/send';
import { evaluateCondition, type Condition } from '../crm/conditions';
import { processDueBroadcasts } from '../crm/broadcast';
import { processDueReminders } from '../crm/reminders';

export { renderTrackedMessage as renderTrackedStealthMessage };

export type HarnessChannel = 'line' | 'x' | 'instagram' | 'tiktok';
const FRONT = () => (process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || 'https://awp-frontend-bf17.onrender.com').replace(/\/$/, '');
const jstDay = (d = new Date()) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

// ---- ジッター（送信間隔のゆらぎ） -------------------------------------------------------------------
export function jitterMs(minMs = 2500, spread = 0.8) {
  return Math.round(minMs + Math.random() * minMs * spread);
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- クロスUUID リンク ----------------------------------------------------------------------------------
export function crossLink(path: string, cid: string, extra: Record<string, string> = {}) {
  const u = new URL(path.startsWith('http') ? path : `${FRONT()}${path.startsWith('/') ? path : `/${path}`}`);
  u.searchParams.set('awp_cid', cid);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

// 外部連携（Webhook）用の所有者ごとのキー（推測不能。DB を増やさず導出する）
export function webhookKey(ownerId: string) {
  const secret = process.env.JWT_SECRET || 'awp';
  return crypto.createHmac('sha256', secret).update(`harness:${ownerId}`).digest('hex').slice(0, 32);
}

// ---- 顧客（CrmContact） ---------------------------------------------------------------------------------
const ID_FIELD: Record<HarnessChannel, 'lineUserId' | 'xUserId' | 'igUserId' | 'tiktokUserId'> = { line: 'lineUserId', x: 'xUserId', instagram: 'igUserId', tiktok: 'tiktokUserId' };

export async function upsertContact(ownerId: string, channel: HarnessChannel | 'lp', externalId: string | null, displayName?: string | null, cid?: string | null) {
  // cid が分かっていればそれを優先（別チャネルの ID を同じ人に結合する）
  let contact = cid ? await prisma.crmContact.findFirst({ where: { ownerId, cid } }) : null;
  if (!contact && channel !== 'lp' && externalId) contact = await prisma.crmContact.findFirst({ where: { ownerId, [ID_FIELD[channel]]: externalId } });
  if (!contact) {
    contact = await prisma.crmContact.create({ data: { ownerId, source: channel, displayName: displayName ?? null, ...(channel !== 'lp' && externalId ? { [ID_FIELD[channel]]: externalId } : {}) } });
    await prisma.crmContactEvent.create({ data: { contactId: contact.id, type: 'created', channel, payload: { source: channel } as any } });
  } else if (channel !== 'lp' && externalId && !(contact as any)[ID_FIELD[channel]]) {
    contact = await prisma.crmContact.update({ where: { id: contact.id }, data: { [ID_FIELD[channel]]: externalId, ...(displayName && !contact.displayName ? { displayName } : {}) } });
    await prisma.crmContactEvent.create({ data: { contactId: contact.id, type: 'linked', channel, payload: { via: 'cid' } as any } });
  }
  return contact;
}

export async function touchContact(contactId: string, type: string, channel: HarnessChannel | 'lp' | null, payload?: Record<string, unknown>, scoreDelta = 0, stage?: string) {
  await prisma.crmContactEvent.create({ data: { contactId, type, channel, payload: (payload ?? null) as any } });
  const c = await prisma.crmContact.findUnique({ where: { id: contactId }, select: { leadScore: true, stage: true } });
  if (!c) return;
  const order = ['lead', 'engaged', 'booked', 'customer'];
  const nextStage = stage && order.indexOf(stage) > order.indexOf(c.stage) ? stage : c.stage;
  await prisma.crmContact.update({ where: { id: contactId }, data: { lastSeenAt: new Date(), leadScore: Math.max(0, Math.min(100, c.leadScore + scoreDelta)), stage: nextStage } });
}

export async function addTag(ownerId: string, contactId: string, name: string) {
  const tag = await prisma.crmTag.upsert({ where: { ownerId_name: { ownerId, name } }, update: {}, create: { ownerId, name } });
  await prisma.crmContactTag.upsert({ where: { contactId_tagId: { contactId, tagId: tag.id } }, update: {}, create: { contactId, tagId: tag.id } });
  await prisma.crmContactEvent.create({ data: { contactId, type: 'tag_added', payload: { name } as any } });
  await runAutomationRules(ownerId, 'tag_added', { contactId, tag: name });
}

// ---- 自動化ルール -------------------------------------------------------------------------------------
type RuleCtx = { contactId: string; channel?: HarnessChannel | 'lp'; tag?: string; amountYen?: number };
export async function runAutomationRules(ownerId: string, event: string, ctx: RuleCtx) {
  const rules = await prisma.crmAutomationRule.findMany({ where: { ownerId, event, active: true } });
  if (!rules.length) return;
  const contact = await prisma.crmContact.findUnique({ where: { id: ctx.contactId }, include: { tags: { include: { tag: true } } } });
  if (!contact) return;
  for (const r of rules) {
    const cond = (r.conditions ?? {}) as { minLeadScore?: number; tag?: string; channel?: string };
    if (cond.minLeadScore && contact.leadScore < cond.minLeadScore) continue;
    if (cond.tag && !contact.tags.some((t) => t.tag.name === cond.tag)) continue;
    if (cond.channel && ctx.channel && cond.channel !== ctx.channel) continue;
    for (const a of (r.actions as { type: string; scenarioId?: string; name?: string; text?: string; delta?: number }[]) ?? []) {
      try {
        if (a.type === 'enroll' && a.scenarioId) await enroll(a.scenarioId, contact.id);
        else if (a.type === 'tag' && a.name && a.name !== ctx.tag) await addTag(ownerId, contact.id, a.name);
        else if (a.type === 'score' && typeof a.delta === 'number') await touchContact(contact.id, 'score', null, { rule: r.name }, a.delta);
        else if (a.type === 'notify') await prisma.notification.create({ data: { userId: ownerId, type: 'harness', title: r.name, body: (a.text ?? `${contact.displayName ?? '顧客'}: ${event}`).slice(0, 200), href: '/harness/crm' } }).catch(() => {});
      } catch (e: any) { console.error('automation action failed', r.id, a.type, e?.message); }
    }
    await prisma.crmAutomationRule.update({ where: { id: r.id }, data: { fired: { increment: 1 } } });
  }
}

// ---- エンゲージメントゲート ----------------------------------------------------------------------------------
export type GateHit = { gate: { id: string; keyword: string; scenarioId: string | null; tagName: string | null; surveyId: string | null }; contactId: string; cid: string; reply: string; spec: MessageSpec; link: string; templateHash: string; chosenVariants: string[] };

// 受信した文面に合うゲートを探し、顧客を作り、返信文を組み立てる（送信は呼び出し側）
export async function matchGate(ownerId: string, channel: HarnessChannel, externalUserId: string, text: string, displayName?: string | null, postExternalId?: string | null): Promise<GateHit | null> {
  const gates = await prisma.engagementGate.findMany({ where: { ownerId, channel, active: true }, orderBy: { createdAt: 'asc' } });
  const t = text.trim();
  const gate = gates.find((g) => (!g.postExternalId || g.postExternalId === postExternalId) && t.includes(g.keyword));
  if (!gate) return null;
  const contact = await upsertContact(ownerId, channel, externalUserId, displayName);
  const link = gate.linkPath ? crossLink(gate.linkPath, contact.cid, { utm_source: channel, utm_medium: 'gate' }) : '';
  const rendered = renderTrackedMessage(gate.replyTemplate, { name: contact.displayName ?? '', link });
  const reply = link && !gate.replyTemplate.includes('{{link}}') ? `${rendered.text}\n${link}` : rendered.text;
  await prisma.engagementGate.update({ where: { id: gate.id }, data: { hits: { increment: 1 } } });
  await touchContact(contact.id, 'gate_hit', channel, { gateId: gate.id, keyword: gate.keyword }, 15, 'engaged');
  if (gate.tagName) await addTag(ownerId, contact.id, gate.tagName);
  if (gate.scenarioId) await enroll(gate.scenarioId, contact.id).catch(() => {});
  await runAutomationRules(ownerId, 'gate_hit', { contactId: contact.id, channel });
  void prisma.landingPage.findFirst({ where: { userId: ownerId }, select: { industryKey: true } }).then((lp) => recordCommercialIntelligence({ industryKey: lp?.industryKey, channel: channel as Channel, funnelStage: 'gate_dm', converted: true, triggerKeyword: gate.keyword, templateHash: rendered.templateHash, spintaxVariant: rendered.chosenVariants[0] ?? null }));
  const spec: MessageSpec = (gate.replyMessage as MessageSpec | null) ?? textSpec(gate.replyTemplate);
  return { gate: { id: gate.id, keyword: gate.keyword, scenarioId: gate.scenarioId, tagName: gate.tagName, surveyId: gate.surveyId }, contactId: contact.id, cid: contact.cid, reply, spec, link, templateHash: rendered.templateHash, chosenVariants: rendered.chosenVariants };
}

// LINE の友だち追加: 顧客を作り、trigger=line_follow のシナリオに登録
export async function onLineFollow(ownerId: string, lineUserId: string, lineAccountId?: string | null, displayName?: string | null) {
  const contact = await upsertContact(ownerId, 'line', lineUserId, displayName);
  await prisma.crmContact.update({ where: { id: contact.id }, data: { blocked: false, ...(lineAccountId ? { lineAccountId } : {}) } }).catch(() => {});
  await touchContact(contact.id, 'follow', 'line', undefined, 10, 'engaged');
  const scenarios = await prisma.crmScenario.findMany({ where: { ownerId, trigger: 'line_follow', active: true }, select: { id: true } });
  for (const s of scenarios) await enroll(s.id, contact.id).catch(() => {});
  await runAutomationRules(ownerId, 'line_follow', { contactId: contact.id, channel: 'line' });
  return contact;
}

export async function onLineUnfollow(ownerId: string, lineUserId: string) {
  const contact = await prisma.crmContact.findFirst({ where: { ownerId, lineUserId } });
  if (!contact) return null;
  await prisma.crmContact.update({ where: { id: contact.id }, data: { blocked: true } });
  await prisma.crmScenarioEnrollment.updateMany({ where: { contactId: contact.id, status: 'active' }, data: { status: 'stopped', lastError: 'ブロックされました' } });
  await prisma.crmContactEvent.create({ data: { contactId: contact.id, type: 'unfollow', channel: 'line' } });
  return contact;
}

// アンケート（crm/surveys.ts）から呼ぶ道具
export const surveyHooks = {
  addTag,
  enroll: (scenarioId: string, contactId: string) => enroll(scenarioId, contactId),
  touch: (contactId: string, type: string, payload?: Record<string, unknown>, score = 0) => touchContact(contactId, type, 'line', payload, score)
};

// クロスUUID 付きの来訪・予約・決済（LP 側から cid が渡されたとき）
export async function onCrossEvent(ownerId: string, cid: string, type: 'lp_visit' | 'booking' | 'payment', payload?: Record<string, unknown>) {
  const contact = await prisma.crmContact.findFirst({ where: { ownerId, cid } });
  if (!contact) return null;
  const score = type === 'payment' ? 40 : type === 'booking' ? 30 : 5;
  const stage = type === 'payment' ? 'customer' : type === 'booking' ? 'booked' : undefined;
  await touchContact(contact.id, type, 'lp', payload, score, stage);
  await runAutomationRules(ownerId, type, { contactId: contact.id, channel: 'lp', amountYen: typeof payload?.amountYen === 'number' ? payload.amountYen : undefined });
  return contact;
}

// ---- ステップ配信 ---------------------------------------------------------------------------------------------
export async function enroll(scenarioId: string, contactId: string) {
  const sc = await prisma.crmScenario.findUnique({ where: { id: scenarioId }, include: { steps: { orderBy: { order: 'asc' }, take: 1 } } });
  if (!sc || !sc.active) throw new Error('シナリオが無効です');
  const first = sc.steps[0];
  const nextAt = new Date(Date.now() + (first?.delayMinutes ?? 0) * 60_000);
  return prisma.crmScenarioEnrollment.upsert({ where: { scenarioId_contactId: { scenarioId, contactId } }, update: { status: 'active', currentStep: 0, nextAt, attempts: 0, lastError: null }, create: { scenarioId, contactId, nextAt } });
}

// 配信に使うアカウント: 健全性が高く、クールダウン中でなく、日次上限に達していないものを選ぶ
export async function pickPoolAccount(ownerId: string, channel: HarnessChannel) {
  const today = jstDay();
  const pools = await prisma.channelAccountPool.findMany({ where: { ownerId, channel, active: true }, orderBy: { healthScore: 'desc' } });
  for (const p of pools) {
    const sentToday = p.sentDay === today ? p.sentToday : 0;
    if (p.cooldownUntil && p.cooldownUntil > new Date()) continue;
    if (sentToday >= p.dailyLimit) continue;
    if (p.healthScore < 30) continue;
    return p;
  }
  return null;
}

export async function processDueEnrollments(limit = 20) {
  const due = await prisma.crmScenarioEnrollment.findMany({
    where: { status: 'active', nextAt: { lte: new Date() } }, orderBy: { nextAt: 'asc' }, take: limit,
    include: { scenario: { include: { steps: { orderBy: { order: 'asc' } } } }, contact: { include: { tags: { include: { tag: true } } } } }
  });
  let sent = 0, failed = 0, skipped = 0;
  for (const en of due) {
    const steps = en.scenario.steps;
    const channel = en.scenario.channel as HarnessChannel;
    const advance = async (from: number, status: 'done' | 'active' = 'active') => {
      const next = steps[from + 1];
      await prisma.crmScenarioEnrollment.update({ where: { id: en.id }, data: next && status === 'active' ? { currentStep: from + 1, nextAt: new Date(Date.now() + next.delayMinutes * 60_000), attempts: 0, lastError: null } : { status: 'done', attempts: 0, lastError: null } });
    };
    if (!en.scenario.active || !steps[en.currentStep]) { await prisma.crmScenarioEnrollment.update({ where: { id: en.id }, data: { status: 'done' } }); continue; }
    // 条件分岐: 合わなければ飛ばす（next）か終える（stop）。飛ばした先が「すぐ送る」ステップなら同じ回で続けて判定する
    let idx = en.currentStep;
    let ended = false;
    while (steps[idx].condition && !(await evaluateCondition(en.contact, steps[idx].condition as Condition))) {
      skipped++;
      if (steps[idx].onSkip === 'stop' || !steps[idx + 1]) { await prisma.crmScenarioEnrollment.update({ where: { id: en.id }, data: { status: 'done', lastError: steps[idx].onSkip === 'stop' ? '条件に合わないため終了' : null } }); ended = true; break; }
      idx++;
      if (steps[idx].delayMinutes > 0) { await prisma.crmScenarioEnrollment.update({ where: { id: en.id }, data: { currentStep: idx, nextAt: new Date(Date.now() + steps[idx].delayMinutes * 60_000), attempts: 0, lastError: null } }); ended = true; break; }
    }
    if (ended) continue;
    if (idx !== en.currentStep) await prisma.crmScenarioEnrollment.update({ where: { id: en.id }, data: { currentStep: idx } });
    const step = steps[idx];
    if (channel !== 'line') {
      failed++;
      await prisma.crmScenarioEnrollment.update({ where: { id: en.id }, data: { status: 'failed', lastError: `${channel} への配信は未対応です（LINE のみ）` } });
      continue;
    }
    const link = step.linkPath ? crossLink(step.linkPath, en.contact.cid, { utm_source: 'line', utm_medium: 'step' }) : '';
    const spec: MessageSpec = (step.message as MessageSpec | null) ?? textSpec(step.template);
    const industry = await prisma.landingPage.findFirst({ where: { userId: en.scenario.ownerId }, select: { industryKey: true } });
    const result = await pushSpec(en.scenario.ownerId, en.contact, spec, { kind: 'step', refId: en.scenarioId, accountId: en.scenario.lineAccountId, vars: { link }, industryKey: industry?.industryKey, stage: 'step_message' });
    if (result.ok) {
      sent++;
      await touchContact(en.contactId, 'step_sent', channel, { scenarioId: en.scenarioId, step: idx }, 2);
      await advance(idx);
    } else {
      failed++;
      const attempts = en.attempts + 1;
      const giveUp = result.fatal || attempts >= 3;
      await prisma.crmScenarioEnrollment.update({ where: { id: en.id }, data: giveUp ? { status: 'failed', attempts, lastError: result.error } : { attempts, lastError: result.error, nextAt: new Date(Date.now() + [10, 30, 90][Math.min(attempts - 1, 2)] * 60_000) } });
    }
  }
  return { due: due.length, sent, failed, skipped };
}

// ---- 健全性の要約（画面・MCP 用） -------------------------------------------------------------------------
export async function accountHealth(ownerId: string) {
  const [pools, line, enrollments, gates] = await Promise.all([
    prisma.channelAccountPool.findMany({ where: { ownerId }, orderBy: [{ channel: 'asc' }, { healthScore: 'desc' }] }),
    prisma.crmLineAccount.findMany({ where: { ownerId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true, label: true, channelId: true, botBasicId: true, webhookActivated: true, isDefault: true, active: true, healthScore: true, errorCount: true, sentToday: true, sentDay: true, cooldownUntil: true, lastError: true, friendsAdded: true } }),
    prisma.crmScenarioEnrollment.groupBy({ by: ['status'], _count: { _all: true }, where: { scenario: { ownerId } } }),
    prisma.engagementGate.findMany({ where: { ownerId }, select: { id: true, channel: true, keyword: true, hits: true, active: true } })
  ]);
  return {
    line: { configured: line.length > 0, webhookActivated: line.some((a) => a.webhookActivated), friends: line.reduce((a, b) => a + b.friendsAdded, 0), accounts: line.map((a) => ({ ...a, sentToday: a.sentDay === jstDay() ? a.sentToday : 0 })) },
    pools: pools.map((p) => ({ id: p.id, channel: p.channel, label: p.label, healthScore: p.healthScore, errorCount: p.errorCount, sentToday: p.sentDay === jstDay() ? p.sentToday : 0, dailyLimit: p.dailyLimit, cooldownUntil: p.cooldownUntil, active: p.active, lastError: p.lastError })),
    enrollments: Object.fromEntries(enrollments.map((e) => [e.status, e._count._all])),
    gates
  };
}

// ---- 定期実行（毎分） ------------------------------------------------------------------------------------------
let timer: NodeJS.Timeout | null = null;
export function startHarnessEngine() {
  if (timer) return;
  const tick = async () => {
    await processDueEnrollments().catch((e) => console.error('harness step queue failed', e?.message));
    await processDueBroadcasts().catch((e) => console.error('harness broadcast failed', e?.message));
    await processDueReminders().catch((e) => console.error('harness reminder failed', e?.message));
  };
  timer = setInterval(() => { void tick(); }, 60_000);
}
