// AWP Page Intelligence の API。
//   POST   /sessions                      最小入力からセッションを作る（未入力は仮置きして返す）
//   POST   /sessions/:id/research         業種×目的の調査（スナップショット。60日共有）
//   POST   /sessions/:id/structure        構成案を3つ作る
//   POST   /sessions/:id/images           選んだ案の各セクションの画像候補を作る { proposalId }
//   POST   /sessions/:id/images/:imageId/alternative   別の候補（雰囲気の変更も可）{ mood? }
//   POST   /sessions/:id/images/upload    自分の写真を候補にする { sectionId, dataUrl }
//   PATCH  /sessions/:id/selections       選択の保存 { proposalId?, images?, businessName?, slug? }
//   GET    /sessions/:id/check            公開前チェック
//   POST   /sessions/:id/apply            LandingPage / sections へ反映 { businessName, slug?, lineAddUrl? }
//   GET    /sessions/:id                  状態・構成案・画像候補・選択
//   GET    /options                       選択肢（業種・目的・雰囲気・必須要素）
//   GET    /preview/:token                プレビュー用（iframe から。トークンは推測不能な値）
//   GET    /images/:id  /photos/:photoId  画像本体（公開ページから参照される）
import { Router } from 'express';
import { z } from 'zod/v4';
import prisma from '../prisma';
import { InviteRequiredError, assertInviteForPageCreate } from '../lib/inviteGuard';
import { authenticate, type AuthRequest } from '../middlewares/auth';
import { metered } from '../lib/aiUsage';
import { classifyIndustry } from '../ai/playbook';
import { RESERVED_SLUGS } from './lp';
import {
  GOALS, INDUSTRY_CHOICES, REQUIRED, TONES, SECTION_IDS,
  alternativeImage, applySession, checkSession, generateProposals, inferDefaults, previewPayload, researchSnapshot, suggestImages, uploadCandidate
} from '../ai/pageIntelligence';

const router = Router();

// 画像候補の一覧では本体（data）を返さない
const IMAGE_SELECT = {
  id: true, sessionId: true, proposalId: true, sectionId: true, role: true, subject: true, tone: true, aspectRatio: true, cropPolicy: true, prompt: true,
  assetUrl: true, uploadId: true, mimeType: true, width: true, height: true, licenseInfo: true, source: true, reason: true, alternatives: true, altText: true, status: true, createdAt: true
} as const;

const short = (max: number) => z.string().trim().max(max);
const SessionBody = z.object({
  industry: short(60).min(1),
  pageGoal: short(20),
  targetAudience: z.object({ ageRange: short(30).optional(), gender: short(10).optional(), area: short(40).optional(), segment: short(10).optional(), stage: short(40).optional() }).partial().optional(),
  tone: short(20).optional(),
  valueProps: z.object({ problems: short(300).optional(), strengths: short(300).optional(), priceBand: short(60).optional(), proof: short(300).optional(), services: short(300).optional() }).partial().optional(),
  requiredSections: z.array(short(20)).max(10).optional(),
  lpId: z.string().optional().nullable()
});
const SelectionsBody = z.object({
  proposalId: z.string().optional(),
  images: z.record(z.string(), z.string()).optional(),
  businessName: short(60).optional(),
  slug: short(40).optional(),
  lineAddUrl: short(200).optional()
});
const ApplyBody = z.object({ businessName: short(60).min(1), slug: short(40).optional(), lineAddUrl: short(200).optional().nullable(), purpose: z.enum(['business', 'creator']).optional(), inviteCode: short(40).optional().nullable() });

const bad = (res: any, e: unknown, fallback: string) => {
  const msg = e instanceof z.ZodError ? '入力の形式が正しくありません' : (e as any)?.message || fallback;
  console.error('page-intelligence', msg);
  res.status(e instanceof z.ZodError ? 400 : 500).json({ error: msg });
};

