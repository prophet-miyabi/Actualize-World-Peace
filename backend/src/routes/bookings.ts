import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { hitRateLimit } from '../lib/rateLimit';
import { isAdminUser } from '../middlewares/admin';
import { notifyUser } from '../lib/push';

// 予約リクエスト: 訪問者が希望日時と連絡先を送り、持ち主が「確定」「お断り」を返す。
// 決済は扱わない。訪問者は受付番号で状況を確認できる（連絡先などは確認画面に出さない）
const router = Router();

const DAILY_PER_PAGE = 50;
const RETENTION_DAYS = 365;
const STATUSES = ['requested', 'confirmed', 'declined', 'canceled'];
export type BookingConfig = { menus: { name: string; note: string }[]; note: string; leadDays: number; maxDays: number };

export function normalizeBookingConfig(raw: any): BookingConfig {
  const menus = (Array.isArray(raw?.menus) ? raw.menus : [])
    .map((m: any) => ({ name: String(m?.name ?? '').trim().slice(0, 40), note: String(m?.note ?? '').trim().slice(0, 80) }))
    .filter((m: { name: string }) => m.name)
    .slice(0, 20);
  const int = (v: unknown, min: number, max: number, d: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : d;
  };
  return { menus, note: String(raw?.note ?? '').trim().slice(0, 300), leadDays: int(raw?.leadDays, 0, 30, 1), maxDays: int(raw?.maxDays, 1, 180, 60) };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-() ]{10,16}$/;

// ---- 訪問者向け ----

router.post('/:slug', async (req, res) => {
  const lp = await prisma.landingPage.findUnique({
    where: { slug: String(req.params.slug) },
    select: { id: true, userId: true, businessName: true, bookingEnabled: true, bookingConfig: true, hidden: true }
  });
  if (!lp || lp.hidden || !lp.bookingEnabled) return res.status(404).json({ error: 'Not found' });
  // ボットよけ: 画面には見えない入力欄に値が入っていたら、受け付けたふりをして保存しない
  if (req.body?.website) return res.status(201).json({ code: 'ok' });

  const config = normalizeBookingConfig(lp.bookingConfig);
  const name = String(req.body?.name ?? '').trim().slice(0, 40);
  const contact = String(req.body?.contact ?? '').trim().slice(0, 100);
  const message = String(req.body?.message ?? '').trim().slice(0, 500) || null;
  const menu = config.menus.find((m) => m.name === req.body?.menu)?.name ?? null;
  const requestedAt = new Date(String(req.body?.requestedAt ?? ''));

  if (!name) return res.status(400).json({ error: 'お名前を入力してください' });
  if (!EMAIL_RE.test(contact) && !PHONE_RE.test(contact)) return res.status(400).json({ error: 'メールアドレスか電話番号を入力してください' });
  if (config.menus.length && !menu) return res.status(400).json({ error: 'メニューを選んでください' });
  if (Number.isNaN(requestedAt.getTime())) return res.status(400).json({ error: '希望日時を選んでください' });
  const now = Date.now();
  if (requestedAt.getTime() < now + config.leadDays * 86_400_000 - 3600_000 || requestedAt.getTime() > now + config.maxDays * 86_400_000) {
    return res.status(400).json({ error: `希望日時は${config.leadDays ? `${config.leadDays}日後` : '今'}から${config.maxDays}日後までで選んでください` });
  }
  if (!req.body?.agree) return res.status(400).json({ error: '個人情報の取り扱いへの同意が必要です' });
  if (!(await isAdminUser(lp.userId)) && hitRateLimit(`booking:${lp.id}`, DAILY_PER_PAGE, 24 * 3600_000)) return res.status(429).json({ error: 'ただいま予約リクエストが混み合っています。時間をおいてお試しください。' });

  const code = crypto.randomBytes(9).toString('base64url');
  await prisma.booking.create({ data: { lpId: lp.id, code, menu, requestedAt, name, contact, message } });
  void prisma.booking.deleteMany({ where: { lpId: lp.id, requestedAt: { lt: new Date(now - RETENTION_DAYS * 86_400_000) } } }).catch(() => {});
  void notifyUser(lp.userId, '新しい予約リクエスト', `${name}さん・${requestedAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}${menu ? `・${menu}` : ''}`, { type: 'booking' });
  res.status(201).json({ code });
});

