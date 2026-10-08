import { Response, NextFunction } from 'express';
import prisma from '../prisma';
import { AuthRequest } from './auth';

// 管理者専用の操作（アプリ自体の外装画像の生成など）を、一般の顧客から守る
export const requireAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user?.isAdmin) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// 管理者かどうか（30秒だけ記憶して、同じ利用者の連続した確認でDBを叩き続けない）。
// 管理者は、テストと実際の利用のために、料金・利用枠・1日の回数制限をすべて通過できる
const adminCache = new Map<string, { value: boolean; until: number }>();
export async function isAdminUser(userId: string): Promise<boolean> {
  const hit = adminCache.get(userId);
  if (hit && hit.until > Date.now()) return hit.value;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  const value = !!user?.isAdmin;
  adminCache.set(userId, { value, until: Date.now() + 30_000 });
  return value;
}
