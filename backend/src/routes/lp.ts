import { Router } from 'express';
import { promises as dnsPromises } from 'dns';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import prisma from '../prisma';
import { isGenerating, publicLp, runDesignJob, storedSections, type StoredSection } from '../ai/designJob';
import { PRESET_KEYS, PRESET_META, presetDesign } from '../ai/design';
import { writeSection } from '../ai/sectionWriter';
import { FEATURES, getFeature, publicCatalog } from '../features/catalog';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { isAdminUser } from '../middlewares/admin';
import { submitLpToIndexNow } from '../seo/indexnow';
import { publicProduct } from './products';
import { normalizeBookingConfig } from './bookings';
import { aiClient, describeAiError, metered } from '../lib/aiUsage';
import { hasPaidPlan, userHasPaidPlan } from '../lib/plans';
import { domainServable, evaluateDomain } from '../lib/domainPolicy';

const router = Router();

// 実績（口コミNo.1、○件など）や限定オファー（先着○名など）はAIに作らせない。
// 事実でない表示は、顧客が景品表示法の不当表示に問われるおそれがあるため、店主本人が事実を記入する。
// また正規表現・件数などの制約はAPIに送られないため付けず、受け取った後にサーバーで整える。
const LpContentSchema = z.object({
  heroTitle: z.string().describe('お客様の悩みや願いに応えるキャッチコピー（30文字程度）'),
  strengths: z.array(z.string()).describe('事業の強みを3つ。数字や実績、受賞歴など事実確認が必要な内容は含めない'),
  suggestedSlug: z.string().describe('事業内容をローマ字にした、半角英小文字・数字・ハイフンのURL')
});

// 事業内容を一言入力するだけで、LPの文章一式をAIが作成する
// （顧客がキーボードで長文を打たずに済むようにするための機能）
// 支払い前の無料お試し段階でも使えるようにする（登録直後にAIの力を体験してもらうため）。
// ただしAIの利用料が発生するため、1人あたり24時間で10回までに制限する。
const AI_GENERATE_LIMIT = 10;
const aiGenerateRequests = new Map<string, number[]>();

router.post('/ai-generate', authenticate, metered('page_ai'), async (req: AuthRequest, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY が未設定のため、AI自動入力は使えません。' });
  }
  const description = String(req.body.description || '').slice(0, 300);
  if (!description) return res.status(400).json({ error: 'description is required' });

  const userId = req.user!.id;
  const now = Date.now();
  const recent = (aiGenerateRequests.get(userId) ?? []).filter((t) => now - t < 24 * 60 * 60 * 1000);
  if (recent.length >= AI_GENERATE_LIMIT && !(await isAdminUser(userId))) {
    return res.status(429).json({ error: `AI自動入力は24時間に${AI_GENERATE_LIMIT}回までです。時間をおいてお試しください。` });
  }
  aiGenerateRequests.set(userId, [...recent, now]);

  const purpose = normalizePurpose(req.body.purpose);
  try {
    const client = aiClient();
    const response = await client.beta.messages.parse({
      model: process.env.CLAUDE_MODEL || 'claude-opus-5',
      max_tokens: 1024,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: (purpose === 'creator'
        ? 'あなたは日本の若手クリエイター（音楽・イラスト・写真・動画・ハンドメイドなど）の活動紹介ページを手がけるコピーライターです。' +
          '入力された活動内容から、ファンや依頼主の心に刺さるキャッチコピーと、作品や活動の魅力3つを、親しみやすく前向きな日本語で作成してください。'
        : 'あなたは日本の中小事業者・個人事業主のランディングページを手がけるコピーライターです。' +
          '入力された事業内容から、見込み客の悩みや願いに応えるキャッチコピーと、事業の強み3つを、親しみやすく分かりやすい日本語で作成してください。') +
        '入力に書かれていない数字・実績・受賞歴・ランキング・限定条件は、決して作らないでください（事実でない表示になるため）。',
      messages: [{ role: 'user', content: description }],
      output_config: { effort: 'low', format: betaZodOutputFormat(LpContentSchema) }
    });
    const out = response.parsed_output;
    if (response.stop_reason === 'refusal' || !out) {
      return res.status(502).json({ error: 'AIの応答を解析できませんでした。もう一度お試しください。' });
    }
    const strengths = out.strengths.map((s) => s.trim()).filter(Boolean).slice(0, 3);
    if (strengths.length < 3) {
      return res.status(502).json({ error: 'AIの応答が不完全でした。もう一度お試しください。' });
    }
    const slug = out.suggestedSlug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    res.json({ heroTitle: out.heroTitle.trim(), strengths, suggestedSlug: slug.length >= 3 ? slug : '' });
  } catch (e: any) {
    if (e instanceof Anthropic.AuthenticationError) {
      res.status(401).json({ error: 'APIキーが無効です。' });
    } else if (e instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'レート制限に達しました。少し待ってからお試しください。' });
    } else {
      res.status(500).json({ error: describeAiError(e) });
    }
  }
});

