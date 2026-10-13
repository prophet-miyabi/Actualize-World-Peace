import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';

// アプリ内の通知。プッシュ通知（notifyUser）と同じ内容が残り、下部タブの「通知」から読む
const router = Router();

router.get('/', authenticate, async (req: AuthRequest, res) => {
  const me = req.user!.id;
  const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
  const where: any = { userId: me };
  if (before && !Number.isNaN(before.getTime())) where.createdAt = { lt: before };
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { userId: me, readAt: null } })
  ]);
  res.json({ notifications: items, unread, hasMore: items.length === 30 });
});

router.get('/unread', authenticate, async (req: AuthRequest, res) => {
  res.json({ unread: await prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }) });
});

// 既読にする（ids を省くと全部）
router.post('/read', authenticate, async (req: AuthRequest, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 200) : null;
  await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

export default router;
