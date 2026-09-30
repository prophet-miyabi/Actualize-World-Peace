import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';

const router = Router();

// 店主がアップロードした実物の写真・ロゴの管理（Photoモデル）。
// AIによる補正（enhanced）は別対応。ここではオリジナル画像のアップロード・並び替え・
// ロゴ指定・削除のみを扱う（ダッシュボードでの管理専用。公開LPへの組み込みは別対応）
const MAX_PHOTOS_PER_LP = 20;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;

async function resolveOwnedLp(userId: string, lpId: unknown) {
  const id = typeof lpId === 'string' && lpId ? lpId : undefined;
  if (id) return prisma.landingPage.findFirst({ where: { id, userId } });
  return prisma.landingPage.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

function publicPhoto(p: { id: string; isLogo: boolean; position: number; originalType: string; enhanceStatus: string | null; createdAt: Date }) {
  return { id: p.id, isLogo: p.isLogo, position: p.position, originalType: p.originalType, enhanceStatus: p.enhanceStatus, createdAt: p.createdAt };
}

router.get('/', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveOwnedLp(req.user!.id, req.query.lpId);
  if (!lp) return res.status(404).json({ error: 'LPが見つかりません' });
  const photos = await prisma.photo.findMany({
    where: { lpId: lp.id },
    orderBy: { position: 'asc' },
    select: { id: true, isLogo: true, position: true, originalType: true, enhanceStatus: true, createdAt: true }
  });
  res.json({ photos });
});

// アップロードはJSON+base64（data URL）で受け取る。multipart用の新しい依存関係を増やさないため
router.post('/', authenticate, async (req: AuthRequest, res) => {
  const lp = await resolveOwnedLp(req.user!.id, req.body.lpId);
  if (!lp) return res.status(404).json({ error: 'LPが見つかりません' });

  const { dataUrl, isLogo } = req.body as { dataUrl?: string; isLogo?: boolean };
  const match = DATA_URL_RE.exec(dataUrl || '');
  if (!match) return res.status(400).json({ error: '対応していない画像形式です（JPEG/PNG/WebPのみ）' });

  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) return res.status(400).json({ error: '画像サイズは8MBまでにしてください' });

  const count = await prisma.photo.count({ where: { lpId: lp.id } });
  if (count >= MAX_PHOTOS_PER_LP) return res.status(400).json({ error: `写真は${MAX_PHOTOS_PER_LP}枚まで登録できます` });

  if (isLogo) {
    // ロゴは常に1枚だけ。新しいロゴを設定したら、既存のロゴ指定は自動的に解除する
    await prisma.photo.updateMany({ where: { lpId: lp.id, isLogo: true }, data: { isLogo: false } });
  }

  const photo = await prisma.photo.create({
    data: { lpId: lp.id, original: buffer, originalType: mimeType, isLogo: !!isLogo, position: count }
  });
  res.status(201).json({ photo: publicPhoto(photo) });
});

// 画像本体。本人確認つき（ダッシュボードのプレビュー専用。JWTはAuthorizationヘッダーで送るため、
// 素の<img src>では読み込めない前提で、フロント側はfetch+Blob URLで表示する）
router.get('/:id/image', authenticate, async (req: AuthRequest, res) => {
  const photo = await prisma.photo.findFirst({
    where: { id: String(req.params.id), lp: { userId: req.user!.id } },
    select: { original: true, originalType: true }
  });
  if (!photo) return res.status(404).end();
  res.set('Content-Type', photo.originalType);
  res.set('Cache-Control', 'private, max-age=3600');
  res.send(Buffer.from(photo.original));
});

router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  const existing = await prisma.photo.findFirst({ where: { id: String(req.params.id), lp: { userId: req.user!.id } } });
  if (!existing) return res.status(404).json({ error: '見つかりません' });

  const { isLogo, position } = req.body as { isLogo?: boolean; position?: number };
  if (isLogo) {
    await prisma.photo.updateMany({ where: { lpId: existing.lpId, isLogo: true }, data: { isLogo: false } });
  }
  const photo = await prisma.photo.update({
    where: { id: existing.id },
    data: { isLogo: isLogo ?? existing.isLogo, position: position ?? existing.position }
  });
  res.json({ photo: publicPhoto(photo) });
});

router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  const existing = await prisma.photo.findFirst({ where: { id: String(req.params.id), lp: { userId: req.user!.id } } });
  if (!existing) return res.status(404).json({ error: '見つかりません' });
  await prisma.photo.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

export default router;