// ---------- 独自ドメイン ----------
// 顧客がアプリの外に出るのは「Xserverでのドメイン取得」と「DNS設定」の2か所だけにし、
// ドメイン入力・設定値の表示・接続確認はすべてアプリ内で行う。
// 注意: '/domain' は1階層のパスなので、公開用の '/:slug' より前に定義すること。

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// 接続確認はサーバーのOS設定に頼らず、公開DNSに直接問い合わせる
// （ローカルのDNSキャッシュより顧客の設定変更が早く反映されるため）
const resolver = new dnsPromises.Resolver({ timeout: 3000, tries: 2 });
resolver.setServers((process.env.DNS_SERVERS || '1.1.1.1,8.8.8.8').split(',').map((s) => s.trim()));

function normalizeDomain(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '');
}

// 独自ドメインの設定状況と、Xserverへの誘導リンク（運営者のアフィリエイトURL）を返す
router.get('/domain', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const lp = await resolveLp(userId, req.query.lpId);
  const [registrars, referrals, paid] = await Promise.all([
    prisma.toolCatalogItem.findMany({ where: { isDomainRegistrar: true, enabled: true }, orderBy: { sortOrder: 'asc' }, select: { key: true, name: true, description: true } }),
    prisma.domainReferral.findMany({ where: { userId }, orderBy: { clickedAt: 'desc' }, take: 5, select: { toolKey: true, clickedAt: true } }),
    userHasPaidPlan(userId)
  ]);
  res.json({
    hasLp: !!lp,
    slug: lp?.slug ?? null,
    customDomain: lp?.customDomain ?? null,
    verified: lp?.customDomainVerified ?? false,
    mode: lp?.customDomainMode ?? null,
    note: lp?.customDomainNote ?? null,
    reviewUntil: lp?.customDomainReviewUntil ?? null,
    servable: lp ? domainServable(lp, paid) : false,
    hasPaidPlan: paid,
    cnameTarget: process.env.CUSTOM_DOMAIN_CNAME_TARGET || null,
    registrars,
    referrals
  });
});

router.put('/domain', authenticate, async (req: AuthRequest, res) => {
  const input = normalizeDomain(req.body.domain);
  const domain = input.startsWith('www.') ? input : `www.${input}`;
  if (!DOMAIN_RE.test(domain)) {
    return res.status(400).json({ error: 'ドメインの形式が正しくありません（例: www.example.jp）' });
  }
  const lp = await resolveLp(req.user!.id, req.body.lpId);
  if (!lp) return res.status(400).json({ error: '先にLPを作成してください。' });
  // 公開条件の判定: 提携リンクから取得 → 無料 / それ以外 → 有料プランが必要
  const policy = await evaluateDomain(req.user!.id, domain);
  if (!policy.mode) {
    return res.status(402).json({
      error: `独自ドメインでの公開には有料プランへの加入が必要です（${policy.note}）。AWPの提携リンクから取得したドメインなら無料で公開できます。`,
      upgradeUrl: '/plans'
    });
  }
  try {
    // 他人が未接続のまま登録しているだけのドメインは解放する（持ち主でない人の先取りを防ぐ）。
    // 接続確認済み＝実際にDNSを操作できた持ち主なので、そちらは守る。
    await prisma.landingPage.updateMany({
      where: { customDomain: domain, customDomainVerified: false, NOT: { id: lp.id } },
      data: { customDomain: null }
    });
    const updated = await prisma.landingPage.update({
      where: { id: lp.id },
      data: { customDomain: domain, customDomainVerified: false, customDomainMode: policy.mode, customDomainNote: policy.note, customDomainReviewUntil: policy.reviewUntil ?? null }
    });
    res.json({ customDomain: updated.customDomain, verified: false, mode: policy.mode, note: policy.note, reviewUntil: policy.reviewUntil ?? null });
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(400).json({ error: 'このドメインは既に別のページで使われています。' });
    res.status(500).json({ error: '保存に失敗しました。' });
  }
});

