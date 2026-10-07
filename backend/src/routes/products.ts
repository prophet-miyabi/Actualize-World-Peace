import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';

// 商品カタログ: ページに商品を並べ、購入は持ち主のネットショップ（BASE・STORES など）へ案内する。
// AWPは代金を預からない（決済・特定商取引法の表示は各ショップ側で行われる）。
// 購入リンクは、フィッシングサイトへの誘導を防ぐため、よく使われるショップのhttps URLだけを許可する
const router = Router();

const MAX_PRODUCTS = 50;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;
export const SHOP_HOSTS = [
  'base.shop', 'thebase.in', 'thebase.com', 'base.ec', 'stores.jp', 'myshopify.com', 'minne.com', 'creema.jp', 'booth.pm',
  'mercari-shops.com', 'jp.mercari.com', 'amazon.co.jp', 'rakuten.co.jp', 'item.rakuten.co.jp', 'shopping.yahoo.co.jp', 'suzuri.jp', 'pixiv.net', 'note.com', 'peatix.com'
];

export function validateBuyUrl(raw: unknown): string | null | 'invalid' {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) return 'invalid';
    const host = u.hostname.toLowerCase();
    return SHOP_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? u.toString() : 'invalid';
  } catch {
    return 'invalid';
  }
}

async function ownLp(userId: string, lpId: unknown) {
  const id = typeof lpId === 'string' && lpId ? lpId : undefined;
  return prisma.landingPage.findFirst({ where: id ? { id, userId } : { userId }, orderBy: { createdAt: 'asc' } });
}

const fields = { id: true, name: true, priceYen: true, priceNote: true, description: true, buyUrl: true, soldOut: true, sortOrder: true, imageType: true, updatedAt: true } as const;
export function publicProduct(p: { id: string; name: string; priceYen: number | null; priceNote: string | null; description: string | null; buyUrl: string | null; soldOut: boolean; imageType: string | null; updatedAt: Date }) {
  return {
    id: p.id, name: p.name, priceYen: p.priceYen, priceNote: p.priceNote, description: p.description, buyUrl: p.buyUrl, soldOut: p.soldOut,
    image: p.imageType ? `/api/products/${p.id}/image?v=${p.updatedAt.getTime()}` : null
  };
}

function parse(body: any): { data?: any; error?: string } {
  const name = String(body?.name ?? '').trim().slice(0, 60);
  if (!name) return { error: '商品名を入力してください' };
  const priceRaw = body?.priceYen;
  const priceYen = priceRaw === '' || priceRaw === null || priceRaw === undefined ? null : Number(priceRaw);
  if (priceYen !== null && (!Number.isInteger(priceYen) || priceYen < 0 || priceYen > 100_000_000)) return { error: '価格は0以上の整数（円）で入力してください' };
  const buyUrl = validateBuyUrl(body?.buyUrl);
  if (buyUrl === 'invalid') return { error: '購入リンクは、BASE・STORES・Shopify・minne・Creema・BOOTH などのショップの https:// から始まるURLにしてください' };
  const data: any = {
    name, priceYen, buyUrl,
    priceNote: String(body?.priceNote ?? '').trim().slice(0, 30) || null,
    description: String(body?.description ?? '').trim().slice(0, 300) || null,
    soldOut: !!body?.soldOut,
    sortOrder: Number.isInteger(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0
  };
  if (body?.imageDataUrl === null) {
    data.image = null;
    data.imageType = null;
  } else if (typeof body?.imageDataUrl === 'string' && body.imageDataUrl) {
    const m = DATA_URL_RE.exec(body.imageDataUrl);
    if (!m) return { error: '画像はJPEG・PNG・WebPにしてください' };
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) return { error: '画像は3MBまでにしてください' };
    data.image = buf;
    data.imageType = m[1];
  }
  return { data };
}

router.get('/:id/image', async (req, res) => {
  const p = await prisma.product.findUnique({ where: { id: String(req.params.id) }, select: { image: true, imageType: true, lp: { select: { hidden: true } } } });
  if (!p?.image || p.lp.hidden) return res.status(404).end();
  res.set('Content-Type', p.imageType || 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(p.image));
});

router.get('/mine', authenticate, async (req: AuthRequest, res) => {
  const lp = await ownLp(req.user!.id, req.query.lpId);
  if (!lp) return res.json({ page: null, products: [] });
  const products = await prisma.product.findMany({ where: { lpId: lp.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: fields });
  res.json({ page: { id: lp.id, slug: lp.slug }, products: products.map(publicProduct), shopHosts: SHOP_HOSTS });
});

router.post('/mine', authenticate, async (req: AuthRequest, res) => {
  const lp = await ownLp(req.user!.id, req.body?.lpId);
  if (!lp) return res.status(400).json({ error: '先にページを作成してください' });
  if ((await prisma.product.count({ where: { lpId: lp.id } })) >= MAX_PRODUCTS) return res.status(400).json({ error: `商品は${MAX_PRODUCTS}個まで登録できます` });
  const { data, error } = parse(req.body);
  if (error) return res.status(400).json({ error });
  const p = await prisma.product.create({ data: { ...data, lpId: lp.id }, select: fields });
  res.status(201).json({ product: publicProduct(p) });
});

router.put('/mine/:id', authenticate, async (req: AuthRequest, res) => {
  const existing = await prisma.product.findFirst({ where: { id: String(req.params.id), lp: { userId: req.user!.id } } });
  if (!existing) return res.status(404).json({ error: '見つかりません' });
  const { data, error } = parse(req.body);
  if (error) return res.status(400).json({ error });
  const p = await prisma.product.update({ where: { id: existing.id }, data, select: fields });
  res.json({ product: publicProduct(p) });
});

router.delete('/mine/:id', authenticate, async (req: AuthRequest, res) => {
  const existing = await prisma.product.findFirst({ where: { id: String(req.params.id), lp: { userId: req.user!.id } } });
  if (!existing) return res.status(404).json({ error: '見つかりません' });
  await prisma.product.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

export default router;
