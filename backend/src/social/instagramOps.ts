import prisma from '../prisma';
import { instagramInsights, instagramProfile, instagramRecentMedia, refreshInstagramToken } from './platforms/instagram';
import { reviewSocialDraft } from '../agents/compliance';
import { SELF_PROMOTION_FACTS } from '../agents/selfPromotion';
import { OFFICIAL_USERNAME } from '../lib/official';

// AWP 公式 Instagram の運用（AWP企業の「SNS担当（Instagram）」と運営者画面の両方から使う）。
// - 連携先は「管理者が連携した Instagram アカウント」1つ
// - エージェントが作った投稿は、既定では「下書き（draft）」で運営者の承認を待つ。
//   運営者が自動公開をオンにすると、承認なしで予約（pending）に入り、予約投稿の仕組みで公開される
// - 事実でない実績・数字・限定表現は、他事業者向けと同じコンプライアンス審査で止める

export async function adminInstagramAccount() {
  return prisma.socialAccount.findFirst({ where: { platform: 'instagram', user: { isAdmin: true } }, include: { user: { select: { id: true, autoPublishEnabled: true } } } });
}

export const publicBase = () => (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
export const siteBase = () => (process.env.SITE_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');

// 投稿に使ってよいメディアの置き場所（AWP 自身が配信しているURLだけ。外部の画像を勝手に使わない）
export function allowedMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const hosts = [publicBase(), siteBase()].filter(Boolean).map((b) => new URL(b).host);
    return hosts.includes(u.host);
  } catch {
    return false;
  }
}

// AWP 公式アカウントと管理者の投稿（リール・写真）を、Instagram に載せられる公開URL付きで一覧にする
export async function awpMediaPosts(limit = 20) {
  const base = publicBase();
  const posts = await prisma.post.findMany({
    where: { hidden: false, OR: [{ user: { username: OFFICIAL_USERNAME } }, { user: { isAdmin: true } }], AND: [{ OR: [{ imageType: { not: null } }, { videoType: { not: null } }] }] },
    orderBy: { createdAt: 'desc' }, take: limit,
    select: { id: true, body: true, kind: true, imageType: true, videoType: true, createdAt: true, user: { select: { username: true } } }
  });
  return posts.map((p) => ({
    id: p.id, by: p.user.username, kind: p.videoType ? 'video' : 'image', body: p.body, createdAt: p.createdAt.toISOString(),
    mediaUrl: p.videoType ? `${base}/api/posts/${p.id}/video` : `${base}/api/posts/${p.id}/image`,
    awpUrl: `${siteBase()}/p/${p.id}`
  }));
}

export async function instagramQueue(userId: string, take = 30) {
  const rows = await prisma.scheduledPost.findMany({ where: { userId, platforms: { has: 'instagram' } }, orderBy: { scheduledAt: 'desc' }, take });
  return rows.map((r) => ({ id: r.id, text: r.text, mediaUrl: r.mediaUrl, scheduledAt: r.scheduledAt.toISOString(), status: r.status, attempts: r.attempts, results: r.results, createdAt: r.createdAt.toISOString() }));
}

export async function instagramOverview() {
  const account = await adminInstagramAccount();
  if (!account) return { connected: false as const };
  // 期限が10日を切ったら長期トークンを更新しておく
  if (account.expiresAt && account.expiresAt.getTime() - Date.now() < 10 * 86_400_000) {
    const r = await refreshInstagramToken(account.accessToken);
    if (r.ok) await prisma.socialAccount.update({ where: { id: account.id }, data: { accessToken: r.accessToken, expiresAt: r.expiresAt } });
  }
  const [profile, media, insights, queue] = await Promise.all([
    instagramProfile(account).catch((e) => ({ error: String(e?.message ?? e) })),
    instagramRecentMedia(account, 12).catch(() => []),
    instagramInsights(account).catch(() => ({})),
    instagramQueue(account.userId)
  ]);
  return {
    connected: true as const,
    account: { username: account.accountLabel, externalId: account.externalId, expiresAt: account.expiresAt?.toISOString() ?? null, connectedAt: account.connectedAt.toISOString() },
    autoPublish: account.user.autoPublishEnabled,
    profile, media, insights, queue
  };
}

export type QueueInput = { caption: string; mediaUrl: string; scheduledAt?: string | null; by: string; taskId?: string | null };