// DNSを照会し、CNAMEが当サービスを向いていれば接続済みにする
router.post('/domain/verify', authenticate, async (req: AuthRequest, res) => {
  const target = normalizeDomain(process.env.CUSTOM_DOMAIN_CNAME_TARGET || '');
  if (!target) return res.status(400).json({ error: 'CUSTOM_DOMAIN_CNAME_TARGET が未設定です。' });
  const lp = await resolveLp(req.user!.id, req.body.lpId);
  if (!lp?.customDomain) return res.status(400).json({ error: '先にドメインを登録してください。' });

  let records: string[] = [];
  try {
    records = (await resolver.resolveCname(lp.customDomain)).map(normalizeDomain);
  } catch (e: any) {
    // ENODATA（CNAMEなし）/ ENOTFOUND（ドメインが存在しない・未反映）は「まだ設定されていない」扱い。
    // それ以外はDNSへの問い合わせ自体の失敗なので、顧客を待たせ続けないようエラーとして返す。
    if (e?.code !== 'ENODATA' && e?.code !== 'ENOTFOUND') {
      console.error('DNS lookup failed', lp.customDomain, e?.code);
      return res.status(503).json({ error: '接続確認サービスに一時的につながりません。しばらくしてから再度お試しください。' });
    }
  }
  const verified = records.includes(target);
  await prisma.landingPage.update({ where: { id: lp.id }, data: { customDomainVerified: verified } });
  res.json({ verified, found: records, expected: target });
});

// 証明書の自動発行の可否（XServer VPS構成でCaddyが問い合わせる: GET /tls-ask?domain=...）
// 接続確認済みの顧客ドメインにだけ200を返し、無関係なドメインへの証明書発行を防ぐ
router.get('/tls-ask', async (req, res) => {
  const domain = normalizeDomain(String(req.query.domain || ''));
  const lp = domain
    ? await prisma.landingPage.findFirst({
        where: { customDomain: domain, customDomainVerified: true },
        select: { customDomainVerified: true, customDomainMode: true, customDomainReviewUntil: true, userId: true }
      })
    : null;
  // 公開条件を満たしているドメインだけ証明書を発行する
  res.sendStatus(lp && domainServable(lp, await userHasPaidPlan(lp.userId)) ? 200 : 404);
});

// 独自ドメイン → ページ。公開条件を満たしていない場合は、AWPのURLへ案内する（ページ自体は引き続きAWPで見られる）
router.get('/by-domain/:host', async (req, res) => {
  const lp = await prisma.landingPage.findFirst({
    where: { customDomain: normalizeDomain(req.params.host), customDomainVerified: true, hidden: false },
    select: { slug: true, userId: true, customDomainVerified: true, customDomainMode: true, customDomainReviewUntil: true }
  });
  if (!lp) return res.status(404).json({ error: 'Not found' });
  const servable = domainServable(lp, await userHasPaidPlan(lp.userId));
  res.json({ slug: lp.slug, redirect: !servable });
});

// ---- 運営者向け: 独自ドメインの確認 ----
async function requireAdminUser(req: AuthRequest, res: any) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!user?.isAdmin) {
    res.status(403).json({ error: '管理者のみ利用できます' });
    return false;
  }
  return true;
}

router.get('/admin/domains', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdminUser(req, res))) return;
  const pages = await prisma.landingPage.findMany({
    where: { customDomain: { not: null } },
    orderBy: { customDomainReviewUntil: 'asc' },
    select: {
      id: true, slug: true, businessName: true, customDomain: true, customDomainVerified: true, customDomainMode: true, customDomainNote: true, customDomainReviewUntil: true,
      user: { select: { id: true, name: true, domainReferrals: { orderBy: { clickedAt: 'desc' }, take: 5, select: { toolKey: true, clickedAt: true } } } }
    }
  });
  res.json({ pages });
});

// approve = 提携リンクからの取得を確認できた（無料で公開）/ reject = 確認できない（有料プランが必要）
router.post('/admin/domains/:id/:action', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdminUser(req, res))) return;
  const action = String(req.params.action);
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '操作が正しくありません' });
  const lp = await prisma.landingPage.findUnique({ where: { id: String(req.params.id) }, select: { id: true, userId: true, customDomain: true } });
  if (!lp?.customDomain) return res.status(404).json({ error: '見つかりません' });
  const note = String(req.body?.note ?? '').trim().slice(0, 300);
  await prisma.landingPage.update({
    where: { id: lp.id },
    data: action === 'approve'
      ? { customDomainMode: 'affiliate', customDomainNote: note || '運営者が提携リンクからの取得を確認', customDomainReviewUntil: null }
      : { customDomainMode: 'paid', customDomainNote: note || '提携リンクからの取得を確認できなかったため、有料プランで公開', customDomainReviewUntil: null }
  });
  res.json({ ok: true });
});

router.get('/templates', (req, res) => {
  res.json({ templates: PRESET_KEYS.map((key) => ({ key, ...PRESET_META[key] })) });
});

