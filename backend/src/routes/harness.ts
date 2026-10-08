import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { isAdminUser } from '../middlewares/admin';
import { refundHarnessCash } from './wallet';

// Harness（L Harness / X Harness / IG Harness）の導入支援。
// ユーザーは「導入（無料）」と有料の追加機能を選んで申し込み、運営者が管理画面で対応する。
// 決済方法は後から追加する（当面は申し込みと支払い状況の管理のみ）。
const router = Router();

const HARNESSES = ['line', 'x', 'instagram'] as const;
const ORDER_STATUSES = ['requested', 'in_progress', 'done', 'canceled'];
const PAYMENT_STATUSES = ['unpaid', 'not_required', 'paid', 'refunded'];
const MAX_ITEMS_PER_ORDER = 10;

async function requireAdmin(req: AuthRequest, res: any): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!user?.isAdmin) {
    res.status(403).json({ error: '管理者のみ利用できます' });
    return false;
  }
  return true;
}

// 料金が決まっていて有効なメニューだけをユーザーに見せる
const visible = { enabled: true, priceYen: { not: null } } as const;

router.get('/catalog', authenticate, async (_req, res) => {
  const addons = await prisma.harnessAddon.findMany({
    where: visible,
    orderBy: [{ harness: 'asc' }, { isInstall: 'desc' }, { sortOrder: 'asc' }],
    select: { id: true, key: true, harness: true, name: true, description: true, priceYen: true, isInstall: true }
  });
  res.json({ addons });
});

router.get('/orders/mine', authenticate, async (req: AuthRequest, res) => {
  const orders = await prisma.harnessOrder.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ orders });
});

// 申し込み。金額はサーバー側のメニューから計算する（画面から送られた金額は使わない）
router.post('/orders', authenticate, async (req: AuthRequest, res) => {
  const ids = Array.isArray(req.body?.addonIds) ? [...new Set(req.body.addonIds.map(String))] : [];
  if (ids.length === 0) return res.status(400).json({ error: '導入したいものを1つ以上選んでください。' });
  if (ids.length > MAX_ITEMS_PER_ORDER) return res.status(400).json({ error: `一度に申し込めるのは${MAX_ITEMS_PER_ORDER}個までです。` });

  const addons = await prisma.harnessAddon.findMany({ where: { id: { in: ids as string[] }, ...visible } });
  if (addons.length !== ids.length) return res.status(400).json({ error: '選べないメニューが含まれています。画面を再読み込みしてください。' });

  const items = addons.map((a) => ({ addonId: a.id, key: a.key, harness: a.harness, name: a.name, priceYen: a.priceYen! }));
  const totalYen = items.reduce((sum, i) => sum + i.priceYen, 0);
  const note = String(req.body?.note ?? '').trim().slice(0, 1000) || null;

  const order = await prisma.harnessOrder.create({
    // 管理者（運営者自身）の申し込みは支払い不要にする（テストと実際の利用のため）
    data: { userId: req.user!.id, items, totalYen, note, paymentStatus: totalYen > 0 && !(await isAdminUser(req.user!.id)) ? 'unpaid' : 'not_required' }
  });
  res.status(201).json({ order });
});

// ユーザー自身による取り消し（運営者が対応を始める前だけ）
router.post('/orders/:id/cancel', authenticate, async (req: AuthRequest, res) => {
  const order = await prisma.harnessOrder.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (!order) return res.status(404).json({ error: '見つかりません' });
  if (order.status !== 'requested') return res.status(400).json({ error: '対応が始まっているため、取り消しは運営者にご連絡ください。' });
  await prisma.harnessOrder.update({ where: { id: order.id }, data: { status: 'canceled' } });
  // キャッシュで支払い済みなら、キャッシュに戻す
  await refundHarnessCash(order.id, req.user!.id);
  res.json({ order: await prisma.harnessOrder.findUnique({ where: { id: order.id } }) });
});

// ---- 運営者（管理者）向け ----

function parseAddon(body: any, existing?: { key: string }) {
  const key = existing?.key ?? String(body?.key || '').trim().toLowerCase();
  const harness = String(body?.harness || '');
  const name = String(body?.name || '').trim().slice(0, 60);
  const description = String(body?.description || '').trim().slice(0, 400);
  const rawPrice = body?.priceYen;
  const priceYen = rawPrice === null || rawPrice === '' || rawPrice === undefined ? null : Number(rawPrice);
  if (!/^[a-z0-9-]{2,50}$/.test(key)) return { error: 'キーは半角英小文字・数字・ハイフンで2〜50文字にしてください。' };
  if (!(HARNESSES as readonly string[]).includes(harness)) return { error: '対象（LINE / X / Instagram）を選んでください。' };
  if (!name || !description) return { error: '名前と説明は必須です。' };
  if (priceYen !== null && (!Number.isInteger(priceYen) || priceYen < 0 || priceYen > 10_000_000)) {
    return { error: '料金は0以上の整数（円）で入力してください。未定なら空欄にします。' };
  }
  return {
    data: {
      key,
      harness,
      name,
      description,
      priceYen,
      isInstall: !!body?.isInstall,
      enabled: !!body?.enabled,
      sortOrder: Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0
    }
  };
}

