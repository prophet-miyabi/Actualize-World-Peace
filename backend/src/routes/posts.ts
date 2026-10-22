import { Router } from 'express';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';
import { authenticate, AuthRequest, JWT_SECRET } from '../middlewares/auth';
import { hitRateLimit } from '../lib/rateLimit';
import { isAdminUser } from '../middlewares/admin';
import { notifyUser } from '../lib/push';
import { contribute, contributionSummary } from '../lib/contribution';

// 投稿: プロフィールと、フォロワーのタイムラインに出る短い投稿（文章＋画像1枚）。
// 投稿するにはユーザー名（プロフィール）の設定が必要。通報で運営者が非公開にできる
const router = Router();

const MAX_BODY = 500;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;
const PAGE_SIZE = 20;
const DAILY_POSTS = 30;

function viewerId(req: AuthRequest): string | null {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    return (jwt.verify(token, JWT_SECRET) as { id: string }).id;
  } catch {
    return null;
  }
}

const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

const select = {
  id: true, body: true, imageType: true, kind: true, videoType: true, createdAt: true, userId: true, showOnPage: true, source: true, externalUrl: true,
  // 作った人と、その人の代表ページ（最初の公開ページ）。投稿からページへ飛べるようにする
  user: { select: { username: true, name: true, landingPages: { where: { hidden: false }, orderBy: { createdAt: 'asc' as const }, take: 1, select: { slug: true, businessName: true } } } },
  _count: { select: { likes: true, comments: { where: { hidden: false } } } }
} as const;

type PostRow = { id: string; body: string; imageType: string | null; kind: string; videoType: string | null; createdAt: Date; userId: string; showOnPage: boolean; source: string; externalUrl: string | null; user: { username: string | null; name: string; landingPages: { slug: string; businessName: string }[] }; _count: { likes: number; comments: number } };

function view(p: PostRow, me: string | null, likedIds?: Set<string>) {
  const page = p.user.landingPages[0];
  return {
    id: p.id, body: p.body, createdAt: p.createdAt, mine: p.userId === me, kind: p.kind, showOnPage: p.showOnPage,
    // 外部SNSから取り込んだ投稿は source と元URLを持つ（動画は本体を持たず、元URLへ案内する）
    source: p.source, externalUrl: p.externalUrl,
    image: p.imageType ? `/api/posts/${p.id}/image` : null,
    video: p.videoType ? `/api/posts/${p.id}/video` : null,
    author: { username: p.user.username, name: p.user.name, pageSlug: page?.slug ?? null, pageName: page?.businessName ?? null },
    likes: p._count.likes, comments: p._count.comments, liked: likedIds ? likedIds.has(p.id) : false
  };
}

// 自分がいいねした投稿のID（一覧の表示用）
async function likedSet(me: string | null, ids: string[]) {
  if (!me || ids.length === 0) return new Set<string>();
  const rows = await prisma.postLike.findMany({ where: { userId: me, postId: { in: ids } }, select: { postId: true } });
  return new Set(rows.map((r) => r.postId));
}

const visible = { hidden: false, user: { profileHidden: false, username: { not: null } } } as const;

// タイムライン: following = 自分とフォロー中の人 / all = みんな
router.get('/feed', async (req: AuthRequest, res) => {
  const me = viewerId(req);
  const tab = req.query.tab === 'following' ? 'following' : 'all';
  const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
  const where: any = { ...visible };
  if (before && !Number.isNaN(before.getTime())) where.createdAt = { lt: before };
  // リール: 動画本体を持つ投稿と、外部SNSから取り込んだ縦動画（本体なし・元URLあり）
  if (req.query.kind === 'reel') where.OR = [{ videoType: { not: null } }, { kind: 'reel', externalUrl: { not: null } }];
  if (tab === 'following') {
    if (!me) return res.json({ posts: [], needsLogin: true });
    const follows = await prisma.follow.findMany({ where: { followerId: me }, select: { followingId: true }, take: 2000 });
    where.userId = { in: [me, ...follows.map((f) => f.followingId)] };
  }
  const posts = await prisma.post.findMany({ where, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE, select });
  const liked = await likedSet(me, posts.map((p) => p.id));
  res.json({ posts: posts.map((p) => view(p, me, liked)), hasMore: posts.length === PAGE_SIZE });
});