router.post('/templates/preview', (req, res) => {
  const businessName = String(req.body?.businessName || '').slice(0, 60) || '店舗名';
  const heroTitle = String(req.body?.heroTitle || '').slice(0, 60) || 'お客様に選ばれる理由がここにあります';
  const strengths = Array.isArray(req.body?.strengths)
    ? req.body.strengths.map((s: unknown) => String(s || '').slice(0, 40)).filter(Boolean).slice(0, 3)
    : [];
  const input = { businessName, heroTitle, strengths: strengths.length ? strengths : ['強み1', '強み2', '強み3'] };
  res.json({
    businessName,
    heroTitle,
    strengths: input.strengths,
    templates: PRESET_KEYS.map((key) => ({ key, ...PRESET_META[key], design: presetDesign(input, key) }))
  });
});

// LINEのWebhook設定を自動化する（顧客がLINE Developers管理画面を
// 自分で操作しなくて済むように、サーバー側でエンドポイント登録とテストまで行う）
// 有料プラン加入時にbilling.ts側からも呼べるようexportする
export async function setupLineWebhook(tenantId: string, channelAccessToken: string) {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) {
    return { ok: false, reason: 'PUBLIC_BASE_URL が未設定のため、Webhookの自動設定をスキップしました。' };
  }
  const endpoint = `${base.replace(/\/$/, '')}/api/webhook/${tenantId}`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${channelAccessToken}`
  };

  const setRes = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ endpoint })
  });
  if (!setRes.ok) {
    const body = await setRes.text();
    return { ok: false, reason: `Webhook URLの登録に失敗しました（アクセストークンをご確認ください）: ${body}` };
  }

  const testRes = await fetch('https://api.line.me/v2/bot/channel/webhook/test', {
    method: 'POST',
    headers,
    body: JSON.stringify({ endpoint })
  });
  const testBody = await testRes.json().catch(() => ({}));
  if (!testRes.ok || testBody.success === false) {
    return { ok: false, reason: 'Webhookのテスト送信に失敗しました。サーバーが外部からアクセスできるURLか確認してください。' };
  }
  return { ok: true };
}

const normalizePurpose = (v: unknown) => (v === 'creator' ? 'creator' : 'business');

// LINE公式アカウントの友だち追加URLだけを受け付ける（任意のURLを貼らせると偽サイトへの誘導に使われるため）。
// 空文字はnull（未登録）として扱う
const LINE_HOSTS = ['lin.ee', 'line.me', 'page.line.me'];
function normalizeLineAddUrl(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  const text = String(raw ?? '').trim();
  if (!text) return { ok: true, value: null };
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:' || u.username || u.password || !LINE_HOSTS.includes(u.hostname.toLowerCase())) return { ok: false };
    return { ok: true, value: u.toString() };
  } catch {
    return { ok: false };
  }
}
const LINE_URL_ERROR = 'LINEの友だち追加URL（https://lin.ee/... の形式）を入力してください。';

// アプリの画面やAPIと同じ名前のURLは、LPが表示できなくなるので使わせない
export const RESERVED_SLUGS = [
  'login', 'dashboard', 'wizard', 'billing', 'domain', 'by-domain', 'tls-ask', 'ai-generate', 'design',
  'features', 'templates', 'preview', 'line', 'list', 'public-slugs', 'notify-search-engines', 'social',
  'agents', 'automation', 'growth', 'photos', 'tools', 'export', 'contact', 'icon', 'apple-icon', 'forgot-password', 'harness', 'discover', 'profile', 'terms', 'builder', 'wallet', 'community', 'analytics', 'bookings', 'products', 'posts', 'feed', 'chat', 'shop', 'reserve', 'plans', 'order', 'orders', 'shop-settings', 'sell', 'cart', 'dev-login', 'api', 'admin', 'privacy', 'legal', 'sitemap.xml', 'robots.txt',
  // slugは {slug}.MAIN_DOMAIN のサブドメインとしても使われるため（frontend/src/proxy.ts）、
  // インフラ用途で使われがちな名前を横取りされないよう予約しておく
  'www', 'app', 'mail', 'smtp', 'imap', 'pop', 'pop3', 'ftp', 'sftp', 'ns', 'ns1', 'ns2', 'ns3', 'ns4',
  'mx', 'cdn', 'static', 'assets', 'media', 'support', 'help', 'status', 'blog', 'docs', 'dev', 'staging',
  'test', 'webmail', 'autodiscover', 'autoconfig', 'vpn', 'remote', 'git', 'ci', 'console'
];

// 有料プランに加入している（または管理者の）ユーザーかどうか。
// ページの公開は無料。LINE自動応答はAIの利用料がかかるため、有効化はこれがtrueの場合のみ
const isPaidUser = hasPaidPlan;

// 1アカウントで複数のページ（店舗・事業ごと）を持てるようにするためのヘルパー。
// lpIdの指定があればそのページを、なければ最初に作成したページを対象にする
// （既存の1ページだけのアカウントは、今まで通りlpId省略で動く）
async function resolveLp(userId: string, lpId: unknown) {
  const id = typeof lpId === 'string' && lpId ? lpId : undefined;
  if (id) return prisma.landingPage.findFirst({ where: { id, userId } });
  return prisma.landingPage.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

// LPとLINE設定を同時に作成する（作成・公開は無料。LINE自動応答の有効化は有料プラン加入後）
router.post('/wizard', authenticate, metered('page_design', false), async (req: AuthRequest, res) => {
  const { businessName, heroTitle, strengths, socialProof, scarcityOffer, slug, channelId, channelSecret, channelAccessToken, description } = req.body;
  const userId = req.user!.id;
  if (!/^[a-z0-9-]{3,40}$/.test(slug || '')) {
    return res.status(400).json({ error: '公開用URLは半角英数字とハイフンで3〜40文字にしてください' });
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return res.status(400).json({ error: 'このURLはシステムで使用しているため選べません。別のURLをお試しください。' });
  }
  // ページのURLとユーザー名（プロフィールのURL）は同じ名前空間なので、重複させない
  if (await prisma.user.findUnique({ where: { username: slug }, select: { id: true } })) {
    return res.status(400).json({ error: 'このURLは既に使われています。別のURLをお試しください。' });
  }
  const siteType = req.body.siteType === 'hp' ? 'hp' : 'lp';
  const templateKey = (PRESET_KEYS as string[]).includes(req.body.templateKey) ? req.body.templateKey : null;
  const purpose = normalizePurpose(req.body.purpose);
  const lineAdd = normalizeLineAddUrl(req.body.lineAddUrl);
  if (!lineAdd.ok) return res.status(400).json({ error: LINE_URL_ERROR });
  try {
    const lp = await prisma.landingPage.create({
      data: { userId, businessName, heroTitle, strengths, socialProof, scarcityOffer, slug, siteType, templateKey, purpose, lineAddUrl: lineAdd.value }
    });

    // デザイン（Claude→Gemini→Claudeの審査）は時間がかかるため、待たずに裏で作成する
    void runDesignJob(lp.id, typeof description === 'string' ? description.slice(0, 300) : undefined)
      .catch((e) => console.error('design job failed', lp.id, e?.message));

    // LINE公式アカウントを既に持っている顧客だけが、この時点で情報を入力する（任意）
    let webhook: { ok: boolean; reason?: string } | null = null;
    if (channelId && channelSecret && channelAccessToken) {
      await prisma.lineConfig.upsert({
        where: { userId },
        update: { channelId, channelSecret, channelAccessToken },
        create: { userId, channelId, channelSecret, channelAccessToken }
      });
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (isPaidUser(user)) {
        webhook = await setupLineWebhook(userId, channelAccessToken);
        if (webhook.ok) await prisma.lineConfig.update({ where: { userId }, data: { webhookActivated: true } });
      } else {
        webhook = { ok: true, reason: '有料プランへの加入後に自動で連携されます。' };
      }
    }
    // LINEのシークレットやトークンは画面側に返さない
    res.json({ lp: publicLp(lp), webhook });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(400).json({ error: 'このURLは既に使われています。別のURLをお試しください。' });
    }
    res.status(400).json({ error: 'Failed to create LP' });
  }
});

// LINE友だち追加URL（公開ページのLINEボタンの行き先）をあとから登録・変更・削除する
router.put('/contact', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveLp(req.user!.id, req.body?.lpId);
  if (!lp) return res.status(404).json({ error: '先にページを作成してください。' });
  const lineAdd = normalizeLineAddUrl(req.body?.lineAddUrl);
  if (!lineAdd.ok) return res.status(400).json({ error: LINE_URL_ERROR });
  await prisma.landingPage.update({ where: { id: lp.id }, data: { lineAddUrl: lineAdd.value } });
  res.json({ lineAddUrl: lineAdd.value });
});

// 無料お試し中にLINEをまだ持っていなかった顧客が、あとから接続情報を追加・更新する
router.put('/line', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const { channelId, channelSecret, channelAccessToken } = req.body;
  if (!channelId || !channelSecret || !channelAccessToken) {
    return res.status(400).json({ error: 'Channel ID・Channel Secret・Channel Access Tokenをすべて入力してください。' });
  }
  await prisma.lineConfig.upsert({
    where: { userId },
    update: { channelId, channelSecret, channelAccessToken },
    create: { userId, channelId, channelSecret, channelAccessToken }
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  let webhook: { ok: boolean; reason?: string } = { ok: true, reason: '有料プランへの加入後に自動で連携されます。' };
  if (isPaidUser(user)) {
    webhook = await setupLineWebhook(userId, channelAccessToken);
    if (webhook.ok) await prisma.lineConfig.update({ where: { userId }, data: { webhookActivated: true } });
  }
  res.json({ ok: true, webhook });
});

// ---------- AIデザイン ----------
// 作り直しはAIの利用料がかかるため、1人あたり24時間で5回まで（1台構成の簡易な制限）
const DESIGN_LIMIT = 5;
const designRequests = new Map<string, number[]>();

// デザインの状況（ダッシュボード・アプリが生成完了まで確認するために使う）
router.get('/design', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveLp(req.user!.id, req.query.lpId);
  if (!lp) return res.status(404).json({ error: '先にページを作成してください。' });
  const p = publicLp(lp);
  res.json({ status: isGenerating(lp) ? 'generating' : 'ready', source: lp.designSource, design: p.design, hasImage: p.hasImage, imageVersion: p.imageVersion });
});

// デザインを作り直す（無料お試し中も、満足のいく仕上がりになるまで試せる）
router.post('/design', authenticate, metered('page_design'), async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const lp = await resolveLp(userId, req.body?.lpId);
  if (!lp) return res.status(404).json({ error: '先にページを作成してください。' });
  if (isGenerating(lp)) return res.status(409).json({ error: 'デザインを作成中です。完了までお待ちください。' });

  const now = Date.now();
  const recent = (designRequests.get(userId) ?? []).filter((t) => now - t < 24 * 60 * 60 * 1000);
  if (recent.length >= DESIGN_LIMIT && !(await isAdminUser(userId))) {
    return res.status(429).json({ error: `デザインの作り直しは24時間に${DESIGN_LIMIT}回までです。時間をおいてお試しください。` });
  }
  designRequests.set(userId, [...recent, now]);

  void runDesignJob(lp.id, typeof req.body?.description === 'string' ? req.body.description.slice(0, 300) : undefined)
    .catch((e) => console.error('design job failed', lp.id, e?.message));
  res.status(202).json({ status: 'generating' });
});

// ---------- 機能（セクション）の追加 ----------
// 一覧と質問項目を返し、店主の回答をもとに Gemini（指示文の設計）→ Claude（実行）で作成する
const SECTION_LIMIT = 30;
const sectionRequests = new Map<string, number[]>();

router.get('/features', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveLp(req.user!.id, req.query.lpId);
  const added = lp ? storedSections(lp) : [];
  res.json({
    hasLp: !!lp,
    features: publicCatalog().map((f) => {
      const s = added.find((x) => x.feature === f.id);
      return { ...f, added: !!s, inputs: s?.inputs ?? {}, content: s?.content ?? null, promptBy: s?.promptBy ?? null };
    })
  });
});

router.post('/features/:id', authenticate, metered('page_section'), async (req: AuthRequest, res) => {
  const feature = getFeature(String(req.params.id));
  if (!feature) return res.status(404).json({ error: 'この機能はありません。' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AIが利用できないため、現在この機能を追加できません。' });

  const userId = req.user!.id;
  const lp = await resolveLp(userId, req.body?.lpId);
  if (!lp) return res.status(400).json({ error: '先にページを作成してください。' });

  // 回答を整える（定義にない項目は捨て、長さを制限）
  const body = (req.body?.inputs ?? {}) as Record<string, unknown>;
  const inputs: Record<string, string> = {};
  for (const f of feature.fields) {
    const v = typeof body[f.key] === 'string' ? (body[f.key] as string).trim().slice(0, f.type === 'textarea' ? 2000 : 200) : '';
    if (f.required && !v) return res.status(400).json({ error: `「${f.label}」を入力してください。` });
    if (v) inputs[f.key] = v;
  }

  const now = Date.now();
  const recent = (sectionRequests.get(userId) ?? []).filter((t) => now - t < 24 * 60 * 60 * 1000);
  if (recent.length >= SECTION_LIMIT && !(await isAdminUser(userId))) {
    return res.status(429).json({ error: `機能の作成は24時間に${SECTION_LIMIT}回までです。時間をおいてお試しください。` });
  }
  sectionRequests.set(userId, [...recent, now]);

  try {
    const written = await writeSection(feature, { businessName: lp.businessName, heroTitle: lp.heroTitle, strengths: lp.strengths }, inputs);
    // 地図リンクはAIに書かせず、住所から確実に作る
    if (feature.id === 'access' && inputs.address) {
      written.content.mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(inputs.address)}`;
    }
    const section: StoredSection = { feature: feature.id, content: written.content, inputs, promptBy: written.promptBy, updatedAt: new Date().toISOString() };
    // カタログの並び順で保存（ページ上の表示順になる）
    const order = FEATURES.map((f) => f.id);
    const sections = [...storedSections(lp).filter((s) => s.feature !== feature.id), section]
      .sort((a, b) => order.indexOf(a.feature) - order.indexOf(b.feature));
    await prisma.landingPage.update({ where: { id: lp.id }, data: { sections: sections as any } });
    res.json({ feature: feature.id, content: section.content, promptBy: section.promptBy });
  } catch (e: any) {
    console.error('section generation failed', feature.id, e?.message);
    res.status(502).json({ error: 'AIによる作成に失敗しました。時間をおいて再度お試しください。' });
  }
});