router.get('/admin/addons', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const addons = await prisma.harnessAddon.findMany({ orderBy: [{ harness: 'asc' }, { isInstall: 'desc' }, { sortOrder: 'asc' }] });
  res.json({ addons });
});

router.post('/admin/addons', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { data, error } = parseAddon(req.body);
  if (!data) return res.status(400).json({ error });
  try {
    res.status(201).json({ addon: await prisma.harnessAddon.create({ data }) });
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(400).json({ error: 'このキーは既に使われています。' });
    throw e;
  }
});

router.put('/admin/addons/:id', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const existing = await prisma.harnessAddon.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) return res.status(404).json({ error: '見つかりません' });
  const { data, error } = parseAddon({ ...existing, ...req.body }, existing);
  if (!data) return res.status(400).json({ error });
  res.json({ addon: await prisma.harnessAddon.update({ where: { id: existing.id }, data }) });
});

router.delete('/admin/addons/:id', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  await prisma.harnessAddon.deleteMany({ where: { id: String(req.params.id) } });
  res.json({ ok: true });
});

// 標準メニューのたたき台を追加する。料金は未設定・非表示で作るので、運営者が料金を決めて有効にするまでユーザーには出ない
const STANDARD_MENU = [
  { key: 'line-install', harness: 'line', isInstall: true, name: 'L Harness の導入', description: 'LINE公式アカウントの顧客管理・ステップ配信・予約フォームを使えるように、あなたのCloudflareに L Harness を設置します。' },
  { key: 'line-bot', harness: 'line', isInstall: false, name: 'LINE AIボットの導入', description: 'お客様からのLINEのメッセージに、AIが自動で返信するボットを設定します。' },
  { key: 'x-install', harness: 'x', isInstall: true, name: 'X Harness の導入', description: 'X（旧Twitter）の予約投稿・リサーチ・エンゲージメントを管理できるように、X Harness を設置します。' },
  { key: 'x-auto-posts', harness: 'x', isInstall: false, name: 'X投稿の自動作成', description: 'あなたの事業・活動に合わせた投稿をAIが作成し、予約投稿まで自動で行う仕組みを設定します。' },
  { key: 'x-auto-articles', harness: 'x', isInstall: false, name: '記事の自動作成', description: 'テーマに沿った長めの記事をAIが作成し、Xで発信できるようにする仕組みを設定します。' },
  { key: 'ig-install', harness: 'instagram', isInstall: true, name: 'IG Harness の導入', description: 'Instagramのコメント自動返信・DM自動化を使えるように、IG Harness を設置します。' },
  { key: 'ig-bot', harness: 'instagram', isInstall: false, name: 'Instagram自動返信ボットの導入', description: 'コメントへの自動返信やDMの自動送信を行うボットを設定します。' },
  { key: 'ig-auto-posts', harness: 'instagram', isInstall: false, name: 'Instagram投稿の自動作成', description: 'あなたの事業・活動に合わせた投稿文をAIが作成し、投稿を自動化する仕組みを設定します。' }
];

router.post('/admin/addons/seed', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  let created = 0;
  for (const [i, m] of STANDARD_MENU.entries()) {
    const exists = await prisma.harnessAddon.findUnique({ where: { key: m.key }, select: { id: true } });
    if (exists) continue;
    await prisma.harnessAddon.create({ data: { ...m, priceYen: null, enabled: false, sortOrder: i } });
    created++;
  }
  res.json({ created });
});

router.get('/admin/orders', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const orders = await prisma.harnessOrder.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { user: { select: { name: true, email: true } } }
  });
  res.json({ orders });
});

router.put('/admin/orders/:id', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const data: { status?: string; paymentStatus?: string } = {};
  if (req.body?.status !== undefined) {
    if (!ORDER_STATUSES.includes(req.body.status)) return res.status(400).json({ error: '状態が正しくありません' });
    data.status = req.body.status;
  }
  if (req.body?.paymentStatus !== undefined) {
    if (!PAYMENT_STATUSES.includes(req.body.paymentStatus)) return res.status(400).json({ error: '支払い状況が正しくありません' });
    data.paymentStatus = req.body.paymentStatus;
  }
  // 返金済みの状態は、実際の返金処理（下の取り消し時の逆仕訳）でだけ付ける
  if (data.paymentStatus === 'refunded') return res.status(400).json({ error: '返金は申し込みを「取り消し」にすると自動で行われます' });
  let order = await prisma.harnessOrder.update({ where: { id: String(req.params.id) }, data }).catch(() => null);
  if (!order) return res.status(404).json({ error: '見つかりません' });
  if (order.status === 'canceled' && order.paymentStatus === 'paid') {
    await refundHarnessCash(order.id, req.user!.id);
    order = await prisma.harnessOrder.findUnique({ where: { id: order.id } });
  }
  res.json({ order });
});

export default router;
