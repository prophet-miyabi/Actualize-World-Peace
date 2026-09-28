import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};