async function ownSession(userId: string, id: string) {
  return prisma.pageIntelligenceSession.findFirst({ where: { id, userId } });
}

router.get('/options', (_req, res) => {
  res.json({ industries: INDUSTRY_CHOICES, goals: GOALS, tones: TONES.map(({ key, label }) => ({ key, label })), required: REQUIRED, sectionIds: SECTION_IDS });
});

router.post('/sessions', authenticate, metered('page_intelligence', false), async (req: AuthRequest, res) => {
  try {
    const body = SessionBody.parse(req.body ?? {});
    const userId = req.user!.id;
    if (body.lpId) {
      const lp = await prisma.landingPage.findFirst({ where: { id: body.lpId, userId }, select: { id: true } });
      if (!lp) return res.status(404).json({ error: 'ページが見つかりません' });
    }
    const d = inferDefaults(body);
    const industryKey = await classifyIndustry([body.industry, body.valueProps?.services ?? '', body.valueProps?.problems ?? ''].join(' '));
    const s = await prisma.pageIntelligenceSession.create({ data: {
      userId, lpId: body.lpId ?? null, industry: body.industry, industryKey, pageGoal: d.goal, targetAudience: d.targetAudience as any, tone: d.tone,
      valueProps: (body.valueProps ?? {}) as any, requiredSections: d.requiredSections, assumptions: d.assumptions as any, status: 'draft'
    } });
    await prisma.companyEvent.create({ data: { type: 'page_intelligence.session', actor: 'page-intelligence', payload: { sessionId: s.id, industry: body.industry, industryKey, goal: d.goal } as any } }).catch(() => {});
    res.status(201).json({ session: s });
  } catch (e) { bad(res, e, 'セッションを作成できませんでした'); }
});

router.post('/sessions/:id/research', authenticate, metered('page_intelligence'), async (req: AuthRequest, res) => {
  try {
    const s = await ownSession(req.user!.id, String(req.params.id));
    if (!s) return res.status(404).json({ error: 'セッションがありません' });
    const ta = (s.targetAudience ?? {}) as { area?: string };
    const snap = await researchSnapshot(s.industryKey ?? 'other', s.pageGoal, ta.area);
    await prisma.pageIntelligenceSession.update({ where: { id: s.id }, data: { researchSnapshotId: snap.id, status: s.status === 'draft' ? 'researched' : s.status } });
    res.json({ snapshot: snap });
  } catch (e) { bad(res, e, '調査に失敗しました'); }
});

router.post('/sessions/:id/structure', authenticate, metered('page_intelligence'), async (req: AuthRequest, res) => {
  try {
    const s = await ownSession(req.user!.id, String(req.params.id));
    if (!s) return res.status(404).json({ error: 'セッションがありません' });
    const proposals = await generateProposals(s.id);
    res.json({ proposals });
  } catch (e) { bad(res, e, '構成案を作れませんでした'); }
});

router.post('/sessions/:id/images', authenticate, metered('page_intelligence'), async (req: AuthRequest, res) => {
  try {
    const s = await ownSession(req.user!.id, String(req.params.id));
    if (!s) return res.status(404).json({ error: 'セッションがありません' });
    const proposalId = z.string().min(1).parse(req.body?.proposalId ?? s.selectedProposalId);
    const created = await suggestImages(s.id, proposalId);
    const images = await prisma.pageImageSuggestion.findMany({ where: { sessionId: s.id, proposalId }, orderBy: { createdAt: 'asc' }, select: IMAGE_SELECT });
    res.json({ created: created.length, images });
  } catch (e) { bad(res, e, '画像候補を作れませんでした'); }
});

router.post('/sessions/:id/images/upload', authenticate, async (req: AuthRequest, res) => {
  try {
    const s = await ownSession(req.user!.id, String(req.params.id));
    if (!s) return res.status(404).json({ error: 'セッションがありません' });
    const { sectionId, dataUrl } = z.object({ sectionId: z.string().min(1).max(20), dataUrl: z.string().min(20) }).parse(req.body ?? {});
    const row = await uploadCandidate(s.id, sectionId, dataUrl);
    const { data: _d, ...pub } = row;
    res.status(201).json({ image: pub });
  } catch (e) { bad(res, e, 'アップロードに失敗しました'); }
});

