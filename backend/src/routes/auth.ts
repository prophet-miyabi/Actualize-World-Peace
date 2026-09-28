import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import prisma from '../prisma';
import { authenticate, AuthRequest, JWT_SECRET } from '../middlewares/auth';

const router = Router();

// 管理者用の自動ログインリンク（テスト専用）。
// ENABLE_DEV_LOGIN=true と DEV_LOGIN_CODE の両方が設定されているときだけ動く。
// 本番環境ではこれらの環境変数を絶対に設定しないこと。
router.get('/dev-login', async (req, res) => {
  const enabled = process.env.ENABLE_DEV_LOGIN === 'true';
  const secret = process.env.DEV_LOGIN_CODE;
  if (!enabled || !secret) return res.status(404).json({ error: 'Not found' });

  const given = Buffer.from(String(req.query.code || ''));
  const expected = Buffer.from(secret);
  const valid = given.length === expected.length && crypto.timingSafeEqual(given, expected);
  if (!valid) return res.status(404).json({ error: 'Not found' });

  const admin = await prisma.user.findFirst({ where: { isAdmin: true } });
  if (!admin) return res.status(404).json({ error: 'Not found' });
  const token = jwt.sign({ id: admin.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'パスワードは8文字以上にしてください' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({ data: { email, password: hashedPassword, name } });
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name } });
  } catch (error) {
    res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, name: user.name } });
});

// ログイン中のユーザー情報（スマホアプリの設定画面などで使用）
router.get('/me', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, name: true, email: true, subscriptionStatus: true, expoPushToken: true, isAdmin: true }
  });
  if (!user) return res.status(404).json({ error: 'Not found' });
  const { expoPushToken, ...rest } = user;
  res.json({ ...rest, pushEnabled: !!expoPushToken });
});

// スマホアプリのプッシュ通知先を登録／解除（null で解除）
router.put('/push-token', authenticate, async (req: AuthRequest, res) => {
  const token = req.body.token;
  if (token !== null && (typeof token !== 'string' || !/^Expo(nent)?PushToken\[[^\]]+\]$/.test(token))) {
    return res.status(400).json({ error: 'Invalid push token' });
  }
  await prisma.user.update({ where: { id: req.user!.id }, data: { expoPushToken: token } });
  res.json({ ok: true });
});

// アカウント削除（App Store / Google Play の必須要件）。
// 削除後も課金が続く事故を防ぐため、Stripeのサブスクを先に解約し、解約できなければ削除しない。
router.delete('/account', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: 'Not found' });

  if (user.stripeSubscriptionId) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return res.status(503).json({ error: '現在アカウントを削除できません。時間をおいて再度お試しください。' });
    try {
      const stripe = new Stripe(key);
      const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      if (sub.status !== 'canceled') await stripe.subscriptions.cancel(sub.id);
    } catch (e: any) {
      // Stripe側に既に存在しない場合は課金も発生しないので続行、それ以外は中止
      if (e?.code !== 'resource_missing') {
        console.error('Stripe cancel failed on account deletion', e?.message);
        return res.status(502).json({ error: 'お支払いの解約処理に失敗したため、削除を中止しました。時間をおいて再度お試しください。' });
      }
    }
  }

  await prisma.$transaction([
    prisma.inquiry.deleteMany({ where: { tenantId: user.id } }),
    prisma.landingPage.deleteMany({ where: { userId: user.id } }),
    prisma.lineConfig.deleteMany({ where: { userId: user.id } }),
    prisma.user.delete({ where: { id: user.id } })
  ]);
  res.json({ ok: true });
});

export default router;
