import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';

export interface AuthRequest extends Request { user?: { id: string } }

// JWT_SECRETが未設定のまま起動させない（固定値'secret'へのフォールバックは
// 誰でもトークンを偽造できてしまうため、本番運用では致命的な脆弱性になる）
export const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error('JWT_SECRET が未設定、または短すぎます（16文字以上の値を.envに設定してください）');
  }
  return s;
})();

// tv = tokenVersion。パスワード再設定で世代が進むと、それより古いトークンは使えなくなる
export function issueToken(user: { id: string; tokenVersion: number }) {
  return jwt.sign({ id: user.id, tv: user.tokenVersion }, JWT_SECRET, { expiresIn: '7d' });
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  let decoded: { id: string; tv?: number };
  try {
    decoded = jwt.verify(token, JWT_SECRET) as { id: string; tv?: number };
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  const user = await prisma.user.findUnique({ where: { id: decoded.id }, select: { tokenVersion: true } });
  if (!user || (decoded.tv ?? 0) !== user.tokenVersion) return res.status(401).json({ error: 'Invalid token' });
  req.user = { id: decoded.id };
  next();
};
