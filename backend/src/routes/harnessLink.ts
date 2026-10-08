import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { hitRateLimit } from '../lib/rateLimit';
import { metered } from '../lib/aiUsage';
import { seal, open } from '../lib/secretBox';
import { draftForPlatform } from '../agents/marketing';
import { reviewSocialDraft } from '../agents/compliance';
import { storedSections } from '../ai/designJob';

// 利用者自身の X Harness / IG Harness と接続し、AWPで作った投稿を予約する。
// API仕様は各リポジトリのソースコード（apps/worker/src/routes）で確認したもの:
//   X:  GET /api/x-accounts / POST /api/posts/schedule {xAccountId, text, scheduledAt} / DELETE /api/posts/scheduled/:id
//   IG: GET /api/accounts / POST /api/media-posts?account_id= {post_type, media:[{url,type}], caption, scheduled_at} / DELETE /api/media-posts/:id
//   認証はどちらも Authorization: Bearer <APIキー>
// サーバーから利用者指定のURLへ通信するため、宛先は Cloudflare Workers（*.workers.dev）の https に限定する（内部ネットワークへの不正な通信を防ぐ）
const router = Router();
router.use(authenticate);

const KINDS = ['x', 'instagram'] as const;
type Kind = (typeof KINDS)[number];
const DAILY_SCHEDULES = 50;
const TIMEOUT_MS = 10_000;

export function normalizeHarnessUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw ?? '').trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.workers\.dev$/.test(host)) return null;
    return `https://${host}`;
  } catch {
    return null;
  }
}

async function harnessFetch(baseUrl: string, apiKey: string, path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const json: any = await res.json().catch(() => null);
  return { ok: res.ok && json?.success !== false, status: res.status, json };
}

async function listAccounts(kind: Kind, baseUrl: string, apiKey: string) {
  const r = await harnessFetch(baseUrl, apiKey, kind === 'x' ? '/api/x-accounts' : '/api/accounts');
  if (r.status === 401 || r.status === 403) throw new Error('APIキーが正しくないか、権限が足りません');
  if (!r.ok || !Array.isArray(r.json?.data)) throw new Error('Harnessに接続できませんでした。URLを確認してください');
  return (r.json.data as any[]).map((a) => ({
    id: String(a.id),
    label: kind === 'x' ? `@${a.username ?? ''}${a.displayName ? `（${a.displayName}）` : ''}` : `@${a.username ?? a.igUserId ?? ''}`,
    active: a.isActive !== false
  }));
}

const isKind = (v: unknown): v is Kind => KINDS.includes(v as Kind);

router.get('/', async (req: AuthRequest, res) => {
  const [links, posts] = await Promise.all([
    prisma.harnessLink.findMany({ where: { userId: req.user!.id }, select: { kind: true, baseUrl: true, accountId: true, accountLabel: true, updatedAt: true } }),
    prisma.harnessScheduledPost.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 30 })
  ]);
  res.json({ links, posts });
});

// 接続（URLとAPIキーを確認し、アカウントの一覧を返す。accountId を指定すると保存まで行う）
router.put('/:kind', async (req: AuthRequest, res) => {
  const kind = req.params.kind;
  if (!isKind(kind)) return res.status(404).json({ error: '見つかりません' });
  const baseUrl = normalizeHarnessUrl(req.body?.baseUrl);
  if (!baseUrl) return res.status(400).json({ error: 'HarnessのURLは https://〇〇.workers.dev の形式で入力してください' });
  const existing = await prisma.harnessLink.findUnique({ where: { userId_kind: { userId: req.user!.id, kind } } });
  const rawKey = String(req.body?.apiKey ?? '').trim();
  const apiKey = rawKey || (existing && existing.baseUrl === baseUrl ? open(existing.apiKeyEnc) : '');
  if (!apiKey || apiKey.length > 500) return res.status(400).json({ error: 'APIキーを入力してください' });
  if (hitRateLimit(`harness-link:${req.user!.id}`, 30, 3600_000)) return res.status(429).json({ error: '時間をおいてお試しください' });

  let accounts;
  try {
    accounts = await listAccounts(kind, baseUrl, apiKey);
  } catch (e: any) {
    return res.status(400).json({ error: e?.name === 'TimeoutError' ? 'Harnessからの応答がありませんでした' : e?.message || '接続できませんでした' });
  }
  const accountId = req.body?.accountId ? String(req.body.accountId) : null;
  if (!accountId) return res.json({ accounts });
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return res.status(400).json({ error: 'アカウントを選び直してください' });
  const data = { baseUrl, apiKeyEnc: seal(apiKey), accountId: account.id, accountLabel: account.label };
  await prisma.harnessLink.upsert({ where: { userId_kind: { userId: req.user!.id, kind } }, update: data, create: { ...data, userId: req.user!.id, kind } });
  res.json({ accounts, saved: true });
});

router.delete('/:kind', async (req: AuthRequest, res) => {
  await prisma.harnessLink.deleteMany({ where: { userId: req.user!.id, kind: String(req.params.kind) } });
  res.json({ ok: true });
});

