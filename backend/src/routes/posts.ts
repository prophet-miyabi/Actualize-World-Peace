import { Router } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';
import { authenticate, AuthRequest, JWT_SECRET } from '../middlewares/auth';
import { hitRateLimit } from '../lib/rateLimit';
import { isAdminUser } from '../middlewares/admin';

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
  user: { select: { username: true, name: true } }
} as const;

function view(p: { id: string; body: string; imageType: string | null; createdAt: Date; userId: string; user: { username: string | null; name: string } }, me: string | null) {
  return {
    id: p.id, body: p.body, createdAt: p.createdAt, mine: p.userId === me,
    image: p.imageType ? `/api/posts/${p.id}/image` : null,
    author: { username: p.user.username, name: p.user.name }
  };
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
  res.json({ posts: posts.map((p) => view(p, me)), hasMore: posts.length === PAGE_SIZE });
});

router.get('/user/:username', async (req: AuthRequest, res) => {
  const me = viewerId(req);
  const posts = await prisma.post.findMany({
    where: { ...visible, user: { ...visible.user, username: String(req.params.username).toLowerCase() } },
    orderBy: { createdAt: 'desc' }, take: PAGE_SIZE, select
  });
  res.json({ posts: posts.map((p) => view(p, me)) });
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
  res.status(201).json({ post: view(post, userId) });
});

router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  const post = await prisma.post.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (!post) return res.status(404).json({ error: '見つかりません' });
  await prisma.post.delete({ where: { id: post.id } });
  res.json({ ok: true });
});

export default router;