router.get('/user/:username', async (req: AuthRequest, res) => {
  const me = viewerId(req);
  const limit = Math.min(PAGE_SIZE, Math.max(1, Number(req.query.limit) || PAGE_SIZE));
  // onPage=1: 持ち主のページに載せる投稿だけ（持ち主が「ページに非表示」にしたものは除く）
  const posts = await prisma.post.findMany({
    where: {
      ...visible, user: { ...visible.user, username: String(req.params.username).toLowerCase() },
      ...(req.query.kind === 'reel' ? { OR: [{ videoType: { not: null } }, { kind: 'reel', externalUrl: { not: null } }] } : {}),
      ...(req.query.onPage === '1' ? { showOnPage: true } : {})
    },
    orderBy: { createdAt: 'desc' }, take: limit, select
  });
  const liked = await likedSet(me, posts.map((p) => p.id));
  res.json({ posts: posts.map((p) => view(p, me, liked)) });
});

// 動画を付ける（投稿を作った直後に、本体を別送する。JSONではなく動画そのものを送る）
router.put('/:id/video', authenticate, express.raw({ type: VIDEO_TYPES, limit: '26mb' }), async (req: AuthRequest, res) => {
  const post = await prisma.post.findFirst({ where: { id: String(req.params.id), userId: req.user!.id }, select: { id: true, kind: true } });
  if (!post) return res.status(404).json({ error: '見つかりません' });
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  if (!VIDEO_TYPES.includes(type)) return res.status(400).json({ error: '動画は MP4・WebM・MOV にしてね' });
  const buf = req.body as Buffer;
  if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: '動画が空です' });
  if (buf.length > MAX_VIDEO_BYTES) return res.status(400).json({ error: '動画は25MBまでにしてね（60秒ほどの長さが目安）' });
  const kind = req.query.kind === 'post' ? 'post' : 'reel';
  await prisma.post.update({ where: { id: post.id }, data: { video: buf, videoType: type, videoSize: buf.length, kind } });
  res.json({ ok: true, video: `/api/posts/${post.id}/video`, kind });
});

