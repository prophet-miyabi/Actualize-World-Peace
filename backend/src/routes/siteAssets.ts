import { Router } from 'express';
import prisma from '../prisma';
import { generateImage } from '../ai/design';
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
  if (!process.env.GEMINI_API_KEY && !(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN)) {
    return res.status(400).json({ error: '画像生成AIが未設定です（CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN またはGEMINI_API_KEYを設定してください）。' });
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
