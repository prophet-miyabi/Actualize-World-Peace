import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { diagnoseOpenErrors } from '../agents/monitoring';

const router = Router();

// AWP運営者（管理者）専用。顧客ごとの機能ではなく、システム自体の監視のため。
async function requireAdmin(req: AuthRequest, res: any): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!user?.isAdmin) {
    res.status(403).json({ error: '管理者のみ利用できます' });
    return false;
  }
  return true;
}

router.get('/', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const errors = await prisma.systemError.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ errors });
});

// 診断（Claudeによる原因分析）を今すぐ実行する。通常はエージェントループが定期的に行う
router.post('/run-now', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  diagnoseOpenErrors().catch((e) => console.error('monitoring run-now failed', e?.message));
  res.status(202).json({ ok: true, status: 'running' });
});

router.post('/:id/resolve', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  await prisma.systemError.update({ where: { id: String(req.params.id) }, data: { status: 'resolved' } });
  res.json({ ok: true });
});

export default router;
