import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { hitRateLimit } from '../lib/rateLimit';
import { isAdminUser } from '../middlewares/admin';
import { metered } from '../lib/aiUsage';
import { RESERVED_SLUGS } from './lp';
import { publicLp, runDesignJob, storedSections, type StoredSection } from '../ai/designJob';
import { FEATURES, getFeature } from '../features/catalog';
import { writeSection } from '../ai/sectionWriter';
import {
  emptyBrief, FACT_KEYS, FACT_META, GREETING, mergeTurn, PUBLISHABLE, runBuilderTurn, unsupportedClaims,
  type Brief, type ChatMessage, type FactKey
} from '../ai/builderAgent';

// 対話で作るページビルダー: 会話 → 事実の台帳（出どころ付き） → 本人の確認 → 公開。
// 公開に使うのは本人が「確定」した事実と既定値だけ。推測・不明の項目はページに出さない。
const router = Router();
router.use(authenticate);

const DAILY_TURNS = 80;

async function ownSession(req: AuthRequest) {
  return prisma.builderSession.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
}

function view(s: { id: string; messages: unknown; brief: unknown; status: string; lpId: string | null }) {
  return { id: s.id, messages: s.messages, brief: s.brief, status: s.status, lpId: s.lpId, meta: FACT_META };
}

router.get('/sessions/current', async (req: AuthRequest, res) => {
  const s = await prisma.builderSession.findFirst({ where: { userId: req.user!.id, status: 'active' }, orderBy: { updatedAt: 'desc' } });
  res.json({ session: s ? view(s) : null });
});

router.post('/sessions', async (req: AuthRequest, res) => {
  // 作りかけは1つだけ持つ（新しく始めたら古い作りかけは閉じる）
  await prisma.builderSession.updateMany({ where: { userId: req.user!.id, status: 'active' }, data: { status: 'abandoned' } });
  const s = await prisma.builderSession.create({
    data: { userId: req.user!.id, messages: [{ role: 'assistant', content: GREETING }], brief: emptyBrief() as any }
  });
  res.status(201).json({ session: view(s) });
});

