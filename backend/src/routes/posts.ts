import { Router } from 'express';
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

const select = {
  id: true, body: true, imageType: true, createdAt: true, userId: true,
  user: { select: { username: true, name: true } },
  _count: { select: { likes: true, comments: { where: { hidden: false } } } }
} as const;

type PostRow = { id: string; body: string; imageType: string | null; createdAt: Date; userId: string; user: { username: string | null; name: string }; _count: { likes: number; comments: number } };

function view(p: PostRow, me: string | null, likedIds?: Set<string>) {
  return {
    id: p.id, body: p.body, createdAt: p.createdAt, mine: p.userId === me,
    image: p.imageType ? `/api/posts/${p.id}/image` : null,
    author: { username: p.user.username, name: p.user.name },
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
  const posts = await prisma.post.findMany({
    where: { ...visible, user: { ...visible.user, username: String(req.params.username).toLowerCase() } },
    orderBy: { createdAt: 'desc' }, take: PAGE_SIZE, select
  });
  const liked = await likedSet(me, posts.map((p) => p.id));
  res.json({ posts: posts.map((p) => view(p, me, liked)) });
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
  if (!body) return res.status(400).json({ error: '本文を入力してね' });
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
  const post = await prisma.post.create({ data: { userId, body, image, imageType }, select });
  void contribute(userId, 'post', post.id);
  res.status(201).json({ post: view(post, userId) });
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
    prisma.landingPage.findMany({ where: { userId: me }, orderBy: { createdAt: 'desc' }, select: { slug: true, businessName: true, heroTitle: true, hidden: true, pageViews: true, heroImageType: true, designUpdatedAt: true, _count: { select: { likes: true } } } }),
    prisma.notification.count({ where: { userId: me, readAt: null } }),
    contributionSummary(me),
    prisma.post.findMany({ where: { userId: me, hidden: false }, orderBy: { createdAt: 'desc' }, take: PAGE_SIZE, select })
  ]);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const liked = await likedSet(me, posts.map((p) => p.id));
  res.json({
    me: { username: user.username, name: user.name, bio: user.bio, category: user.category, region: user.region, links: user.links ?? [], isAdmin: user.isAdmin, followers: user._count.followers, following: user._count.following, postCount: user._count.posts },
    pages: pages.map((p) => ({ slug: p.slug, businessName: p.businessName, heroTitle: p.heroTitle, hidden: p.hidden, views: p.pageViews, likes: p._count.likes, image: p.heroImageType ? `/api/lp/${p.slug}/image?v=${p.designUpdatedAt?.getTime() ?? 0}` : null })),
    unread, contribution,
    posts: posts.map((p) => view(p, me, liked))
  });
});

export default router;
