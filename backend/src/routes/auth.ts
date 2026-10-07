import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import prisma from '../prisma';
import { authenticate, AuthRequest, JWT_SECRET, issueToken } from '../middlewares/auth';
import { maskJpMobile, normalizeJpMobile } from '../lib/phone';
import { checkVerificationCode, sendVerificationCode, smsMode } from '../lib/sms';
import { hitRateLimit } from '../lib/rateLimit';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEN_MIN = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
// サービス全体で1時間に送るSMSの上限。不正な大量送信が起きても請求額が膨らみ続けないようにする
const GLOBAL_SMS_PER_HOUR = Number(process.env.SMS_GLOBAL_HOURLY_LIMIT || 200);
const CODE_ERROR = 'コードが正しくないか、有効期限が切れています。もう一度コードを送ってお試しください。';

// 同じ番号・サービス全体の送信回数を制限してからSMSを送る。制限にかかったらエラーメッセージを返す
async function sendCodeWithLimits(phone: string): Promise<string | null> {
  if (hitRateLimit(`sms:phone:${phone}`, 3, TEN_MIN)) return '短時間に何度もコードを送っています。10分ほど待ってからお試しください。';
  if (hitRateLimit('sms:global', GLOBAL_SMS_PER_HOUR, HOUR)) return '現在混み合っています。時間をおいてお試しください。';
  await sendVerificationCode(phone);
  return null;
}

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
  res.json({ token: issueToken(admin) });
});

// 新規登録（ステップ1）: 入力内容を確認し、携帯番号にSMSで確認コードを送る。
// まだアカウントは作らず、入力内容は署名付きの一時トークン（15分有効）に入れてブラウザへ返す
router.post('/register/start', async (req, res) => {
  const { email, password } = req.body ?? {};
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'お名前を入力してください' });
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'パスワードは8文字以上にしてください' });

  const mode = smsMode();
  const phone = normalizeJpMobile(req.body?.phone);
  if (mode !== 'off' && !phone) return res.status(400).json({ error: '日本の携帯電話番号（070・080・090で始まる番号）を入力してください' });

  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    return res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
  }
  if (phone && mode !== 'off' && (await prisma.user.findUnique({ where: { phone }, select: { id: true } }))) {
    return res.status(400).json({ error: 'この電話番号は既に別のアカウントで使われています' });
  }

  if (mode !== 'off') {
    try {
      const limited = await sendCodeWithLimits(phone!);
      if (limited) return res.status(429).json({ error: limited });
    } catch (e: any) {
      console.error('signup sms failed', e?.message);
      return res.status(502).json({ error: 'SMSを送れませんでした。電話番号をご確認のうえ、時間をおいてお試しください。' });
    }
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const pendingToken = jwt.sign(
    { purpose: 'signup', name, email, passwordHash, phone: mode !== 'off' ? phone : null },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
  res.json({ pendingToken, codeRequired: mode !== 'off', maskedPhone: phone && mode !== 'off' ? maskJpMobile(phone) : null });
});

// 新規登録（ステップ2）: SMSのコードを確認してアカウントを作る（SMS未設定の環境ではコードなしで作成）
router.post('/register/verify', async (req, res) => {
  let pending: { purpose: string; name: string; email: string; passwordHash: string; phone: string | null };
  try {
    pending = jwt.verify(String(req.body?.pendingToken ?? ''), JWT_SECRET) as typeof pending;
    if (pending.purpose !== 'signup') throw new Error('wrong purpose');
  } catch {
    return res.status(400).json({ error: '入力から時間がたちすぎました。最初からやり直してください。' });
  }

  if (pending.phone) {
    if (hitRateLimit(`sms:check:${pending.phone}`, 10, TEN_MIN)) {
      return res.status(429).json({ error: '入力の回数が多すぎます。10分ほど待ってからお試しください。' });
    }
    const ok = await checkVerificationCode(pending.phone, String(req.body?.code ?? '').trim()).catch(() => false);
    if (!ok) return res.status(400).json({ error: CODE_ERROR });
  }

  try {
    const user = await prisma.user.create({
      data: {
        email: pending.email,
        password: pending.passwordHash,
        name: pending.name,
        phone: pending.phone,
        phoneVerifiedAt: pending.phone ? new Date() : null
      }
    });
    res.json({ token: issueToken(user), user: { id: user.id, name: user.name } });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      const field = String(e?.meta?.target ?? '');
      return res.status(400).json({ error: field.includes('phone') ? 'この電話番号は既に別のアカウントで使われています' : 'このメールアドレスは既に登録されています' });
    }
    throw e;
  }
});

