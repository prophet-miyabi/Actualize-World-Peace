import { Router } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';
import { authenticate, AuthRequest, JWT_SECRET } from '../middlewares/auth';
import { RESERVED_SLUGS } from './lp';
import { hitRateLimit } from '../lib/rateLimit';

// SNSの土台: プロフィール（/ユーザー名）・フォロー・いいね・発見・閲覧/クリックの記録・通報
const router = Router();

const USERNAME_RE = /^[a-z0-9-]{3,30}$/;
const CATEGORIES = ['business', 'creator', 'other'];
const REPORT_REASONS = ['illegal', 'scam', 'adult', 'harassment', 'copyright', 'other'];
const PAGE_SIZE = 24;

// ログインしていれば本人IDを返す（未ログインでも見られる画面で「フォロー中か」を出すため）
function viewerId(req: AuthRequest): string | null {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    return (jwt.verify(token, JWT_SECRET) as { id: string }).id;
  } catch {
    return null;
  }
}

function sanitizeLinks(raw: unknown): { label: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { label: string; url: string }[] = [];
  for (const item of raw.slice(0, 10)) {
    const label = String((item as any)?.label ?? '').trim().slice(0, 30);
    try {
      const u = new URL(String((item as any)?.url ?? '').trim());
      if (u.protocol !== 'https:' || u.username || u.password) continue;
      out.push({ label: label || u.hostname, url: u.toString() });
    } catch {
      // 不正なURLは捨てる
    }
  }
  return out;
}

async function requireAdmin(req: AuthRequest, res: any): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!user?.isAdmin) {
    res.status(403).json({ error: '管理者のみ利用できます' });
    return false;
  }
  return true;
}

// ---- プロフィール ----

router.get('/me/profile', authenticate, async (req: AuthRequest, res) => {
  const me = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { username: true, name: true, bio: true, category: true, region: true, links: true }
  });
  res.json({ profile: me });
});

router.put('/me/profile', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'ユーザー名は半角の英小文字・数字・ハイフンで3〜30文字にしてください' });
  if (RESERVED_SLUGS.includes(username)) return res.status(400).json({ error: 'このユーザー名はシステムで使用しているため選べません' });
  // ページのURLと同じ名前空間なので、既存のページURLとも重複させない
  if (await prisma.landingPage.findUnique({ where: { slug: username }, select: { id: true } })) {
    return res.status(400).json({ error: 'このユーザー名は既に使われています' });
  }
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: '表示名を入力してください' });
  const category = CATEGORIES.includes(req.body?.category) ? req.body.category : null;
  try {
    const profile = await prisma.user.update({
      where: { id: userId },
      data: {
        username,
        name,
        bio: String(req.body?.bio ?? '').trim().slice(0, 300) || null,
        category,
        region: String(req.body?.region ?? '').trim().slice(0, 30) || null,
        links: sanitizeLinks(req.body?.links)
      },
      select: { username: true, name: true, bio: true, category: true, region: true, links: true }
    });
    res.json({ profile });
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(400).json({ error: 'このユーザー名は既に使われています' });
    throw e;
  }
});

router.get('/profiles/:username', async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { username: String(req.params.username).toLowerCase() },
    select: {
      id: true, username: true, name: true, bio: true, category: true, region: true, links: true, profileHidden: true,
      _count: { select: { followers: true, following: true } },
      landingPages: {
        where: { hidden: false },
        orderBy: { createdAt: 'desc' },
        select: { slug: true, businessName: true, heroTitle: true, purpose: true, heroImageType: true, designUpdatedAt: true, _count: { select: { likes: true } } }
      }
    }
  });
  if (!user || user.profileHidden) return res.status(404).json({ error: 'Not found' });
  const me = viewerId(req);
  const isFollowing = me
    ? !!(await prisma.follow.findUnique({ where: { followerId_followingId: { followerId: me, followingId: user.id } } }))
    : false;
  res.json({
    profile: {
      username: user.username, name: user.name, bio: user.bio, category: user.category, region: user.region, links: user.links ?? [],
      followers: user._count.followers, following: user._count.following,
      pages: user.landingPages.map((p) => ({
        slug: p.slug, businessName: p.businessName, heroTitle: p.heroTitle, purpose: p.purpose, likes: p._count.likes,
        image: p.heroImageType ? `/api/lp/${p.slug}/image?v=${p.designUpdatedAt?.getTime() ?? 0}` : null
      }))
    },
    isFollowing,
    isMe: me === user.id
  });
});