router.delete('/features/:id', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveLp(req.user!.id, req.query.lpId);
  if (!lp) return res.status(404).json({ error: 'Not found' });
  const sections = storedSections(lp).filter((s) => s.feature !== req.params.id);
  await prisma.landingPage.update({ where: { id: lp.id }, data: { sections: sections as any } });
  res.json({ ok: true });
});

// 無料お試し中の本人向けプレビュー画像（未公開でも本人だけは確認できる）
router.get('/preview/image', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveLp(req.user!.id, req.query.lpId);
  if (!lp?.heroImage) return res.status(404).end();
  res.set('Content-Type', lp.heroImageType || 'image/jpeg');
  res.send(Buffer.from(lp.heroImage));
});

// 1アカウントが持つページの一覧（店舗・事業ごとに複数持てる。ダッシュボードの切り替えに使う）
router.get('/list', authenticate, async (req: AuthRequest, res) => {
  const pages = await prisma.landingPage.findMany({
    where: { userId: req.user!.id },
    select: { id: true, slug: true, businessName: true, siteType: true, pageViews: true, createdAt: true, hidden: true },
    orderBy: { createdAt: 'asc' }
  });
  res.json({ pages });
});

// 内容を更新したときなどに、本人の意思で検索エンジン（Bing・Yandex等）へ再通知する
router.post('/notify-search-engines', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveLp(req.user!.id, req.body?.lpId);
  if (!lp) return res.status(404).json({ error: '先にページを作成してください。' });
  const result = await submitLpToIndexNow(lp.slug);
  if (!result.ok) return res.status(502).json({ error: result.reason || '送信に失敗しました。' });
  res.json({ ok: true });
});