router.post('/sessions/:id/images/:imageId/alternative', authenticate, metered('page_intelligence'), async (req: AuthRequest, res) => {
  try {
    const s = await ownSession(req.user!.id, String(req.params.id));
    if (!s) return res.status(404).json({ error: 'セッションがありません' });
    const mood = typeof req.body?.mood === 'string' ? req.body.mood.slice(0, 80) : undefined;
    const row = await alternativeImage(s.id, String(req.params.imageId), mood);
    const { data: _d, ...pub } = row;
    res.status(201).json({ image: pub });
  } catch (e) { bad(res, e, '別の候補を作れませんでした'); }
});

router.patch('/sessions/:id/selections', authenticate, async (req: AuthRequest, res) => {
  try {
    const s = await ownSession(req.user!.id, String(req.params.id));
    if (!s) return res.status(404).json({ error: 'セッションがありません' });
    const body = SelectionsBody.parse(req.body ?? {});
    if (body.slug !== undefined) {
      if (!/^[a-z0-9-]{3,40}$/.test(body.slug)) return res.status(400).json({ error: '公開用URLは半角英数字とハイフンで3〜40文字にしてください' });
      if (RESERVED_SLUGS.includes(body.slug)) return res.status(400).json({ error: 'このURLはシステムで使用しているため選べません' });
      const taken = await prisma.landingPage.findUnique({ where: { slug: body.slug }, select: { id: true } }) || await prisma.user.findUnique({ where: { username: body.slug }, select: { id: true } });
      if (taken && (!s.lpId || (taken as any).id !== s.lpId)) return res.status(400).json({ error: 'このURLは既に使われています' });
    }
    if (body.proposalId) {
      const p = await prisma.pageStructureSuggestion.findFirst({ where: { id: body.proposalId, sessionId: s.id }, select: { id: true } });
      if (!p) return res.status(404).json({ error: '構成案がありません' });
    }
    const prev = (s.selections ?? {}) as Record<string, unknown>;
    const images = { ...((prev.images as Record<string, string>) ?? {}), ...(body.images ?? {}) };
    // 候補の状態も更新（選ばれたものは selected、同じセクションの他は candidate に戻す）
    for (const [sectionId, imageId] of Object.entries(body.images ?? {})) {
      await prisma.pageImageSuggestion.updateMany({ where: { sessionId: s.id, sectionId, status: 'selected' }, data: { status: 'candidate' } });
      if (imageId !== 'none') await prisma.pageImageSuggestion.updateMany({ where: { id: imageId, sessionId: s.id }, data: { status: 'selected' } });
    }
    const updated = await prisma.pageIntelligenceSession.update({ where: { id: s.id }, data: {
      ...(body.proposalId ? { selectedProposalId: body.proposalId } : {}),
      selections: { ...prev, images, ...(body.businessName !== undefined ? { businessName: body.businessName } : {}), ...(body.slug !== undefined ? { slug: body.slug } : {}), ...(body.lineAddUrl !== undefined ? { lineAddUrl: body.lineAddUrl } : {}) } as any
    } });
    if (body.proposalId) {
      await prisma.pageStructureSuggestion.updateMany({ where: { sessionId: s.id, status: 'selected' }, data: { status: 'proposed' } });
      await prisma.pageStructureSuggestion.update({ where: { id: body.proposalId }, data: { status: 'selected' } });
    }
    res.json({ session: updated });
  } catch (e) { bad(res, e, '保存できませんでした'); }
});