router.post('/sessions/:id/messages', metered('builder'), async (req: AuthRequest, res) => {
  const s = await ownSession(req);
  if (!s || s.status !== 'active') return res.status(404).json({ error: '見つかりません' });
  const text = String(req.body?.text ?? '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'メッセージを入力してね' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'AIが利用できないため、いまは対話で作れません。' });
  if (!(await isAdminUser(req.user!.id)) && hitRateLimit(`builder:${req.user!.id}`, DAILY_TURNS, 24 * 60 * 60 * 1000)) {
    return res.status(429).json({ error: '今日はたくさん話したね！続きは明日できるよ。' });
  }

  const history = [...(s.messages as ChatMessage[]), { role: 'user' as const, content: text }];
  let brief = s.brief as unknown as Brief;
  let reply: string;
  try {
    const turn = await runBuilderTurn(history, brief);
    if (!turn) {
      reply = 'ごめんね、その内容ではページづくりをお手伝いできないみたい。別の内容で教えてくれる？';
    } else {
      brief = mergeTurn(brief, turn);
      reply = turn.reply.trim() || '教えてくれてありがとう！';
    }
  } catch (e: any) {
    console.error('builder turn failed', e?.message);
    return res.status(502).json({ error: 'AIの応答に失敗しました。もう一度送ってみてね。' });
  }
  const updated = await prisma.builderSession.update({
    where: { id: s.id },
    data: { messages: [...history, { role: 'assistant', content: reply }] as any, brief: brief as any }
  });
  res.json({ session: view(updated) });
});

// 確認画面での操作: 項目の確定・修正・削除、キャッチコピーの修正・確定、まとめて確定
router.put('/sessions/:id/brief', async (req: AuthRequest, res) => {
  const s = await ownSession(req);
  if (!s || s.status !== 'active') return res.status(404).json({ error: '見つかりません' });
  const brief = s.brief as unknown as Brief;
  const action = String(req.body?.action);

  if (action === 'fact') {
    const key = req.body?.key as FactKey;
    if (!FACT_KEYS.includes(key)) return res.status(400).json({ error: '項目が正しくありません' });
    const value = String(req.body?.value ?? '').trim().slice(0, 300);
    brief.facts = brief.facts.filter((f) => f.key !== key);
    // 本人が自分で入力・修正した値は、その場で確定扱いにする。空にした項目は「なし」として外す
    if (value) brief.facts.push({ key, value, status: 'confirmed' });
    brief.facts.sort((a, b) => FACT_KEYS.indexOf(a.key) - FACT_KEYS.indexOf(b.key));
  } else if (action === 'purpose') {
    brief.purpose = { value: req.body?.value === 'creator' ? 'creator' : 'business', status: 'confirmed' };
  } else if (action === 'copy') {
    const heroTitle = String(req.body?.heroTitle ?? '').trim().slice(0, 60);
    const strengths = (Array.isArray(req.body?.strengths) ? req.body.strengths : []).map((x: unknown) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 3);
    if (!heroTitle) return res.status(400).json({ error: 'キャッチコピーを入力してね' });
    brief.copy = { heroTitle, strengths, status: 'confirmed' };
  } else if (action === 'confirm_all') {
    // 確認画面で一覧を見たうえで「全部OK」を押したときだけ、表示中の内容をまとめて確定する
    brief.facts = brief.facts.map((f) => (f.value && (f.status === 'provided' || f.status === 'assumed') ? { ...f, status: 'confirmed' } : f));
    if (brief.purpose.status !== 'default') brief.purpose = { ...brief.purpose, status: 'confirmed' };
    if (brief.copy) brief.copy = { ...brief.copy, status: 'confirmed' };
  } else {
    return res.status(400).json({ error: '操作が正しくありません' });
  }
  const updated = await prisma.builderSession.update({ where: { id: s.id }, data: { brief: brief as any } });
  res.json({ session: view(updated) });
});

router.post('/sessions/:id/publish', metered('builder_publish', false), async (req: AuthRequest, res) => {
  const s = await ownSession(req);
  if (!s || s.status !== 'active') return res.status(404).json({ error: '見つかりません' });
  const brief = s.brief as unknown as Brief;
  const ok = (key: FactKey) => brief.facts.find((f) => f.key === key && f.value && PUBLISHABLE.includes(f.status))?.value || '';

  const missing = FACT_KEYS.filter((k) => FACT_META[k].required && !ok(k)).map((k) => FACT_META[k].label);
  if (missing.length) return res.status(400).json({ error: `「${missing.join('」「')}」を確定してね` });
  if (!brief.copy || brief.copy.status !== 'confirmed') return res.status(400).json({ error: 'キャッチコピーと強みを確定してね' });

  // 確定した事実にない数字・強い表現がコピーに入っていたら公開しない
  const factsText = FACT_KEYS.map(ok).join('\n');
  const claims = unsupportedClaims([brief.copy.heroTitle, ...brief.copy.strengths].join('\n'), factsText);
  if (claims.length) {
    return res.status(400).json({ error: `キャッチコピー・強みの「${claims.join('」「')}」は、確定した情報にない表現です。直してから公開してね（事実と違う表示は法律で禁止されています）`, claims });
  }

  const slug = String(req.body?.slug ?? '').trim().toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ error: 'URLは半角の英小文字・数字・ハイフンで3〜40文字にしてね' });
  if (RESERVED_SLUGS.includes(slug)) return res.status(400).json({ error: 'このURLはシステムで使用しているため選べません' });
  if (await prisma.user.findUnique({ where: { username: slug }, select: { id: true } })) {
    return res.status(400).json({ error: 'このURLは既に使われています' });
  }

  const publishedBrief = {
    ...brief,
    // 公開に使わなかった項目（推測・不明）は「未確定」として残し、あとで本人が確定できるようにする
    facts: brief.facts.map((f) => (PUBLISHABLE.includes(f.status) ? f : { ...f, status: f.value ? f.status : 'unconfirmed' }))
  };
  let lp;
  try {
    lp = await prisma.landingPage.create({
      data: {
        userId: req.user!.id,
        slug,
        businessName: ok('businessName').slice(0, 60),
        heroTitle: brief.copy.heroTitle,
        strengths: brief.copy.strengths,
        socialProof: ok('achievements') || null,
        scarcityOffer: ok('offer') || null,
        purpose: brief.purpose.value,
        brief: publishedBrief as any
      }
    });
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(400).json({ error: 'このURLは既に使われています' });
    throw e;
  }
  await prisma.builderSession.update({ where: { id: s.id }, data: { status: 'published', lpId: lp.id } });

  // デザインと、確定した料金・営業時間からのセクション作成は時間がかかるため、裏で進める
  const description = [ok('what'), ok('target'), ok('area')].filter(Boolean).join(' / ').slice(0, 300);
  void runDesignJob(lp.id, description).catch((e) => console.error('design job failed', lp.id, e?.message));
  void buildSections(lp.id, { price: ok('price'), hours: ok('hours'), area: ok('area'), contact: ok('contact') })
    .catch((e) => console.error('builder sections failed', lp.id, e?.message));

  res.status(201).json({ lp: publicLp(lp) });
});

// 確定済みの料金 → 「メニュー・料金表」、地域と営業時間 → 「アクセス・営業時間」、問い合わせ方法 → 「よくある質問」
async function buildSections(lpId: string, f: { price: string; hours: string; area: string; contact: string }) {
  const plans: { id: string; inputs: Record<string, string> }[] = [];
  if (f.price) plans.push({ id: 'menu', inputs: { items: f.price } });
  if (f.area && f.hours) plans.push({ id: 'access', inputs: { address: f.area, hours: f.hours } });
  if (f.contact) plans.push({ id: 'faq', inputs: { facts: `予約・お問い合わせ方法: ${f.contact}${f.hours ? `\n営業時間: ${f.hours}` : ''}` } });
  for (const plan of plans) {
    const feature = getFeature(plan.id);
    if (!feature) continue;
    const lp = await prisma.landingPage.findUnique({ where: { id: lpId } });
    if (!lp) return;
    const written = await writeSection(feature, { businessName: lp.businessName, heroTitle: lp.heroTitle, strengths: lp.strengths }, plan.inputs);
    const section: StoredSection = { feature: feature.id, content: written.content, inputs: plan.inputs, promptBy: written.promptBy, updatedAt: new Date().toISOString() };
    const order = FEATURES.map((x) => x.id);
    const sections = [...storedSections(lp).filter((x) => x.feature !== feature.id), section].sort((a, b) => order.indexOf(a.feature) - order.indexOf(b.feature));
    await prisma.landingPage.update({ where: { id: lpId }, data: { sections: sections as any } });
  }
}

export default router;