// SEO: サイトマップ生成用に、公開されているページのURLを返す（作成したページは無料で公開される）
router.get('/public-slugs', async (req, res) => {
  const lps = await prisma.landingPage.findMany({ where: { hidden: false }, select: { slug: true, createdAt: true, designUpdatedAt: true } });
  const pages = lps.map((lp) => ({ slug: lp.slug, updatedAt: (lp.designUpdatedAt ?? lp.createdAt).toISOString() }));
  res.json({ pages });
});

// メイン画像（公開用）。PVは数えない
router.get('/:slug/image', async (req, res) => {
  const lp = await prisma.landingPage.findUnique({
    where: { slug: req.params.slug },
    select: { heroImage: true, heroImageType: true, hidden: true }
  });
  if (!lp?.heroImage || lp.hidden) return res.status(404).end();
  res.set('Content-Type', lp.heroImageType || 'image/jpeg');
  // URLに版数（?v=）を付けて配信するため、長期キャッシュしてよい
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(lp.heroImage));
});

// ---- A/Bテスト（見出しのバリエーション） ----
// 有効な行の中から均等な確率で1つ選ぶ。行が1つもなければnull（=既存のheroTitleのまま、今まで通りの挙動）
function pickVariant<T>(variants: T[]): T | null {
  if (variants.length === 0) return null;
  return variants[Math.floor(Math.random() * variants.length)];
}

