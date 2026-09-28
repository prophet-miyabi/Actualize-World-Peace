import { Response, NextFunction } from 'express';
import prisma from '../prisma';
import { AuthRequest } from './auth';

// 有料プラン加入者だけがLPを作成・編集できるようにするゲート
export const requireActiveSubscription = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(402).json({ error: '有料プランへの加入が必要です。', code: 'SUBSCRIPTION_REQUIRED' });
  // 管理者はテストのため課金ゲートを通過できる（isAdminはDBを直接操作した場合のみtrueになる）
  if (user.isAdmin) return next();
  if (user.subscriptionStatus !== 'active') {
    return res.status(402).json({ error: '有料プランへの加入が必要です。', code: 'SUBSCRIPTION_REQUIRED' });
  }
  next();
};