// 旧方式の登録（スマホアプリの現行版が使用）。SMS認証が有効な環境では、認証を素通りできないよう受け付けない
router.post('/register', async (req, res) => {
  if (smsMode() !== 'off') {
    return res.status(400).json({ error: '電話番号の確認が必要になりました。アプリを最新版に更新するか、Webから登録してください。' });
  }
  const { email, password, name } = req.body;
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'パスワードは8文字以上にしてください' });
  }
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({ data: { email, password: hashedPassword, name } });
    res.json({ token: issueToken(user), user: { id: user.id, name: user.name } });
  } catch (error) {
    res.status(400).json({ error: 'このメールアドレスは既に登録されています' });
  }
});

// パスワード再設定（ステップ1）: 登録済みの携帯番号にSMSでコードを送る。
// アカウントの有無が外から分からないよう、登録がなくても同じ応答を返す
router.post('/password-reset/start', async (req, res) => {
  if (smsMode() === 'off') return res.status(503).json({ error: '現在、パスワードの再設定を受け付けていません。' });
  const email = String(req.body?.email ?? '').trim();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
  if (hitRateLimit(`reset:email:${email.toLowerCase()}`, 3, TEN_MIN)) {
    return res.status(429).json({ error: '短時間に何度もお試しいただいています。10分ほど待ってからお試しください。' });
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { phone: true, phoneVerifiedAt: true } });
  if (user?.phone && user.phoneVerifiedAt) {
    try {
      await sendCodeWithLimits(user.phone);
    } catch (e: any) {
      console.error('reset sms failed', e?.message);
    }
  }
  const resetToken = jwt.sign({ purpose: 'reset', email }, JWT_SECRET, { expiresIn: '15m' });
  res.json({ resetToken });
});

// パスワード再設定（ステップ2）: コードを確認して新しいパスワードにする。
// それまでに発行したログイン用トークンはすべて無効になる（盗まれたログイン状態も使えなくなる）
router.post('/password-reset/verify', async (req, res) => {
  let payload: { purpose: string; email: string };
  try {
    payload = jwt.verify(String(req.body?.resetToken ?? ''), JWT_SECRET) as typeof payload;
    if (payload.purpose !== 'reset') throw new Error('wrong purpose');
  } catch {
    return res.status(400).json({ error: '時間がたちすぎました。最初からやり直してください。' });
  }
  const newPassword = req.body?.newPassword;
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: '新しいパスワードは8文字以上にしてください' });
  }
  if (hitRateLimit(`reset:check:${payload.email.toLowerCase()}`, 10, TEN_MIN)) {
    return res.status(429).json({ error: '入力の回数が多すぎます。10分ほど待ってからお試しください。' });
  }

  const user = await prisma.user.findUnique({ where: { email: payload.email } });
  if (!user?.phone || !user.phoneVerifiedAt) return res.status(400).json({ error: CODE_ERROR });
  const ok = await checkVerificationCode(user.phone, String(req.body?.code ?? '').trim()).catch(() => false);
  if (!ok) return res.status(400).json({ error: CODE_ERROR });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(newPassword, 10), tokenVersion: { increment: 1 } }
  });
  res.json({ token: issueToken(updated), user: { id: updated.id, name: updated.name } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: issueToken(user), user: { id: user.id, name: user.name } });
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