// 動画の配信（途中からの再生に対応: Range）
router.get('/:id/video', async (req, res) => {
  const p = await prisma.post.findUnique({ where: { id: String(req.params.id) }, select: { video: true, videoType: true, hidden: true } });
  if (!p?.video || p.hidden) return res.status(404).end();
  const buf = Buffer.from(p.video);
  const total = buf.length;
  res.set('Content-Type', p.videoType || 'video/mp4');
  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', 'public, max-age=86400');
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    if (start >= total || start > end) return res.status(416).set('Content-Range', `bytes */${total}`).end();
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${total}`).set('Content-Length', String(end - start + 1));
    return res.end(buf.subarray(start, end + 1));
  }
  res.set('Content-Length', String(total));
  res.end(buf);
});

// 持ち主向け: 「最新の投稿」をページに表示するか
router.put('/page-settings', authenticate, async (req: AuthRequest, res) => {
  const lp = await prisma.landingPage.findFirst({ where: { id: String(req.body?.lpId ?? ''), userId: req.user!.id } });
  if (!lp) return res.status(404).json({ error: 'ページが見つかりません' });
  const data: { postsEnabled?: boolean; postsPlacement?: string; postsConfig?: any } = {};
  if (typeof req.body?.enabled === 'boolean') data.postsEnabled = req.body.enabled;
  if (req.body?.placement === 'top' || req.body?.placement === 'bottom') data.postsPlacement = req.body.placement;
  // 表示設定: 件数（3〜12）・種類（post / reel）・並び（grid / list）
  if (req.body?.config && typeof req.body.config === 'object') {
    const c = req.body.config as { count?: unknown; kinds?: unknown; layout?: unknown; title?: unknown };
    const prev = (lp.postsConfig as Record<string, unknown> | null) ?? {};
    const kinds = Array.isArray(c.kinds) ? c.kinds.filter((k): k is string => k === 'post' || k === 'reel') : undefined;
    data.postsConfig = {
      ...prev,
      ...(typeof c.count === 'number' ? { count: Math.min(12, Math.max(3, Math.round(c.count))) } : {}),
      ...(kinds && kinds.length ? { kinds } : {}),
      ...(c.layout === 'grid' || c.layout === 'list' ? { layout: c.layout } : {}),
      ...(typeof c.title === 'string' ? { title: c.title.trim().slice(0, 30) } : {})
    };
  }
  const page = await prisma.landingPage.update({ where: { id: lp.id }, data, select: { id: true, postsEnabled: true, postsPlacement: true, postsConfig: true } });
  res.json({ page });
});

// 投稿ごとに「ページに載せる／載せない」を切り替える（持ち主だけ）。既定は載せる
router.patch('/:id', authenticate, async (req: AuthRequest, res) => {
  const post = await prisma.post.findFirst({ where: { id: String(req.params.id), userId: req.user!.id }, select: { id: true } });
  if (!post) return res.status(404).json({ error: '見つかりません' });
  if (typeof req.body?.showOnPage !== 'boolean') return res.status(400).json({ error: 'showOnPage を true / false で指定してください' });
  const updated = await prisma.post.update({ where: { id: post.id }, data: { showOnPage: req.body.showOnPage }, select });
  res.json({ post: view(updated, req.user!.id) });
});

// 投稿の詳細（返信つき）
router.get('/:id', async (req: AuthRequest, res) => {
  const me = viewerId(req);
  const post = await prisma.post.findFirst({ where: { id: String(req.params.id), ...visible }, select });
  if (!post) return res.status(404).json({ error: '見つかりません' });
  const comments = await prisma.comment.findMany({
    where: { postId: post.id, hidden: false }, orderBy: { createdAt: 'asc' }, take: 200,
    select: { id: true, body: true, createdAt: true, userId: true, user: { select: { username: true, name: true } } }
  });
  const liked = await likedSet(me, [post.id]);
  res.json({ post: view(post, me, liked), comments: comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, mine: c.userId === me, author: { username: c.user.username, name: c.user.name } })) });
});

// いいね
router.post('/:id/like', authenticate, async (req: AuthRequest, res) => {
  const me = req.user!.id;
  const post = await prisma.post.findFirst({ where: { id: String(req.params.id), ...visible }, select: { id: true, userId: true, body: true } });
  if (!post) return res.status(404).json({ error: '見つかりません' });
  const existed = await prisma.postLike.findUnique({ where: { userId_postId: { userId: me, postId: post.id } } });
  if (!existed) {
    await prisma.postLike.create({ data: { userId: me, postId: post.id } });
    if (post.userId !== me) {
      const actor = await prisma.user.findUnique({ where: { id: me }, select: { name: true } });
      void notifyUser(post.userId, `${actor?.name ?? 'だれか'}さんがいいねしました`, post.body.slice(0, 60), { type: 'post_like', href: `/p/${post.id}`, actorId: me });
      void contribute(post.userId, 'like_received', post.id);
    }
  }
  res.json({ liked: true, likes: await prisma.postLike.count({ where: { postId: post.id } }) });
});
router.delete('/:id/like', authenticate, async (req: AuthRequest, res) => {
  const id = String(req.params.id);
  await prisma.postLike.deleteMany({ where: { userId: req.user!.id, postId: id } });
  res.json({ liked: false, likes: await prisma.postLike.count({ where: { postId: id } }) });
});

// 返信
router.post('/:id/comments', authenticate, async (req: AuthRequest, res) => {
  const me = req.user!.id;
  const user = await prisma.user.findUnique({ where: { id: me }, select: { username: true, name: true } });
  if (!user?.username) return res.status(400).json({ error: '返信するには、先にプロフィールでユーザー名を決めてね' });
  const post = await prisma.post.findFirst({ where: { id: String(req.params.id), ...visible }, select: { id: true, userId: true } });
  if (!post) return res.status(404).json({ error: '見つかりません' });
  const body = String(req.body?.body ?? '').trim().slice(0, 300);
  if (!body) return res.status(400).json({ error: '返信を入力してね' });
  if (!(await isAdminUser(me)) && hitRateLimit(`comment:${me}`, 100, 24 * 3600_000)) return res.status(429).json({ error: '今日はたくさん返信したね！続きは明日。' });
  const c = await prisma.comment.create({ data: { postId: post.id, userId: me, body } });
  void contribute(me, 'comment', c.id);
  if (post.userId !== me) void notifyUser(post.userId, `${user.name}さんが返信しました`, body.slice(0, 60), { type: 'comment', href: `/p/${post.id}`, actorId: me });
  res.status(201).json({ comment: { id: c.id, body: c.body, createdAt: c.createdAt, mine: true, author: { username: user.username, name: user.name } } });
});
router.delete('/comments/:cid', authenticate, async (req: AuthRequest, res) => {
  const c = await prisma.comment.findUnique({ where: { id: String(req.params.cid) }, select: { id: true, userId: true, post: { select: { userId: true } } } });
  if (!c) return res.status(404).json({ error: '見つかりません' });
  // 本人か、投稿の持ち主が消せる
  if (c.userId !== req.user!.id && c.post.userId !== req.user!.id) return res.status(403).json({ error: '削除できません' });
  await prisma.comment.delete({ where: { id: c.id } });
  res.json({ ok: true });
});

router.get('/:id/image', async (req, res) => {
  const p = await prisma.post.findUnique({ where: { id: String(req.params.id) }, select: { image: true, imageType: true, hidden: true } });
  if (!p?.image || p.hidden) return res.status(404).end();
  res.set('Content-Type', p.imageType || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(p.image));
});

router.post('/', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (!user?.username) return res.status(400).json({ error: '投稿するには、先にプロフィールでユーザー名を決めてね' });
  const body = String(req.body?.body ?? '').trim().slice(0, MAX_BODY);
  const kind = req.body?.kind === 'reel' ? 'reel' : 'post';
  const willUpload = !!req.body?.hasVideo;
  if (!body && !willUpload && !req.body?.imageDataUrl) return res.status(400).json({ error: '本文か、写真・動画を入れてね' });
  let image: Buffer | null = null;
  let imageType: string | null = null;
  if (typeof req.body?.imageDataUrl === 'string' && req.body.imageDataUrl) {
    const m = DATA_URL_RE.exec(req.body.imageDataUrl);
    if (!m) return res.status(400).json({ error: '画像はJPEG・PNG・WebPにしてね' });
    image = Buffer.from(m[2], 'base64');
    if (image.length > MAX_IMAGE_BYTES) return res.status(400).json({ error: '画像は3MBまでにしてね' });
    imageType = m[1];
  }
  if (!(await isAdminUser(userId)) && hitRateLimit(`post:${userId}`, DAILY_POSTS, 24 * 3600_000)) return res.status(429).json({ error: '今日はたくさん投稿したね！続きは明日。' });
  const post = await prisma.post.create({ data: { userId, body, image, imageType, kind }, select });
  void contribute(userId, 'post', post.id);
  // 同時に外部SNSへも配信する（crossPost: ["x","instagram"]）。動画は本体が後から届くため、少し遅らせて予約する
  let crossPost: { id: string; platforms: string[] } | null = null;
  const targets = Array.isArray(req.body?.crossPost) ? (req.body.crossPost as unknown[]).filter((p): p is string => typeof p === 'string' && p !== 'awp' && ['x', 'instagram', 'facebook', 'youtube', 'tiktok'].includes(p)) : [];
  if (targets.length) {
    const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const mediaUrl = base && (willUpload || image) ? `${base}/api/posts/${post.id}/${willUpload ? 'video' : 'image'}` : null;
    const sp = await prisma.scheduledPost.create({ data: { userId, text: body || ' ', mediaUrl, platforms: targets, kind, postId: post.id, scheduledAt: new Date(Date.now() + (willUpload ? 120_000 : 5_000)) }, select: { id: true, platforms: true } });
    crossPost = sp;
  }
  res.status(201).json({ post: view(post, userId), crossPost });
});

router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  const post = await prisma.post.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (!post) return res.status(404).json({ error: '見つかりません' });
  await prisma.post.delete({ where: { id: post.id } });
  res.json({ ok: true });
});

// マイページ用: 自分のプロフィール・数字・参加の記録・未読通知をまとめて返す
router.get('/me/summary', authenticate, async (req: AuthRequest, res) => {
  const me = req.user!.id;
  const [user, pages, unread, contribution, posts] = await Promise.all([
    prisma.user.findUnique({ where: { id: me }, select: { id: true, username: true, name: true, bio: true, category: true, region: true, links: true, isAdmin: true, _count: { select: { followers: true, following: true, posts: true } } } }),
    prisma.landingPage.findMany({ where: { userId: me }, orderBy: { createdAt: 'desc' }, select: { id: true, slug: true, businessName: true, heroTitle: true, hidden: true, pageViews: true, heroImageType: true, designUpdatedAt: true, postsEnabled: true, postsPlacement: true, postsConfig: true, _count: { select: { likes: true } } } }),
    prisma.notification.count({ where: { userId: me, readAt: null } }),
    contributionSummary(me),
    prisma.post.findMany({ where: { userId: me, hidden: false }, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE, select })
  ]);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const liked = await likedSet(me, posts.map((p) => p.id));
  res.json({
    me: { username: user.username, name: user.name, bio: user.bio, category: user.category, region: user.region, links: user.links ?? [], isAdmin: user.isAdmin, followers: user._count.followers, following: user._count.following, postCount: user._count.posts },
    pages: pages.map((p) => ({ id: p.id, slug: p.slug, businessName: p.businessName, heroTitle: p.heroTitle, hidden: p.hidden, views: p.pageViews, likes: p._count.likes, postsEnabled: p.postsEnabled, postsPlacement: p.postsPlacement, postsConfig: p.postsConfig ?? null, image: p.heroImageType ? `/api/lp/${p.slug}/image?v=${p.designUpdatedAt?.getTime() ?? 0}` : null })),
    onPageCount: posts.filter((p) => p.showOnPage).length,
    unread, contribution,
    posts: posts.map((p) => view(p, me, liked))
  });
});

export default router;
