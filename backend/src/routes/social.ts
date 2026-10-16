import { Router } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../prisma';
import { authenticate, AuthRequest, JWT_SECRET } from '../middlewares/auth';
import { requireActiveSubscription } from '../middlewares/subscription';
import { PLATFORMS, type Platform } from '../social/types';
import { instagramAuthorizeUrl, exchangeInstagramCode, verifyInstagramToken, refreshInstagramToken } from '../social/platforms/instagram';
import { requireAdmin } from '../middlewares/admin';
import { adminInstagramAccount, awpMediaPosts, instagramOverview, instagramTaskInstructions, queueInstagramPost } from '../social/instagramOps';
import { facebookAuthorizeUrl, exchangeFacebookCode } from '../social/platforms/facebook';
import { xAuthorizeUrl, exchangeXCode, generatePkce } from '../social/platforms/x';
import { tiktokAuthorizeUrl, exchangeTikTokCode } from '../social/platforms/tiktok';
import { captureError } from '../lib/errors';
import { hasPaidPlan } from '../lib/plans';

const router = Router();

const PLATFORM_LABEL: Record<Platform, string> = { x: 'X', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok' };

// OAuthの状態（誰が・どのプラットフォームに連携しようとしているか）をやり取りする間だけ持たせる、
// 署名付きの一時トークン。DBを増やさずに済むよう、JWTにそのまま載せる（10分で失効）
type OAuthState = { uid: string; platform: Platform; codeVerifier?: string };
function signOAuthState(payload: OAuthState): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '10m' });
}
function readOAuthState(token: string): OAuthState {
  return jwt.verify(token, JWT_SECRET) as OAuthState;
}

function callbackUrl(platform: Platform): string {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) throw new Error('PUBLIC_BASE_URL が未設定です');
  return `${base.replace(/\/$/, '')}/api/social/${platform}/callback`;
}

// 連携状況の一覧（OAuthアプリの登録が済んでいないプラットフォームは「準備中」として返す）
router.get('/accounts', authenticate, async (req: AuthRequest, res) => {
  const accounts = await prisma.socialAccount.findMany({ where: { userId: req.user!.id } });
  res.json({
    platforms: PLATFORMS.map((p) => {
      const a = accounts.find((x) => x.platform === p);
      return {
        platform: p,
        label: PLATFORM_LABEL[p],
        connected: !!a,
        accountLabel: a?.accountLabel ?? null,
        configured: !!process.env[`${p.toUpperCase()}_CLIENT_ID`]
      };
    })
  });
});

// OAuth開始。ブラウザの通常の画面遷移で先方のログイン画面へ送るため、
// Authorizationヘッダーではなくクエリの?tokenでログイン中の本人を確認する
router.get('/:platform/connect', async (req, res) => {
  const platform = req.params.platform as Platform;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (!PLATFORMS.includes(platform)) return res.status(404).json({ error: 'Unknown platform' });

  const clientId = process.env[`${platform.toUpperCase()}_CLIENT_ID`];
  if (!clientId) {
    return res.status(400).json({ error: `${PLATFORM_LABEL[platform]}との連携はまだ準備中です（開発者アプリの登録が必要です）。` });
  }
  if (!process.env.PUBLIC_BASE_URL) {
    return res.status(400).json({ error: 'PUBLIC_BASE_URL が未設定のため連携できません（サーバーが外部から到達できるURLが必要です）。' });
  }

  let uid: string;
  try {
    uid = (jwt.verify(String(req.query.token || ''), JWT_SECRET) as { id: string }).id;
  } catch {
    return res.status(401).json({ error: 'ログインが必要です。' });
  }
  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!hasPaidPlan(user)) {
    return res.status(402).json({ error: '有料プランへの加入が必要です。' });
  }

  const redirectUri = callbackUrl(platform);
  if (platform === 'instagram') {
    const state = signOAuthState({ uid, platform });
    return res.redirect(instagramAuthorizeUrl(clientId, redirectUri, state));
  }
  if (platform === 'facebook') {
    const state = signOAuthState({ uid, platform });
    return res.redirect(facebookAuthorizeUrl(clientId, redirectUri, state));
  }
  if (platform === 'x') {
    const { verifier, challenge } = generatePkce();
    const state = signOAuthState({ uid, platform, codeVerifier: verifier });
    return res.redirect(xAuthorizeUrl(clientId, redirectUri, state, challenge));
  }
  if (platform === 'tiktok') {
    const state = signOAuthState({ uid, platform });
    return res.redirect(tiktokAuthorizeUrl(clientId, redirectUri, state));
  }
  return res.redirect(`${frontendUrl}/social?connect_error=${encodeURIComponent('このプラットフォームの連携は準備中です。')}`);
});