router.get('/variants', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveLp(req.user!.id, req.query.lpId);
  if (!lp) return res.status(404).json({ error: 'LPが見つかりません' });
  const variants = await prisma.lpVariant.findMany({ where: { lpId: lp.id }, orderBy: { createdAt: 'asc' } });
  res.json({ variants });
});

// 新しいバリエーションを1件追加する。まだ1件もなければ、既定のheroTitleを「対照群」として自動で複製する
router.post('/variants', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveLp(req.user!.id, req.body.lpId);
  if (!lp) return res.status(404).json({ error: 'LPが見つかりません' });
  const heroTitle = String(req.body.heroTitle || '').trim();
  const label = String(req.body.label || '').trim();
  if (!heroTitle || !label) return res.status(400).json({ error: 'label / heroTitle は必須です' });

  const existingCount = await prisma.lpVariant.count({ where: { lpId: lp.id } });
  if (existingCount === 0) {
    await prisma.lpVariant.create({
      data: { lpId: lp.id, label: '既定（対照群）', heroTitle: lp.heroTitle, isControl: true }
    });
  }
  const variant = await prisma.lpVariant.create({ data: { lpId: lp.id, label, heroTitle } });
  res.status(201).json({ variant });
});

router.put('/variants/:id', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveLp(req.user!.id, req.body.lpId);
  const existing = lp && await prisma.lpVariant.findFirst({ where: { id: String(req.params.id), lpId: lp.id } });
  if (!existing) return res.status(404).json({ error: '見つかりません' });
  const { label, heroTitle, enabled } = req.body as { label?: string; heroTitle?: string; enabled?: boolean };
  const variant = await prisma.lpVariant.update({
    where: { id: existing.id },
    data: { label: label ?? existing.label, heroTitle: heroTitle ?? existing.heroTitle, enabled: enabled ?? existing.enabled }
  });
  res.json({ variant });
});

