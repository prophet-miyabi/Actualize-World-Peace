// 一斉・セグメント配信: 対象の件数を先に出し、送信は確認付き。予約配信は毎分の処理が拾う。
// 二重送信の防止: status を sending に変えられた 1 回だけ実行する（updateMany の件数で判定）。
import prisma from '../prisma';
import { resolveAudience, type Audience } from './conditions';
import { multicastSpec } from '../line/send';
import type { MessageSpec } from '../line/messages';

export const DAILY_BROADCAST_LIMIT = 5000; // 1 事業者・1 日の上限（LINE 公式アカウントの配信枠を使い切らないため）

export async function previewBroadcast(ownerId: string, audience: Audience) {
  const rows = await resolveAudience(ownerId, audience);
  return { count: rows.length, sample: rows.slice(0, 5).map((r) => r.displayName ?? '名前なし') };
}

export async function runBroadcast(id: string) {
  const claimed = await prisma.crmBroadcast.updateMany({ where: { id, status: { in: ['draft', 'scheduled'] } }, data: { status: 'sending', startedAt: new Date() } });
  if (claimed.count === 0) return { ok: false as const, error: 'この配信は既に処理されています' };
  const b = await prisma.crmBroadcast.findUnique({ where: { id } });
  if (!b) return { ok: false as const, error: '見つかりません' };
  const since = new Date(Date.now() - 86_400_000);
  const sentToday = await prisma.crmDelivery.count({ where: { ownerId: b.ownerId, kind: 'broadcast', ok: true, createdAt: { gte: since } } });
  const targets = await resolveAudience(b.ownerId, b.audience as Audience);
  if (sentToday + targets.length > DAILY_BROADCAST_LIMIT) {
    await prisma.crmBroadcast.update({ where: { id }, data: { status: 'failed', error: `1 日の配信上限（${DAILY_BROADCAST_LIMIT} 通）を超えます`, targetCount: targets.length, finishedAt: new Date() } });
    return { ok: false as const, error: '1 日の配信上限を超えます' };
  }
  await prisma.crmBroadcast.update({ where: { id }, data: { targetCount: targets.length } });
  const r = await multicastSpec(b.ownerId, targets, b.message as MessageSpec, {
    kind: 'broadcast', refId: id, accountId: b.lineAccountId,
    onProgress: async (sent, failed) => { await prisma.crmBroadcast.update({ where: { id }, data: { sentCount: sent, failedCount: failed } }); }
  });
  await prisma.crmBroadcast.update({ where: { id }, data: { status: r.error && r.sent === 0 ? 'failed' : 'done', sentCount: r.sent, failedCount: r.failed, error: r.error ?? null, finishedAt: new Date() } });
  return { ok: true as const, ...r };
}

// 予約配信の時刻が来たものを実行（毎分）
export async function processDueBroadcasts() {
  const due = await prisma.crmBroadcast.findMany({ where: { status: 'scheduled', scheduledAt: { lte: new Date() } }, select: { id: true }, take: 5 });
  for (const d of due) await runBroadcast(d.id).catch((e) => console.error('broadcast failed', d.id, e?.message));
  return due.length;
}