// AIの下書き（ページに登録済みの事実だけを使い、公開前の審査AIを通す）
router.post('/:kind/draft', metered('sns_draft'), async (req: AuthRequest, res) => {
  const kind = req.params.kind;
  if (!isKind(kind)) return res.status(404).json({ error: '見つかりません' });
  const lpId = typeof req.body?.lpId === 'string' && req.body.lpId ? req.body.lpId : undefined;
  const lp = await prisma.landingPage.findFirst({ where: lpId ? { id: lpId, userId: req.user!.id } : { userId: req.user!.id }, orderBy: { createdAt: 'asc' } });
  if (!lp) return res.status(400).json({ error: '先にページを作成してください' });
  if (hitRateLimit(`harness-draft:${req.user!.id}`, 20, 24 * 3600_000)) return res.status(429).json({ error: '今日の下書き作成の上限に達しました' });
  try {
    const input = { businessName: lp.businessName, heroTitle: lp.heroTitle, strengths: lp.strengths, sections: storedSections(lp).map((s) => ({ feature: s.feature, content: s.content })) };
    const text = await draftForPlatform(kind, input);
    const review = await reviewSocialDraft({ platform: kind, text, businessName: lp.businessName, heroTitle: lp.heroTitle, strengths: lp.strengths });
    res.json({ text, review });
  } catch (e: any) {
    console.error('harness draft failed', e?.message);
    res.status(502).json({ error: '下書きを作れませんでした。時間をおいてお試しください' });
  }
});

// 予約（本人が内容を確認して送ったものだけ）
router.post('/:kind/schedule', async (req: AuthRequest, res) => {
  const kind = req.params.kind;
  if (!isKind(kind)) return res.status(404).json({ error: '見つかりません' });
  const userId = req.user!.id;
  const link = await prisma.harnessLink.findUnique({ where: { userId_kind: { userId, kind } } });
  if (!link?.accountId) return res.status(400).json({ error: '先にHarnessと接続してください' });
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: '投稿文を入力してください' });
  if (kind === 'x' && text.length > 280) return res.status(400).json({ error: 'Xの投稿は280文字以内にしてください' });
  if (text.length > 2200) return res.status(400).json({ error: '投稿文は2200文字以内にしてください' });
  const scheduledAt = new Date(String(req.body?.scheduledAt ?? ''));
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60_000) return res.status(400).json({ error: '予約日時は未来の日時にしてください' });
  if (hitRateLimit(`harness-schedule:${userId}`, DAILY_SCHEDULES, 24 * 3600_000)) return res.status(429).json({ error: '今日の予約の上限に達しました' });

  let body: unknown;
  let path: string;
  if (kind === 'x') {
    path = '/api/posts/schedule';
    body = { xAccountId: link.accountId, text, scheduledAt: scheduledAt.toISOString() };
  } else {
    // Instagramは画像が必須。ページのメイン画像（公開URL）を使う
    const lpId = typeof req.body?.lpId === 'string' && req.body.lpId ? req.body.lpId : undefined;
    const lp = await prisma.landingPage.findFirst({ where: lpId ? { id: lpId, userId } : { userId }, orderBy: { createdAt: 'asc' }, select: { slug: true, heroImageType: true, designUpdatedAt: true } });
    const publicBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!lp?.heroImageType || !publicBase.startsWith('https://')) return res.status(400).json({ error: 'Instagramへの予約には、ページのメイン画像が必要です' });
    path = `/api/media-posts?account_id=${encodeURIComponent(link.accountId)}`;
    body = { post_type: 'feed_image', media: [{ url: `${publicBase}/api/lp/${lp.slug}/image?v=${lp.designUpdatedAt?.getTime() ?? 0}`, type: 'image' }], caption: text, scheduled_at: scheduledAt.toISOString() };
  }

  try {
    const r = await harnessFetch(link.baseUrl, open(link.apiKeyEnc), path, { method: 'POST', body });
    if (!r.ok) {
      const error = String(r.json?.error ?? `HTTP ${r.status}`).slice(0, 300);
      await prisma.harnessScheduledPost.create({ data: { userId, kind, text, scheduledAt, status: 'failed', error } });
      return res.status(400).json({ error: `Harnessが予約を受け付けませんでした: ${error}` });
    }
    const post = await prisma.harnessScheduledPost.create({ data: { userId, kind, text, scheduledAt, remoteId: String(r.json?.data?.id ?? '') || null } });
    res.status(201).json({ post });
  } catch (e: any) {
    res.status(502).json({ error: e?.name === 'TimeoutError' ? 'Harnessからの応答がありませんでした' : 'Harnessに接続できませんでした' });
  }
});

router.delete('/posts/:id', async (req: AuthRequest, res) => {
  const post = await prisma.harnessScheduledPost.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (!post || post.status !== 'scheduled') return res.status(404).json({ error: '取り消せる予約が見つかりません' });
  const link = await prisma.harnessLink.findUnique({ where: { userId_kind: { userId: req.user!.id, kind: post.kind } } });
  if (link && post.remoteId) {
    const path = post.kind === 'x' ? `/api/posts/scheduled/${encodeURIComponent(post.remoteId)}` : `/api/media-posts/${encodeURIComponent(post.remoteId)}`;
    const r = await harnessFetch(link.baseUrl, open(link.apiKeyEnc), path, { method: 'DELETE' }).catch(() => null);
    if (!r?.ok) return res.status(400).json({ error: 'Harness側で取り消せませんでした（すでに投稿済みの可能性があります）' });
  }
  await prisma.harnessScheduledPost.update({ where: { id: post.id }, data: { status: 'canceled' } });
  res.json({ ok: true });
});

export default router;
