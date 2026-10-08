import { Response, NextFunction } from 'express';
import prisma from '../prisma';
import { AuthRequest } from './auth';
import { hasPaidPlan } from '../lib/plans';

// 有料プラン（ライト以上・以前のStripe加入者）と管理者だけが使える機能のゲート
export const requireActiveSubscription = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(402).json({ error: '有料プランへの加入が必要です。', code: 'SUBSCRIPTION_REQUIRED' });
  // 管理者はテストのため課金ゲートを通過できる（isAdminはDBを直接操作した場合のみtrueになる）
  if (!hasPaidPlan(user)) {
    return res.status(402).json({ error: '有料プランへの加入が必要です。', code: 'SUBSCRIPTION_REQUIRED' });
  }
  next();
};