// サイトマップ用（公開中のプロフィールのユーザー名だけ）
router.get('/public-profiles', async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { username: { not: null }, profileHidden: false },
    select: { username: true },
    take: 5000
  });
  res.json({ usernames: users.map((u) => u.username) });
});

// ---- フォロー・いいね ----

router.post('/follow/:username', authenticate, async (req: AuthRequest, res) => {
  const target = await prisma.user.findUnique({ where: { username: String(req.params.username).toLowerCase() }, select: { id: true } });
  if (!target) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  if (target.id === req.user!.id) return res.status(400).json({ error: '自分はフォローできません' });
  await prisma.follow.upsert({
    where: { followerId_followingId: { followerId: req.user!.id, followingId: target.id } },
    update: {},
    create: { followerId: req.user!.id, followingId: target.id }
  });
  res.json({ following: true, followers: await prisma.follow.count({ where: { followingId: target.id } }) });
});

router.delete('/follow/:username', authenticate, async (req: AuthRequest, res) => {
  const target = await prisma.user.findUnique({ where: { username: String(req.params.username).toLowerCase() }, select: { id: true } });
  if (!target) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  await prisma.follow.deleteMany({ where: { followerId: req.user!.id, followingId: target.id } });
  res.json({ following: false, followers: await prisma.follow.count({ where: { followingId: target.id } }) });
});

router.get('/likes/:slug', async (req: AuthRequest, res) => {
  const lp = await prisma.landingPage.findUnique({ where: { slug: String(req.params.slug) }, select: { id: true, hidden: true } });
  if (!lp || lp.hidden) return res.status(404).json({ error: 'Not found' });
  const me = viewerId(req);
  const [count, mine] = await Promise.all([
    prisma.pageLike.count({ where: { lpId: lp.id } }),
    me ? prisma.pageLike.findUnique({ where: { userId_lpId: { userId: me, lpId: lp.id } } }) : null
  ]);
  res.json({ count, liked: !!mine, signedIn: !!me });
});

router.post('/likes/:slug', authenticate, async (req: AuthRequest, res) => {
  const lp = await prisma.landingPage.findUnique({ where: { slug: String(req.params.slug) }, select: { id: true, hidden: true } });
  if (!lp || lp.hidden) return res.status(404).json({ error: 'Not found' });
  await prisma.pageLike.upsert({
    where: { userId_lpId: { userId: req.user!.id, lpId: lp.id } },
    update: {},
    create: { userId: req.user!.id, lpId: lp.id }
  });
  res.json({ liked: true, count: await prisma.pageLike.count({ where: { lpId: lp.id } }) });
});

router.delete('/likes/:slug', authenticate, async (req: AuthRequest, res) => {
  const lp = await prisma.landingPage.findUnique({ where: { slug: String(req.params.slug) }, select: { id: true } });
  if (!lp) return res.status(404).json({ error: 'Not found' });
  await prisma.pageLike.deleteMany({ where: { userId: req.user!.id, lpId: lp.id } });
  res.json({ liked: false, count: await prisma.pageLike.count({ where: { lpId: lp.id } }) });
});

// ---- 発見（新着・人気・フォロー中・キーワード・カテゴリー） ----