router.delete('/variants/:id', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveLp(req.user!.id, req.query.lpId);
  const existing = lp && await prisma.lpVariant.findFirst({ where: { id: String(req.params.id), lpId: lp.id } });
  if (!existing) return res.status(404).json({ error: '見つかりません' });
  await prisma.lpVariant.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// LINE友だち追加ボタンのクリック（=コンバージョン）を記録する。公開ページからの匿名リクエストのため認証なし
router.post('/:slug/convert', async (req, res) => {
  const variantId = String(req.body?.variantId || '');
  if (!variantId) return res.status(400).json({ error: 'variantId is required' });
  await prisma.lpVariant.updateMany({ where: { id: variantId }, data: { conversions: { increment: 1 } } });
  res.json({ ok: true });
});

// 特定のLPデータを取得（公開用）。作成したページはAWPのドメイン上で誰でも無料で公開される
router.get('/:slug', async (req, res) => {
  const lp = await prisma.landingPage.findUnique({
    where: { slug: req.params.slug },
    include: {
      variants: { where: { enabled: true } },
      tools: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { label: true, url: true, display: true } },
      user: { select: { username: true, name: true, profileHidden: true } },
      _count: { select: { likes: true } }
    }
  });
  if (!lp || lp.hidden) return res.status(404).json({ error: 'Not found' });
  // PV増加
  await prisma.landingPage.update({ where: { id: lp.id }, data: { pageViews: { increment: 1 } } });
  // brief（事実の台帳）には未確定の情報も入るため、公開APIには出さない
  const { variants, user, _count, userId: _ownerId, brief: _brief, ...lpData } = lp;
  const variant = pickVariant(variants);
  if (variant) {
    void prisma.lpVariant.update({ where: { id: variant.id }, data: { impressions: { increment: 1 } } }).catch(() => {});
  }
  // 収益化（PR枠）: 持ち主がオンにしていて、分配が許可された提携サービスだけを、PR表示付きで紹介する
  const promotions = lp.monetizationEnabled
    ? (await prisma.toolCatalogItem.findMany({
        where: { enabled: true, revenueShareAllowed: true, affiliateUrl: { not: null } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        take: 3,
        select: { key: true, name: true, description: true }
      }))
    : [];
  const products = await prisma.product.findMany({
    where: { lpId: lp.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, priceYen: true, priceNote: true, description: true, buyUrl: true, soldOut: true, purchasable: true, stock: true, requiresShipping: true, imageType: true, updatedAt: true }
  });
  // 直接払いショップ（出品者が販売を始めている場合だけ）
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: lp.userId }, select: { enabled: true, bankEnabled: true, inPersonEnabled: true, shippingFeeYen: true, freeShippingOverYen: true } });
  res.json({
    shop: seller?.enabled ? { methods: { bank: seller.bankEnabled, inPerson: seller.inPersonEnabled }, shippingFeeYen: seller.shippingFeeYen, freeShippingOverYen: seller.freeShippingOverYen } : null,
    ...publicLp(lpData),
    promotions,
    products: products.map(publicProduct),
    // 予約リクエストのフォームに必要な設定だけを出す
    booking: lpData.bookingEnabled ? normalizeBookingConfig(lpData.bookingConfig) : null,
    heroTitle: variant?.heroTitle || lpData.heroTitle,
    variantId: variant?.id ?? null,
    // 公開ページ下部のバー（作成者のプロフィール・いいね）用。非公開にされたプロフィールは出さない
    owner: user.username && !user.profileHidden ? { username: user.username, name: user.name } : null,
    likeCount: _count.likes
  });
});

// ダッシュボードデータ取得（本人はいつでも自分のLPを確認できる。公開されているかは別途billing/statusで判断）
router.get('/dashboard/stats', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const lp = await resolveLp(userId, req.query.lpId);
  const lineConfig = await prisma.lineConfig.findUnique({ where: { userId }, select: { channelId: true } });
  const inquiries = await prisma.inquiry.findMany({ where: { tenantId: userId }, orderBy: { createdAt: 'desc' } });
  const tools = lp
    ? await prisma.lpTool.findMany({ where: { lpId: lp.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { label: true, url: true, display: true } })
    : [];
  res.json({
    lp: lp ? { ...publicLp(lp), tools, designStatus: isGenerating(lp) ? 'generating' : 'ready' } : null,
    hasLineConfig: !!lineConfig?.channelId,
    inquiries
  });
});

export default router;