// 受付番号で状況を確認（連絡先・お名前は返さない）
router.get('/status/:code', async (req, res) => {
  const b = await prisma.booking.findUnique({
    where: { code: String(req.params.code) },
    select: { menu: true, requestedAt: true, status: true, ownerNote: true, createdAt: true, lp: { select: { slug: true, businessName: true } } }
  });
  if (!b) return res.status(404).json({ error: '見つかりません' });
  res.json({ booking: b });
});

// 訪問者による取り消し（確定前・確定後どちらも可。持ち主に通知する）
router.post('/status/:code/cancel', async (req, res) => {
  const b = await prisma.booking.findUnique({ where: { code: String(req.params.code) }, include: { lp: { select: { userId: true } } } });
  if (!b) return res.status(404).json({ error: '見つかりません' });
  if (b.status === 'canceled' || b.status === 'declined') return res.status(400).json({ error: 'この予約リクエストはすでに終了しています' });
  await prisma.booking.update({ where: { id: b.id }, data: { status: 'canceled' } });
  void notifyUser(b.lp.userId, '予約リクエストが取り消されました', `${b.name}さん・${b.requestedAt.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`, { type: 'booking' });
  res.json({ ok: true });
});

// ---- 持ち主向け ----

async function ownLp(userId: string, lpId: unknown) {
  const id = typeof lpId === 'string' && lpId ? lpId : undefined;
  return prisma.landingPage.findFirst({ where: id ? { id, userId } : { userId }, orderBy: { createdAt: 'asc' } });
}

router.get('/mine/list', authenticate, async (req: AuthRequest, res) => {
  const lp = await ownLp(req.user!.id, req.query.lpId);
  if (!lp) return res.json({ page: null, bookings: [] });
  const bookings = await prisma.booking.findMany({
    where: { lpId: lp.id }, orderBy: [{ requestedAt: 'asc' }], take: 300,
    select: { id: true, menu: true, requestedAt: true, name: true, contact: true, message: true, status: true, ownerNote: true, createdAt: true }
  });
  res.json({
    page: { id: lp.id, slug: lp.slug, bookingEnabled: lp.bookingEnabled, bookingConfig: normalizeBookingConfig(lp.bookingConfig) },
    bookings
  });
});

router.put('/mine/settings', authenticate, async (req: AuthRequest, res) => {
  const lp = await ownLp(req.user!.id, req.body?.lpId);
  if (!lp) return res.status(404).json({ error: 'ページが見つかりません' });
  const config = normalizeBookingConfig(req.body?.config);
  const page = await prisma.landingPage.update({
    where: { id: lp.id }, data: { bookingEnabled: !!req.body?.enabled, bookingConfig: config as any }, select: { id: true, bookingEnabled: true, bookingConfig: true }
  });
  res.json({ page });
});

router.put('/mine/:id', authenticate, async (req: AuthRequest, res) => {
  const b = await prisma.booking.findFirst({ where: { id: String(req.params.id), lp: { userId: req.user!.id } } });
  if (!b) return res.status(404).json({ error: '見つかりません' });
  const status = String(req.body?.status ?? b.status);
  if (!STATUSES.includes(status)) return res.status(400).json({ error: '状態が正しくありません' });
  const booking = await prisma.booking.update({
    where: { id: b.id },
    data: { status, ownerNote: req.body?.ownerNote !== undefined ? String(req.body.ownerNote).trim().slice(0, 300) || null : undefined }
  });
  res.json({ booking });
});

router.delete('/mine/:id', authenticate, async (req: AuthRequest, res) => {
  const b = await prisma.booking.findFirst({ where: { id: String(req.params.id), lp: { userId: req.user!.id } } });
  if (!b) return res.status(404).json({ error: '見つかりません' });
  await prisma.booking.delete({ where: { id: b.id } });
  res.json({ ok: true });
});

export default router;