router.get('/sessions/:id/check', authenticate, async (req: AuthRequest, res) => {
  try {
    const s = await ownSession(req.user!.id, String(req.params.id));
    if (!s) return res.status(404).json({ error: 'セッションがありません' });
    res.json({ checks: await checkSession(s.id) });
  } catch (e) { bad(res, e, 'チェックできませんでした'); }
});

router.post('/sessions/:id/apply', authenticate, metered('page_intelligence', false), async (req: AuthRequest, res) => {
  try {
    const s = await ownSession(req.user!.id, String(req.params.id));
    if (!s) return res.status(404).json({ error: 'セッションがありません' });
    const body = ApplyBody.parse(req.body ?? {});
    if (!s.lpId) {
      if (!body.slug || !/^[a-z0-9-]{3,40}$/.test(body.slug)) return res.status(400).json({ error: '公開用URLは半角英数字とハイフンで3〜40文字にしてください' });
      if (RESERVED_SLUGS.includes(body.slug)) return res.status(400).json({ error: 'このURLはシステムで使用しているため選べません' });
      if (await prisma.user.findUnique({ where: { username: body.slug }, select: { id: true } })) return res.status(400).json({ error: 'このURLは既に使われています' });
      await assertInviteForPageCreate(req.user!.id, body.inviteCode);
    }
    const lineAddUrl = body.lineAddUrl && /^https:\/\/(lin\.ee|line\.me)\//.test(body.lineAddUrl) ? body.lineAddUrl : null;
    const out = await applySession(s.id, req.user!.id, { businessName: body.businessName, slug: body.slug, purpose: body.purpose, lineAddUrl });
    res.json(out);
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(400).json({ error: 'このURLは既に使われています' });
    if (e instanceof InviteRequiredError) return res.status(403).json({ error: e.message, code: e.code });
    bad(res, e, '反映できませんでした');
  }
});

router.get('/sessions/:id', authenticate, async (req: AuthRequest, res) => {
  const s = await prisma.pageIntelligenceSession.findFirst({
    where: { id: String(req.params.id), userId: req.user!.id },
    include: {
      researchSnapshot: true,
      proposals: { orderBy: { createdAt: 'asc' } },
      images: { orderBy: { createdAt: 'asc' }, select: IMAGE_SELECT }
    }
  });
  if (!s) return res.status(404).json({ error: 'セッションがありません' });
  res.json({ session: s });
});

router.get('/sessions', authenticate, async (req: AuthRequest, res) => {
  const sessions = await prisma.pageIntelligenceSession.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, industry: true, pageGoal: true, status: true, lpId: true, createdAt: true } });
  res.json({ sessions });
});

// プレビュー（iframe から読む。トークンは推測できない値で、画像バイナリ以外の個人情報は含まない）
router.get('/preview/:token', async (req, res) => {
  const payload = await previewPayload(String(req.params.token), typeof req.query.proposal === 'string' ? req.query.proposal : null);
  if (!payload) return res.status(404).json({ error: 'Not found' });
  res.set('Cache-Control', 'no-store');
  res.json(payload);
});

router.get('/images/:id', async (req, res) => {
  const row = await prisma.pageImageSuggestion.findUnique({ where: { id: String(req.params.id) }, select: { data: true, mimeType: true } });
  if (!row?.data) return res.status(404).end();
  res.set('Content-Type', row.mimeType || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(row.data));
});

// ユーザーの写真（Photo）は本来ダッシュボード専用だが、本人が候補として選んだものだけ公開ページから読めるようにする
router.get('/photos/:photoId', async (req, res) => {
  const photoId = String(req.params.photoId);
  const ref = await prisma.pageImageSuggestion.findFirst({ where: { uploadId: photoId, status: { in: ['selected', 'applied'] } }, select: { id: true } });
  if (!ref) return res.status(404).end();
  const photo = await prisma.photo.findUnique({ where: { id: photoId }, select: { original: true, originalType: true } });
  if (!photo) return res.status(404).end();
  res.set('Content-Type', photo.originalType);
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(photo.original));
});

export default router;
