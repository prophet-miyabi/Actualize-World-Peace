import prisma from '../prisma';
import { postToInstagramReels } from './platforms/instagram';
import { postToFacebookPage } from './platforms/facebook';
import { postToTikTok } from './platforms/tiktok';
import { postToX } from './platforms/x';
import { postToYouTubeShorts } from './platforms/youtube';
import type { Platform, PostResult } from './types';

// Redis/BullMQを使わない、データベースだけで動く予約投稿の仕組み。
// 一定間隔でDBを見に行き、時刻が来た投稿を実行する（1台構成のうちはこれで十分機能する）。
// 将来Redisが使えるようになったら、このポーリングをBullMQのWorkerに置き換えられるよう、
// 「1件処理する」ロジック（processDuePosts内）はそのまま流用できる形にしてある。

const POLL_INTERVAL_MS = 15_000;
const MAX_ATTEMPTS = 3;

const POSTERS: Record<Platform, (account: any, input: any) => Promise<PostResult>> = {
  x: postToX,
  instagram: postToInstagramReels,
  facebook: postToFacebookPage,
  youtube: postToYouTubeShorts,
  tiktok: postToTikTok
};

async function processOne(id: string) {
  // 同時に複数実行されないよう、processing に更新できた場合だけ処理する
  const claimed = await prisma.scheduledPost.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'processing' }
  });
  if (claimed.count === 0) return;

  const post = await prisma.scheduledPost.findUnique({ where: { id } });
  if (!post) return;

  const accounts = await prisma.socialAccount.findMany({ where: { userId: post.userId, platform: { in: post.platforms } } });
  const results: Record<string, PostResult> = {};

  for (const platform of post.platforms as Platform[]) {
    const account = accounts.find((a) => a.platform === platform);
    if (!account) {
      results[platform] = { ok: false, error: 'このアカウントは連携されていません。' };
      continue;
    }
    try {
      results[platform] = await POSTERS[platform](account, { text: post.text, mediaUrl: post.mediaUrl });
    } catch (e: any) {
      results[platform] = { ok: false, error: String(e?.message || e) };
    }
  }

  const attempts = post.attempts + 1;
  const anyFailed = Object.values(results).some((r) => !r.ok);
  const allFailed = Object.values(results).every((r) => !r.ok);
  // 一部でも失敗があり、再試行の余地があれば pending に戻して次のポーリングで再実行する
  const shouldRetry = allFailed && attempts < MAX_ATTEMPTS;

  await prisma.scheduledPost.update({
    where: { id },
    data: {
      status: shouldRetry ? 'pending' : anyFailed ? 'failed' : 'done',
      attempts,
      results: { ...(post.results as object), [`attempt_${attempts}`]: results } as any
    }
  });
}

async function tick() {
  const due = await prisma.scheduledPost.findMany({
    where: { status: 'pending', scheduledAt: { lte: new Date() } },
    select: { id: true },
    take: 10
  });
  for (const { id } of due) {
    await processOne(id).catch((e) => console.error('scheduled post processing failed', id, e?.message));
  }
}

let started = false;
export function startScheduler() {
  if (started) return;
  started = true;
  setInterval(() => { tick().catch((e) => console.error('scheduler tick failed', e?.message)); }, POLL_INTERVAL_MS);
  console.log(`SNS投稿スケジューラを開始しました（${POLL_INTERVAL_MS / 1000}秒ごとに確認）`);
}
