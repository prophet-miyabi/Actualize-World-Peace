import { getFlag, SETTING_KEYS } from '../lib/systemSettings';
import prisma from '../prisma';
import { postToInstagram } from './platforms/instagram';
import { postToFacebookPage } from './platforms/facebook';
import { postToTikTok } from './platforms/tiktok';
import { postToX } from './platforms/x';
import { postToYouTubeShorts } from './platforms/youtube';
import { syncAllEnabled } from './sync';
import type { Platform, PostResult } from './types';

// Redis/BullMQを使わない、データベースだけで動く予約投稿の仕組み。
// 一定間隔でDBを見に行き、時刻が来た投稿を実行する（1台構成のうちはこれで十分機能する）。
// 配信先は外部SNS（x / instagram / facebook / youtube / tiktok）に加えて "awp"（AWP 自身のフィードとページ）を選べる。
// 失敗したプラットフォームだけを再試行し（成功分は postedIds に残す）、間隔は 2分 → 10分 → 30分 と延ばす。
// 結果は CompanyEvent（social.post.*）に記録し、運営オフィスの警報・ループから追える。

const POLL_INTERVAL_MS = 15_000;
const SYNC_INTERVAL_MS = 60 * 60_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000];

export type Target = Platform | 'awp';
export const TARGETS: Target[] = ['awp', 'x', 'instagram', 'facebook', 'youtube', 'tiktok'];

const POSTERS: Record<Platform, (account: any, input: any) => Promise<PostResult>> = {
  x: postToX,
  instagram: postToInstagram,
  facebook: postToFacebookPage,
  youtube: postToYouTubeShorts,
  tiktok: postToTikTok
};

const isAuthError = (msg: string) => /401|403|token|expired|invalid_grant|unauthor/i.test(msg);