router.get('/discover', async (req: AuthRequest, res) => {
  const tab = ['new', 'popular', 'following'].includes(String(req.query.tab)) ? String(req.query.tab) : 'new';
  const category = ['business', 'creator'].includes(String(req.query.category)) ? String(req.query.category) : null;
  const q = String(req.query.q ?? '').trim().slice(0, 50);
  const me = viewerId(req);

  const where: any = { hidden: false, user: { profileHidden: false } };
  if (category) where.purpose = category;
  if (q) {
    where.OR = [
      { businessName: { contains: q, mode: 'insensitive' } },
      { heroTitle: { contains: q, mode: 'insensitive' } },
      { user: { name: { contains: q, mode: 'insensitive' } } },
      { user: { username: { contains: q.toLowerCase() } } },
      { user: { region: { contains: q, mode: 'insensitive' } } }
    ];
  }
  if (tab === 'following') {
    if (!me) return res.json({ pages: [], needsLogin: true });
    where.user = { ...where.user, followers: { some: { followerId: me } } };
  }

  const pages = await prisma.landingPage.findMany({
    where,
    orderBy: tab === 'popular' ? [{ likes: { _count: 'desc' } }, { pageViews: 'desc' }] : { createdAt: 'desc' },
    take: PAGE_SIZE,
    select: {
      slug: true, businessName: true, heroTitle: true, purpose: true, heroImageType: true, designUpdatedAt: true,
      user: { select: { username: true, name: true } },
      _count: { select: { likes: true } }
    }
  });
  res.json({
    pages: pages.map((p) => ({
      slug: p.slug, businessName: p.businessName, heroTitle: p.heroTitle, purpose: p.purpose, likes: p._count.likes,
      image: p.heroImageType ? `/api/lp/${p.slug}/image?v=${p.designUpdatedAt?.getTime() ?? 0}` : null,
      owner: p.user.username ? { username: p.user.username, name: p.user.name } : null
    }))
  });
});

// ---- 閲覧・クリックの記録（公開ページから送られる。訪問者を特定する情報は受け取らない） ----

router.post('/events', async (req, res) => {
  if (hitRateLimit('events:global', 3000, 60 * 1000)) return res.status(204).end();
  const type = req.body?.type === 'click' ? 'click' : req.body?.type === 'view' ? 'view' : null;
  const slug = String(req.body?.slug ?? '');
  if (!type || !/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(204).end();
  const lp = await prisma.landingPage.findUnique({ where: { slug }, select: { id: true } });
  if (!lp) return res.status(204).end();
  let source: string | null = null;
  try {
    const host = new URL(String(req.body?.ref ?? '')).hostname.toLowerCase();
    source = host ? host.slice(0, 100) : null;
  } catch {
    source = null;
  }
  const target = ['tool', 'line', 'sns', 'ad'].includes(req.body?.target) ? req.body.target : null;
  await prisma.pageEvent.create({ data: { lpId: lp.id, type, target: type === 'click' ? target : null, source } }).catch(() => {});
  res.status(204).end();
});

// ---- 通報 ----

router.post('/reports', async (req: AuthRequest, res) => {
  const targetType = req.body?.targetType === 'profile' ? 'profile' : req.body?.targetType === 'page' ? 'page' : null;
  const targetId = String(req.body?.targetId ?? '').trim().toLowerCase();
  const reason = REPORT_REASONS.includes(req.body?.reason) ? req.body.reason : null;
  if (!targetType || !reason || !/^[a-z0-9-]{3,40}$/.test(targetId)) return res.status(400).json({ error: '通報の内容が正しくありません' });
  if (hitRateLimit(`report:${targetType}:${targetId}`, 20, 60 * 60 * 1000)) return res.status(429).json({ error: '時間をおいてお試しください' });
  await prisma.report.create({
    data: { targetType, targetId, reason, detail: String(req.body?.detail ?? '').trim().slice(0, 1000) || null, reporterId: viewerId(req) }
  });
  res.status(201).json({ ok: true });
});

router.get('/admin/reports', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const reports = await prisma.report.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200 });
  res.json({ reports });
});

// 運営者の対応: hide = 対象を非公開にする / unhide = 公開に戻す / dismiss = 問題なしとして閉じる
router.put('/admin/reports/:id', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const report = await prisma.report.findUnique({ where: { id: String(req.params.id) } });
  if (!report) return res.status(404).json({ error: '見つかりません' });
  const action = String(req.body?.action);
  if (!['hide', 'unhide', 'dismiss'].includes(action)) return res.status(400).json({ error: '操作が正しくありません' });

  if (action !== 'dismiss') {
    const hidden = action === 'hide';
    if (report.targetType === 'page') {
      await prisma.landingPage.updateMany({ where: { slug: report.targetId }, data: { hidden } });
    } else {
      await prisma.user.updateMany({ where: { username: report.targetId }, data: { profileHidden: hidden } });
    }
  }
  const updated = await prisma.report.update({
    where: { id: report.id },
    data: { status: action === 'hide' ? 'resolved' : 'dismissed' }
  });
  res.json({ report: updated });
});

export default router;