// OAuthコールバック。認可コードをアクセストークンに交換し、連携済みアカウントとして保存する
router.get('/:platform/callback', async (req, res) => {
  const platform = req.params.platform as Platform;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const fail = (message: string) => res.redirect(`${frontendUrl}/social?connect_error=${encodeURIComponent(message)}`);

  if (!PLATFORMS.includes(platform)) return fail('不明な連携先です。');
  const code = String(req.query.code || '');
  const stateRaw = String(req.query.state || '');
  if (!code || !stateRaw) return fail('認可情報が不足しています。もう一度お試しください。');

  let state: OAuthState;
  try {
    state = readOAuthState(stateRaw);
  } catch {
    return fail('連携の有効期限が切れました。もう一度お試しください。');
  }
  if (state.platform !== platform) return fail('連携先が一致しませんでした。');

  const clientId = process.env[`${platform.toUpperCase()}_CLIENT_ID`];
  const clientSecret = process.env[`${platform.toUpperCase()}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return fail('連携設定が見つかりませんでした。');

  let redirectUri: string;
  try {
    redirectUri = callbackUrl(platform);
  } catch {
    return fail('サーバー設定に問題があります。');
  }

  const result = await (async () => {
    if (platform === 'instagram') return exchangeInstagramCode(code, clientId, clientSecret, redirectUri);
    if (platform === 'facebook') return exchangeFacebookCode(code, clientId, clientSecret, redirectUri);
    if (platform === 'x') return exchangeXCode(code, state.codeVerifier || '', clientId, clientSecret, redirectUri);
    if (platform === 'tiktok') return exchangeTikTokCode(code, clientId, clientSecret, redirectUri);
    return { ok: false as const, error: 'このプラットフォームの連携は準備中です。' };
  })();

  if (!result.ok) {
    void captureError('social_oauth', new Error(result.error), { platform });
    return fail(result.error);
  }

  await prisma.socialAccount.upsert({
    where: { userId_platform: { userId: state.uid, platform } },
    update: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      externalId: result.externalId,
      accountLabel: result.accountLabel,
      expiresAt: result.expiresAt
    },
    create: {
      userId: state.uid,
      platform,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      externalId: result.externalId,
      accountLabel: result.accountLabel,
      expiresAt: result.expiresAt
    }
  });

  res.redirect(`${frontendUrl}/social?connected=${platform}`);
});

// 連携解除
router.delete('/:platform', authenticate, async (req: AuthRequest, res) => {
  await prisma.socialAccount.deleteMany({ where: { userId: req.user!.id, platform: String(req.params.platform) } });
  res.json({ ok: true });
});

// 予約投稿の一覧
router.get('/posts', authenticate, async (req: AuthRequest, res) => {
  const posts = await prisma.scheduledPost.findMany({
    where: { userId: req.user!.id },
    orderBy: { scheduledAt: 'desc' },
    take: 50
  });
  res.json({ posts });
});

// 予約投稿の作成
router.post('/posts', authenticate, requireActiveSubscription, async (req: AuthRequest, res) => {
  const { text, mediaUrl, platforms, scheduledAt } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) return res.status(400).json({ error: '投稿文を入力してください。' });
  if (!Array.isArray(platforms) || platforms.length === 0 || platforms.some((p) => !PLATFORMS.includes(p))) {
    return res.status(400).json({ error: '投稿先を1つ以上選んでください。' });
  }
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000) {
    return res.status(400).json({ error: '予約日時が正しくありません（過去の日時は指定できません）。' });
  }
  const userId = req.user!.id;
  const connected = await prisma.socialAccount.findMany({ where: { userId, platform: { in: platforms } } });
  const missing = (platforms as Platform[]).filter((p) => !connected.some((a) => a.platform === p));
  if (missing.length > 0) {
    return res.status(400).json({ error: `未連携のアカウントがあります: ${missing.map((p) => PLATFORM_LABEL[p]).join('、')}` });
  }

  const post = await prisma.scheduledPost.create({
    data: { userId, text: text.trim().slice(0, 2000), mediaUrl: mediaUrl || null, platforms, scheduledAt: when }
  });
  res.status(201).json({ post });
});

// ---------- 運営者向け: AWP 公式 Instagram の運用 ----------
// Meta for Developers で発行した長期トークンを貼り付けて連携する（OAuthアプリの審査・公開設定が不要）
router.post('/instagram/manual', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const token = String(req.body?.accessToken ?? '').trim();
  if (!token) return res.status(400).json({ error: 'アクセストークンを入力してください' });
  const r = await verifyInstagramToken(token);
  if (!r.ok) return res.status(400).json({ error: r.error });
  const userId = req.user!.id;
  await prisma.socialAccount.upsert({
    where: { userId_platform: { userId, platform: 'instagram' } },
    update: { accessToken: r.accessToken, externalId: r.externalId, accountLabel: r.accountLabel, expiresAt: r.expiresAt, refreshToken: null },
    create: { userId, platform: 'instagram', accessToken: r.accessToken, externalId: r.externalId, accountLabel: r.accountLabel, expiresAt: r.expiresAt }
  });
  res.json({ ok: true, username: r.accountLabel, externalId: r.externalId });
});

router.get('/instagram/overview', authenticate, requireAdmin, async (_req: AuthRequest, res) => {
  const [overview, media] = await Promise.all([instagramOverview(), awpMediaPosts(12)]);
  res.json({ ...overview, awpMedia: media, publicBaseSet: !!process.env.PUBLIC_BASE_URL });
});

router.post('/instagram/refresh', authenticate, requireAdmin, async (_req: AuthRequest, res) => {
  const account = await adminInstagramAccount();
  if (!account) return res.status(404).json({ error: '未連携です' });
  const r = await refreshInstagramToken(account.accessToken);
  if (!r.ok) return res.status(400).json({ error: r.error });
  await prisma.socialAccount.update({ where: { id: account.id }, data: { accessToken: r.accessToken, expiresAt: r.expiresAt } });
  res.json({ ok: true, expiresAt: r.expiresAt.toISOString() });
});

// 自動公開（オン: エージェントの投稿を承認なしで予約に入れる / オフ: 下書きで承認待ち）
router.put('/instagram/settings', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const account = await adminInstagramAccount();
  if (!account) return res.status(404).json({ error: '未連携です' });
  if (typeof req.body?.autoPublish !== 'boolean') return res.status(400).json({ error: 'autoPublish を true / false で指定' });
  await prisma.user.update({ where: { id: account.userId }, data: { autoPublishEnabled: req.body.autoPublish } });
  res.json({ ok: true, autoPublish: req.body.autoPublish });
});

// 運営者が手で投稿を入れる（審査は通す）
router.post('/instagram/queue', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const r = await queueInstagramPost({ caption: String(req.body?.caption ?? ''), mediaUrl: String(req.body?.mediaUrl ?? ''), scheduledAt: req.body?.scheduledAt ?? null, by: 'owner' });
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.status(201).json(r);
});

// 下書きの承認（文面・日時を直してから予約に入れられる）／却下／予約の取り消し
router.post('/instagram/posts/:id/approve', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const account = await adminInstagramAccount();
  const post = account ? await prisma.scheduledPost.findFirst({ where: { id: String(req.params.id), userId: account.userId } }) : null;
  if (!post || !['draft', 'rejected'].includes(post.status)) return res.status(400).json({ error: '承認できる下書きがありません' });
  const text = typeof req.body?.text === 'string' && req.body.text.trim() ? req.body.text.trim().slice(0, 2200) : post.text;
  let when = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : post.scheduledAt;
  if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) when = new Date(Date.now() + 5 * 60_000);
  const updated = await prisma.scheduledPost.update({ where: { id: post.id }, data: { status: 'pending', text, scheduledAt: when, attempts: 0, results: { ...(post.results as object), approvedAt: new Date().toISOString() } as any } });
  res.json({ ok: true, post: { id: updated.id, status: updated.status, scheduledAt: updated.scheduledAt } });
});

router.post('/instagram/posts/:id/reject', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const account = await adminInstagramAccount();
  const r = account ? await prisma.scheduledPost.updateMany({ where: { id: String(req.params.id), userId: account.userId, status: { in: ['draft', 'pending'] } }, data: { status: 'rejected' } }) : { count: 0 };
  if (r.count === 0) return res.status(400).json({ error: '取り消せませんでした' });
  res.json({ ok: true });
});

// 今すぐ「SNS担当（Instagram）」に投稿計画を作らせる（AWP企業のタスクとして実行）
router.post('/instagram/plan', authenticate, requireAdmin, async (_req: AuthRequest, res) => {
  const account = await adminInstagramAccount();
  if (!account) return res.status(404).json({ error: '未連携です' });
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const title = `Instagram 投稿計画 ${day} ${new Date().toISOString().slice(11, 16)}`;
  const goal = await prisma.companyGoal.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });
  const task = await prisma.companyTask.create({ data: { assignee: 'instagram', createdBy: 'owner', title, instructions: instagramTaskInstructions(day, 'weekly'), risk: 'low', goalId: goal?.id ?? null } });
  res.status(201).json({ ok: true, taskId: task.id, title });
});

// 予約の取り消し（実行前のみ）
router.delete('/posts/:id', authenticate, async (req: AuthRequest, res) => {
  const result = await prisma.scheduledPost.updateMany({
    where: { id: String(req.params.id), userId: req.user!.id, status: 'pending' },
    data: { status: 'failed', results: { canceled: true } as any }
  });
  if (result.count === 0) return res.status(400).json({ error: '取り消せませんでした（すでに実行された可能性があります）。' });
  res.json({ ok: true });
});

export default router;
