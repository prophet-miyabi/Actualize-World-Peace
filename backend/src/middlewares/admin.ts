import { Response, NextFunction } from 'express';
import prisma from '../prisma';
import { AuthRequest } from './auth';

// 管理者専用の操作（アプリ自体の外装画像の生成など）を、一般の顧客から守る
export const requireAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user?.isAdmin) return res.status(403).json({ error: 'Forbidden' });
  next();
};
