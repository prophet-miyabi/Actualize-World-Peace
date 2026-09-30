import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { generateStatusReport } from '../agents/statusReport';

const router = Router();

// AWP運営者（管理者）専用。顧客ごとの機能ではなく、システム自体の開発進捗のため
async function requireAdmin(req: AuthRequest, res: any): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!user?.isAdmin) {
    res.status(403).json({ error: '管理者のみ利用できます' });
    return false;
  }
  return true;
}

// 生成し、そのままHTMLとして返す（ダッシュボードから新しいタブで開く想定）
router.get('/status', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { html } = await generateStatusReport();
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export default router;
