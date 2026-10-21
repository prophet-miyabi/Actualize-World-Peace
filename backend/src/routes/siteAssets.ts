import { Router } from 'express';
import prisma from '../prisma';
import { generateImage, imageProvider } from '../ai/design';
import { generateReelPost } from '../ai/reel';
import { runwayConfigured, RUNWAY_IMAGE_MODEL, RUNWAY_VIDEO_MODEL } from '../ai/runway';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { requireAdmin } from '../middlewares/admin';

const router = Router();

const KEY_RE = /^[a-z0-9_-]{1,60}$/;

// 管理者向け: 作成済みの装飾画像の一覧（画像本体は含めない。管理画面での一覧表示用）
router.get('/', authenticate, requireAdmin, async (_req, res) => {
  const assets = await prisma.siteAsset.findMany({
    select: { key: true, prompt: true, mimeType: true, updatedAt: true },
    orderBy: { key: 'asc' }
  });
  res.json({ assets });
});

// 管理者向け: 指示文からアプリ自体の装飾画像を1枚生成し、指定したキーで保存（上書き）する
router.post('/generate', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const key = String(req.body?.key || '').trim();
  const prompt = String(req.body?.prompt || '').trim();
  if (!KEY_RE.test(key)) return res.status(400).json({ error: 'キーは半角英数字・ハイフン・アンダースコアで60文字以内にしてください。' });
  if (!prompt) return res.status(400).json({ error: 'どんな画像にするか、指示文を入力してください。' });
  if (!imageProvider()) {
    return res.status(400).json({ error: '画像生成 intelligenceが未設定です（CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN またはGEMINI_API_KEYを設定してください）。' });
  }

  try {
    const image = await generateImage(prompt);
    await prisma.siteAsset.upsert({
      where: { key },
      update: { image: image.data, mimeType: image.mimeType, prompt },
      create: { key, image: image.data, mimeType: image.mimeType, prompt }
    });
    res.json({ ok: true, key, updatedAt: new Date().toISOString() });
  } catch (e: any) {
    console.error('site asset generation failed', key, e?.message);
    res.status(502).json({ error: `画像の生成に失敗しました: ${e?.message || e}` });
  }
});

// 管理者向け: いまどの画像生成が使われるか（運営者画面の表示用）
router.get('/provider', authenticate, requireAdmin, async (_req, res) => {
  res.json({ provider: imageProvider(), runway: runwayConfigured() ? { image: RUNWAY_IMAGE_MODEL(), video: RUNWAY_VIDEO_MODEL() } : null });
});

// 管理者向け: Runway でリール（縦動画）を作り、AWP公式（または指定ユーザー）の投稿として保存する
// body: { imagePrompt, motionPrompt?, body, duration?: 5|10, to?: 'official' | username }
router.post('/reel', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const imagePrompt = String(req.body?.imagePrompt || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!imagePrompt || !body) return res.status(400).json({ error: 'imagePrompt（画像の指示文・英語）と body（投稿文）を入力してください' });
  if (!runwayConfigured()) return res.status(503).json({ error: 'RUNWAYML_API_SECRET が未設定です（Render の環境変数に追加してください）' });
  try {
    const r = await generateReelPost({ imagePrompt, motionPrompt: String(req.body?.motionPrompt || ''), body, duration: req.body?.duration === 10 ? 10 : 5, to: typeof req.body?.to === 'string' ? req.body.to : 'official' });
    res.status(201).json(r);
  } catch (e: any) {
    console.error('reel generation failed', e?.message);
    res.status(502).json({ error: `動画の生成に失敗しました: ${e?.message || e}` });
  }
});

// 管理者向け: 装飾画像を削除し、既定の見た目（フロント側のフォールバック）に戻す
router.delete('/:key', authenticate, requireAdmin, async (req, res) => {
  await prisma.siteAsset.deleteMany({ where: { key: String(req.params.key) } });
  res.json({ ok: true });
});

// 公開用: フロントの<img>から直接参照する（キャッシュは短めにして、差し替え後すぐ反映されるようにする）
router.get('/:key', async (req, res) => {
  const asset = await prisma.siteAsset.findUnique({ where: { key: String(req.params.key) } });
  if (!asset) return res.status(404).end();
  res.set('Content-Type', asset.mimeType);
  res.set('Cache-Control', 'public, max-age=300');
  res.send(Buffer.from(asset.image));
});

export default router;