// 投稿を予約列に入れる（審査→下書き or 予約）。戻り値の ok=false は差し戻し（理由付き）
export async function queueInstagramPost(input: QueueInput) {
  const account = await adminInstagramAccount();
  if (!account) return { ok: false as const, error: 'Instagram が連携されていません（運営者画面「Instagram運用」から連携）' };
  const caption = input.caption.trim().slice(0, 2200);
  if (!caption) return { ok: false as const, error: 'キャプションが空です' };
  if (!allowedMediaUrl(input.mediaUrl)) return { ok: false as const, error: `mediaUrl は AWP が配信している https のURL（${publicBase()} か ${siteBase()}）だけ使えます` };
  const hashtags = (caption.match(/#[^\s#]+/g) ?? []).length;
  if (hashtags > 15) return { ok: false as const, error: 'ハッシュタグは15個以内にしてください' };
  if (/\bAI\b/i.test(caption)) return { ok: false as const, error: '人工知能の略語（英字2文字）は使いません。主体は「AWP」、概念は「intelligence」と書いてください' };

  const review = await reviewSocialDraft({ platform: 'instagram', text: caption, businessName: SELF_PROMOTION_FACTS.businessName, heroTitle: SELF_PROMOTION_FACTS.heroTitle, strengths: SELF_PROMOTION_FACTS.strengths }).catch(() => null);
  if (review && !review.approved) return { ok: false as const, error: `コンプライアンス審査で差し戻し: ${review.reason || '表現を見直してください'}` };

  let when = input.scheduledAt ? new Date(input.scheduledAt) : new Date(Date.now() + 10 * 60_000);
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) when = new Date(Date.now() + 10 * 60_000);
  const status = account.user.autoPublishEnabled ? 'pending' : 'draft';
  const post = await prisma.scheduledPost.create({
    data: { userId: account.userId, text: caption, mediaUrl: input.mediaUrl, platforms: ['instagram'], scheduledAt: when, status, results: { by: input.by, taskId: input.taskId ?? null, review: review ? { approved: review.approved, reason: review.reason } : null } as any }
  });
  return { ok: true as const, id: post.id, status, scheduledAt: when.toISOString(), note: status === 'draft' ? '運営者の承認待ち（運営者画面「Instagram運用」で承認すると予約に入る）' : '予約済み（自動公開オン）' };
}

// 「SNS担当（Instagram）」への定例タスクの指示
export function instagramTaskInstructions(day: string, kind: 'weekly' | 'daily') {
  const common = [
    'あなたは AWP 公式 Instagram の運用担当です。次の順に進めてください。',
    '1. instagram_overview で、フォロワー・最近の投稿・インサイト・予約列（下書き／予約済み）を確認する',
    '2. read_memory(dept:marketing) の方針と、list_awp_posts で使えるメディア（AWP公式・運営者の投稿の写真・動画）を確認する',
    '3. この口座は「活動報告」と「広報」のためのもの。投稿は「①活動報告（list_events(limit=100)・list_tasks(status=done)・get_overview で確かめた、今週できたこと・新しい機能・公開ページの実例・会議室の決定） ②広報（機能の使い方・作り方のコツ） ③AWPの考え方（参加配当・世界平和・みんなで作るSNS）」から選び、①を週の半分以上にする。実績・利用者数・収益の数字は確かめた事実だけ。限定・緊急の演出はしない。人工知能の略語（英字2文字）は使わず「AWP」「intelligence」と書く',
    '4. キャプションは日本語、冒頭1行で興味を引き、改行を使って読みやすく、最後に「▶ プロフィールのリンクから」。ハッシュタグは5〜10個、本文の後ろにまとめる',
    '5. メディアは list_awp_posts のURLを優先し、合うものが無ければ make_image で作る（文字・ロゴ・人物の顔を入れない）',
    '6. queue_instagram_post で予約列に入れる（scheduledAt は JST 12:00 か 19:00 を基本に、1日1本まで）。差し戻されたら理由に沿って直す',
    '7. write_memory(agent:instagram, ' + kind + '-' + day + ') に、何を・なぜ・次に試すことを残し、finish_task で報告する'
  ];
  if (kind === 'weekly') common.splice(2, 0, '2b. 今週の投稿計画（曜日・柱・狙い）を先に write_memory(dept:marketing, instagram-plan-' + day + ') に書く。投稿は3〜4本');
  else common.splice(2, 0, '2b. 予約列に今後7日の投稿が3本以上あれば、新しい投稿は作らず、インサイトから分かったことだけをメモして終える');
  return common.join('\n');
}