// 予約に添付した媒体の公開URL（各SNSはこのURLから取得する）
export function scheduledMediaUrl(id: string) {
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/api/social/posts/${id}/media` : null;
}

async function logEvent(type: string, payload: Record<string, unknown>) {
  await prisma.companyEvent.create({ data: { type, actor: 'social', payload: payload as any } }).catch(() => {});
}

// AWP 自身への投稿: 予約の本文と媒体から Post を作る（既存の AWP 投稿を配信する場合は作らない）
async function postToAwp(sp: { id: string; userId: string; text: string; kind: string; media: Uint8Array | null; mediaType: string | null; postId: string | null }): Promise<PostResult> {
  if (sp.postId) return { ok: true, postId: sp.postId };
  const user = await prisma.user.findUnique({ where: { id: sp.userId }, select: { username: true } });
  if (!user?.username) return { ok: false, error: 'AWP に投稿するには、先にプロフィールでユーザー名を決めてください' };
  const isVideo = !!sp.mediaType && sp.mediaType.startsWith('video/');
  const post = await prisma.post.create({ data: {
    userId: sp.userId, body: sp.text, kind: isVideo ? 'reel' : sp.kind === 'reel' ? 'reel' : 'post',
    image: !isVideo && sp.media ? Buffer.from(sp.media) : null, imageType: !isVideo ? sp.mediaType : null,
    video: isVideo && sp.media ? Buffer.from(sp.media) : null, videoType: isVideo ? sp.mediaType : null, videoSize: isVideo && sp.media ? sp.media.length : null,
    scheduledPostId: sp.id
  } });
  return { ok: true, postId: post.id };
}

async function processOne(id: string) {
  // 同時に複数実行されないよう、processing に更新できた場合だけ処理する
  const claimed = await prisma.scheduledPost.updateMany({ where: { id, status: 'pending' }, data: { status: 'processing' } });
  if (claimed.count === 0) return;

  const post = await prisma.scheduledPost.findUnique({ where: { id } });
  if (!post) return;
  const already = ((post.postedIds as Record<string, string> | null) ?? {});
  const targets = (post.platforms as Target[]).filter((p) => !already[p]);
  const external = targets.filter((p): p is Platform => p !== 'awp');
  const accounts = await prisma.socialAccount.findMany({ where: { userId: post.userId, platform: { in: external } } });
  const mediaUrl = post.media ? scheduledMediaUrl(post.id) : post.mediaUrl;
  const results: Record<string, PostResult> = {};
  const postedIds: Record<string, string> = { ...already };

  for (const target of targets) {
    try {
      if (target === 'awp') {
        results.awp = await postToAwp(post);
      } else {
        const account = accounts.find((a) => a.platform === target);
        if (!account) { results[target] = { ok: false, error: 'このアカウントは連携されていません。' }; continue; }
        if (account.status === 'expired') { results[target] = { ok: false, error: '連携の有効期限が切れています。SNS連携画面から再連携してください。' }; continue; }
        results[target] = await POSTERS[target](account, { text: post.text, mediaUrl });
        if (!results[target].ok && isAuthError((results[target] as { error: string }).error)) {
          await prisma.socialAccount.update({ where: { id: account.id }, data: { status: 'expired', lastError: (results[target] as { error: string }).error.slice(0, 500) } });
        }
      }
    } catch (e: any) {
      results[target] = { ok: false, error: String(e?.message || e) };
    }
    const r = results[target];
    if (r.ok) postedIds[target] = r.postId;
  }

  const attempts = post.attempts + 1;
  const failed = Object.entries(results).filter(([, r]) => !r.ok);
  const allDone = (post.platforms as string[]).every((p) => postedIds[p]);
  const shouldRetry = !allDone && attempts < MAX_ATTEMPTS;
  const status = allDone ? 'done' : shouldRetry ? 'pending' : postedIds && Object.keys(postedIds).length ? 'partial' : 'failed';
  const lastError = failed.map(([p, r]) => `${p}: ${(r as { error: string }).error}`).join(' / ').slice(0, 1000) || null;

  await prisma.scheduledPost.update({
    where: { id },
    data: {
      status, attempts, postedIds: postedIds as any, lastError,
      nextAttemptAt: shouldRetry ? new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]) : null,
      results: { ...(post.results as object), [`attempt_${attempts}`]: results } as any
    }
  });
  await logEvent(status === 'done' ? 'social.post.done' : status === 'pending' ? 'social.post.retry' : 'social.post.failed', { scheduledPostId: id, userId: post.userId, platforms: post.platforms, attempts, postedIds, error: lastError });
}

async function tick() {
  // 緊急コントロールで止められている間は投稿しない（予約はそのまま残り、再開後に投稿される）
  if (await getFlag(SETTING_KEYS.pauseSnsPosting)) return;
  const now = new Date();
  const due = await prisma.scheduledPost.findMany({
    where: { status: 'pending', scheduledAt: { lte: now }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    select: { id: true },
    orderBy: { scheduledAt: 'asc' },
    take: 10
  });
  for (const { id } of due) {
    await processOne(id).catch((e) => console.error('scheduled post processing failed', id, e?.message));
  }
}

// 予約を今すぐ再試行できる状態に戻す（画面の「再試行」）
export async function retryScheduledPost(id: string, userId: string) {
  const r = await prisma.scheduledPost.updateMany({ where: { id, userId, status: { in: ['failed', 'partial'] } }, data: { status: 'pending', attempts: 0, nextAttemptAt: null, scheduledAt: new Date(), lastError: null } });
  return r.count > 0;
}

let started = false;
export function startScheduler() {
  if (started) return;
  started = true;
  setInterval(() => { tick().catch((e) => console.error('scheduler tick failed', e?.message)); }, POLL_INTERVAL_MS);
  setInterval(() => { syncAllEnabled().catch((e) => console.error('social sync tick failed', e?.message)); }, SYNC_INTERVAL_MS);
  console.log(`SNS投稿スケジューラを開始しました（${POLL_INTERVAL_MS / 1000}秒ごとに確認・取り込みは1時間ごと）`);
}
