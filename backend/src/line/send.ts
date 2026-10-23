// LINE 送信の土台: 公式アカウントの選択（複数・健全性・クールダウン）、push / multicast、配信ログ、ブロック検知。
// すべて LINE 公式 Messaging API（api.line.me）だけを使う。
import { messagingApi } from '@line/bot-sdk';
import prisma from '../prisma';
import { recordCommercialIntelligence } from '../automation/awpDataAssetEngine';
import { renderSpec, type MessageSpec, type RenderVars } from './messages';

export const FRONT = () => (process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || 'https://awp-frontend-bf17.onrender.com').replace(/\/$/, '');
export const jstDay = (d = new Date()) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const jitterMs = (minMs = 2500, spread = 0.8) => Math.round(minMs + Math.random() * minMs * spread);

export type LineAccount = { id: string; ownerId: string; label: string; channelId: string; channelSecret: string; channelAccessToken: string; healthScore: number; isDefault: boolean; active: boolean; cooldownUntil: Date | null; sentToday: number; sentDay: string | null };

// 旧 LineConfig（1 本）を CrmLineAccount に取り込む（初回だけ）。以後は CrmLineAccount が正
export async function ensureLineAccounts(ownerId: string): Promise<LineAccount[]> {
  let rows = await prisma.crmLineAccount.findMany({ where: { ownerId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  if (rows.length === 0) {
    const legacy = await prisma.lineConfig.findUnique({ where: { userId: ownerId } });
    if (legacy?.channelId && legacy.channelSecret && legacy.channelAccessToken) {
      await prisma.crmLineAccount.create({ data: { ownerId, label: 'LINE 公式アカウント', channelId: legacy.channelId, channelSecret: legacy.channelSecret, channelAccessToken: legacy.channelAccessToken, webhookActivated: legacy.webhookActivated, isDefault: true, friendsAdded: legacy.friendsAdded } }).catch(() => {});
      rows = await prisma.crmLineAccount.findMany({ where: { ownerId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
    }
  }
  return rows;
}

// 送信に使うアカウント: 指定があればそれ、なければ既定 → 健全なもの の順（BAN・上限・クールダウンを避けて切り替える）
export async function pickLineAccount(ownerId: string, preferredId?: string | null): Promise<LineAccount | null> {
  const rows = await ensureLineAccounts(ownerId);
  const usable = (a: LineAccount) => a.active && a.healthScore >= 30 && !(a.cooldownUntil && a.cooldownUntil > new Date());
  if (preferredId) {
    const p = rows.find((r) => r.id === preferredId);
    if (p && usable(p)) return p;
  }
  return rows.find((r) => r.isDefault && usable(r)) ?? rows.find(usable) ?? null;
}

export const lineClient = (a: { channelAccessToken: string }) => new messagingApi.MessagingApiClient({ channelAccessToken: a.channelAccessToken });

async function markResult(accountId: string, ok: boolean, error?: string) {
  const a = await prisma.crmLineAccount.findUnique({ where: { id: accountId } });
  if (!a) return;
  const today = jstDay();
  const sentToday = (a.sentDay === today ? a.sentToday : 0) + (ok ? 1 : 0);
  const health = ok ? Math.min(100, a.healthScore + 1) : Math.max(0, a.healthScore - 15);
  // 連続エラーで健全性が下がったら 30 分休ませる（別のアカウントがあればそちらへ切り替わる）
  const cooldownUntil = !ok && health < 50 ? new Date(Date.now() + 30 * 60_000) : a.cooldownUntil;
  await prisma.crmLineAccount.update({ where: { id: accountId }, data: { sentToday, sentDay: today, healthScore: health, errorCount: ok ? a.errorCount : a.errorCount + 1, cooldownUntil, ...(ok ? {} : { lastError: (error ?? '').slice(0, 300), lastErrorAt: new Date() }) } });
}

export type SendResult = { ok: true; accountId: string } | { ok: false; error: string; fatal?: boolean; blocked?: boolean };

const classify = (e: any): { error: string; fatal: boolean; blocked: boolean; accountFault: boolean } => {
  const status = Number(e?.status ?? e?.statusCode ?? e?.originalError?.response?.status ?? 0);
  const msg = String(e?.message || e);
  const body = JSON.stringify(e?.body ?? e?.originalError?.response?.data ?? '');
  const blocked = status === 400 && /Failed to send messages|not found|consent/i.test(msg + body);
  const accountFault = status === 401 || status === 403 || status === 429 || status >= 500;
  return { error: `${status || ''} ${msg}`.trim().slice(0, 300), fatal: blocked || status === 401 || status === 403, blocked, accountFault };
};

export type SendOpts = { kind: 'step' | 'broadcast' | 'reminder' | 'gate' | 'survey' | 'manual' | 'awp'; refId?: string | null; accountId?: string | null; vars?: Partial<RenderVars>; industryKey?: string | null; stage?: 'step_message' | 'gate_dm' };

// 1 人に送る（push）。配信ログ・会話ログ・ブロック検知・健全性まで一括で行う
export async function pushSpec(ownerId: string, contact: { id: string; cid: string; lineUserId: string | null; displayName: string | null; blocked?: boolean }, spec: MessageSpec, opts: SendOpts): Promise<SendResult> {
  if (!contact.lineUserId) return { ok: false, error: 'この顧客の LINE ID がありません', fatal: true };
  if (contact.blocked) return { ok: false, error: 'ブロックされているため送れません', fatal: true, blocked: true };
  const account = await pickLineAccount(ownerId, opts.accountId);
  if (!account) return { ok: false, error: 'LINE 公式アカウントが未接続か、休止中です', fatal: true };
  const rendered = renderSpec(spec, { cid: contact.cid, front: FRONT(), name: contact.displayName ?? '', ...(opts.vars ?? {}) });
  let result: SendResult;
  try {
    await lineClient(account).pushMessage({ to: contact.lineUserId, messages: rendered.messages });
    result = { ok: true, accountId: account.id };
  } catch (e: any) {
    const c = classify(e);
    result = { ok: false, error: c.error, fatal: c.fatal, blocked: c.blocked };
    if (c.blocked) await prisma.crmContact.update({ where: { id: contact.id }, data: { blocked: true } }).catch(() => {});
    if (c.accountFault) await markResult(account.id, false, c.error);
  }
  if (result.ok) await markResult(account.id, true);
  await prisma.crmDelivery.create({ data: { ownerId, contactId: contact.id, lineAccountId: account.id, kind: opts.kind, refId: opts.refId ?? null, ok: result.ok, error: result.ok ? null : result.error, templateHash: rendered.templateHash } }).catch(() => {});
  await prisma.crmMessage.create({ data: { ownerId, contactId: contact.id, lineAccountId: account.id, direction: 'out', kind: spec.kind, text: rendered.text.slice(0, 2000), payload: spec as any, source: opts.kind, status: result.ok ? 'sent' : 'failed', error: result.ok ? null : result.error } }).catch(() => {});
  if (opts.stage) void recordCommercialIntelligence({ industryKey: opts.industryKey ?? undefined, channel: 'line', funnelStage: opts.stage, converted: result.ok, templateHash: rendered.templateHash, spintaxVariant: rendered.chosenVariants[0] ?? null });
  return result;
}

// Webhook の返信トークンで返す（無料・即時）。失敗したら push に切り替える
export async function replySpec(ownerId: string, account: { id: string; channelAccessToken: string }, replyToken: string, contact: { id: string; cid: string; lineUserId: string | null; displayName: string | null }, spec: MessageSpec, opts: SendOpts) {
  const rendered = renderSpec(spec, { cid: contact.cid, front: FRONT(), name: contact.displayName ?? '', ...(opts.vars ?? {}) });
  try {
    await lineClient(account).replyMessage({ replyToken, messages: rendered.messages });
    await prisma.crmMessage.create({ data: { ownerId, contactId: contact.id, lineAccountId: account.id, direction: 'out', kind: spec.kind, text: rendered.text.slice(0, 2000), payload: spec as any, source: opts.kind, status: 'sent' } }).catch(() => {});
    await prisma.crmDelivery.create({ data: { ownerId, contactId: contact.id, lineAccountId: account.id, kind: opts.kind, refId: opts.refId ?? null, ok: true, templateHash: rendered.templateHash } }).catch(() => {});
    return { ok: true as const, accountId: account.id };
  } catch {
    return pushSpec(ownerId, contact, spec, { ...opts, accountId: account.id });
  }
}

// 複数人に送る（multicast、150 人ずつ・間にジッター）。1 通ずつの文面差し替えが要るときは pushSpec を使う
export async function multicastSpec(ownerId: string, contacts: { id: string; cid: string; lineUserId: string | null; displayName: string | null; blocked: boolean }[], spec: MessageSpec, opts: SendOpts & { onProgress?: (sent: number, failed: number) => Promise<void> }) {
  const account = await pickLineAccount(ownerId, opts.accountId);
  if (!account) return { sent: 0, failed: contacts.length, error: 'LINE 公式アカウントが未接続か、休止中です' };
  const targets = contacts.filter((c) => c.lineUserId && !c.blocked);
  let sent = 0, failed = contacts.length - targets.length;
  // 本文に {{name}} があれば 1 人ずつ（個別化）、なければ multicast でまとめて
  const personalized = /\{\{\s*name\s*\}\}/.test(spec.text ?? '') || (spec.cards ?? []).some((c) => /\{\{\s*name\s*\}\}/.test(c.text));
  if (personalized) {
    for (const c of targets) {
      const r = await pushSpec(ownerId, c, spec, { ...opts, accountId: account.id });
      if (r.ok) sent++; else failed++;
      await sleep(jitterMs(1200, 0.6));
      if (opts.onProgress) await opts.onProgress(sent, failed);
    }
    return { sent, failed, accountId: account.id };
  }
  const rendered = renderSpec(spec, { cid: 'broadcast', front: FRONT() });
  for (let i = 0; i < targets.length; i += 150) {
    const chunk = targets.slice(i, i + 150);
    try {
      await lineClient(account).multicast({ to: chunk.map((c) => c.lineUserId!), messages: rendered.messages });
      sent += chunk.length;
      await markResult(account.id, true);
      await prisma.crmDelivery.createMany({ data: chunk.map((c) => ({ ownerId, contactId: c.id, lineAccountId: account.id, kind: opts.kind, refId: opts.refId ?? null, ok: true, templateHash: rendered.templateHash })) }).catch(() => {});
      await prisma.crmMessage.createMany({ data: chunk.map((c) => ({ ownerId, contactId: c.id, lineAccountId: account.id, direction: 'out', kind: spec.kind, text: rendered.text.slice(0, 2000), payload: spec as any, source: opts.kind, status: 'sent' })) }).catch(() => {});
    } catch (e: any) {
      const c = classify(e);
      failed += chunk.length;
      await markResult(account.id, false, c.error);
      await prisma.crmDelivery.createMany({ data: chunk.map((x) => ({ ownerId, contactId: x.id, lineAccountId: account.id, kind: opts.kind, refId: opts.refId ?? null, ok: false, error: c.error, templateHash: rendered.templateHash })) }).catch(() => {});
      if (c.fatal) break;
    }
    if (opts.onProgress) await opts.onProgress(sent, failed);
    if (i + 150 < targets.length) await sleep(jitterMs(2000, 0.5));
  }
  return { sent, failed, accountId: account.id };
}

// 接続テスト（Webhook URL の登録と疎通確認）。PUBLIC_BASE_URL/api/webhook/<accountId>
export async function registerWebhook(accountId: string, channelAccessToken: string): Promise<{ ok: boolean; reason?: string }> {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!base) return { ok: false, reason: 'PUBLIC_BASE_URL が未設定のため、Webhook の自動設定ができません' };
  const endpoint = `${base}/api/webhook/${accountId}`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${channelAccessToken}` };
  const set = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', { method: 'PUT', headers, body: JSON.stringify({ endpoint }) });
  if (!set.ok) return { ok: false, reason: `Webhook URL の登録に失敗しました（アクセストークンを確認してください）: ${(await set.text()).slice(0, 200)}` };
  const test = await fetch('https://api.line.me/v2/bot/channel/webhook/test', { method: 'POST', headers, body: JSON.stringify({ endpoint }) });
  const body: any = await test.json().catch(() => ({}));
  if (!test.ok || body.success === false) return { ok: false, reason: `Webhook の疎通確認に失敗しました（${body.reason || body.detail || test.status}）` };
  return { ok: true };
}

// ボットの基本情報（@ID・表示名）。トークンの検証にも使う
export async function botInfo(channelAccessToken: string): Promise<{ ok: true; basicId: string; displayName: string } | { ok: false; reason: string }> {
  try {
    const info = await lineClient({ channelAccessToken }).getBotInfo();
    return { ok: true, basicId: info.basicId, displayName: info.displayName };
  } catch (e: any) {
    return { ok: false, reason: `アクセストークンが正しくありません（${String(e?.message || e).slice(0, 120)}）` };
  }
}
