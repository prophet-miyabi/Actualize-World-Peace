import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { hitRateLimit } from '../lib/rateLimit';
import { isAdminUser } from '../middlewares/admin';
import { notifyUser } from '../lib/push';
import { seal, open } from '../lib/secretBox';

// AWPの直接払いショップ（自前の注文・決済管理）。
// - 代金は購入者から出品者へ直接支払われる（銀行振込・店頭/手渡し）。AWPは代金を預からず、カード情報も扱わない
//   → 決済会社の手数料・AWPの販売手数料はかからない
// - AWPが行うのは、注文の受付・在庫・期限・状況の管理と、出品者の特定商取引法に基づく表記の掲示
// - 出品者は特定商取引法の表記をそろえないと販売を始められない
const router = Router();

const DAY_MS = 86_400_000;
const RETENTION_DAYS = 400;
const DAILY_ORDERS_PER_PAGE = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-() ]{10,16}$/;

type Legal = {
  sellerName: string; responsible: string; address: string; phone: string; email: string;
  priceNote: string; extraFees: string; deliveryTime: string; returns: string; disclosureOnRequest: boolean;
};
type Bank = { bank: string; branch: string; type: string; number: string; holder: string };

const LEGAL_FIELDS: { key: keyof Legal; label: string; max: number }[] = [
  { key: 'sellerName', label: '販売事業者名（氏名または名称）', max: 80 },
  { key: 'responsible', label: '運営責任者', max: 60 },
  { key: 'address', label: '所在地', max: 200 },
  { key: 'phone', label: '電話番号', max: 30 },
  { key: 'email', label: 'メールアドレス', max: 120 },
  { key: 'priceNote', label: '販売価格について（例: 各商品ページに税込で表示）', max: 200 },
  { key: 'extraFees', label: '商品代金以外の必要料金（送料・振込手数料など）', max: 300 },
  { key: 'deliveryTime', label: '引き渡し時期（例: 入金確認後3営業日以内に発送）', max: 200 },
  { key: 'returns', label: '返品・キャンセルについて', max: 500 }
];

function normalizeLegal(raw: any): Legal {
  const out: any = {};
  for (const f of LEGAL_FIELDS) out[f.key] = String(raw?.[f.key] ?? '').trim().slice(0, f.max);
  out.disclosureOnRequest = !!raw?.disclosureOnRequest;
  return out;
}

// 販売を始めるための条件（足りないものの一覧）
function missingForSale(p: { legal: unknown; bankEnabled: boolean; bankEnc: string | null; inPersonEnabled: boolean }) {
  const legal = normalizeLegal(p.legal);
  const missing: string[] = [];
  for (const f of LEGAL_FIELDS) {
    if ((f.key === 'address' || f.key === 'phone') && legal.disclosureOnRequest) continue;
    if (!legal[f.key]) missing.push(f.label);
  }
  if (legal.email && !EMAIL_RE.test(legal.email)) missing.push('メールアドレスの形式');
  if (!p.bankEnabled && !p.inPersonEnabled) missing.push('支払い方法（銀行振込か店頭・手渡し）');
  if (p.bankEnabled && !p.bankEnc) missing.push('振込先の口座');
  return missing;
}

function code() {
  return crypto.randomBytes(9).toString('base64url');
}

// 期限切れの振込待ちを取り消して在庫を戻す。古い注文の個人情報は保存期間を過ぎたら削除する
export async function sweepOrders() {
  const expired = await prisma.order.findMany({ where: { status: 'awaiting_payment', expiresAt: { lt: new Date() } }, take: 200 });
  for (const o of expired) await cancelOrder(o.id, '支払い期限を過ぎたため自動で取り消しました');
  await prisma.order.deleteMany({ where: { status: { in: ['completed', 'canceled'] }, updatedAt: { lt: new Date(Date.now() - RETENTION_DAYS * DAY_MS) } } });
}

async function cancelOrder(orderId: string, note?: string) {
  await prisma.$transaction(async (db) => {
    const o = await db.order.findUnique({ where: { id: orderId } });
    if (!o || o.status === 'canceled' || o.status === 'completed' || o.status === 'shipped') return;
    for (const it of o.items as { productId: string; qty: number }[]) {
      await db.product.updateMany({ where: { id: it.productId, stock: { not: null } }, data: { stock: { increment: it.qty } } });
    }
    await db.order.update({ where: { id: o.id }, data: { status: 'canceled', sellerNote: note ?? o.sellerNote } });
  });
}

// ---- 出品者向け ----

router.get('/settings', authenticate, async (req: AuthRequest, res) => {
  const p = await prisma.sellerProfile.findUnique({ where: { userId: req.user!.id } });
  const bank: Bank | null = p?.bankEnc ? JSON.parse(open(p.bankEnc)) : null;
  res.json({
    profile: p ? { ...p, bankEnc: undefined, legal: normalizeLegal(p.legal) } : null,
    bank,
    fields: LEGAL_FIELDS,
    missing: p ? missingForSale(p) : missingForSale({ legal: {}, bankEnabled: false, bankEnc: null, inPersonEnabled: false })
  });
});

router.put('/settings', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const b = req.body ?? {};
  const legal = normalizeLegal(b.legal);
  let bankEnc: string | null | undefined;
  if (b.bank) {
    const f = (k: string, max: number) => String(b.bank?.[k] ?? '').trim().slice(0, max);
    const bank: Bank = { bank: f('bank', 40), branch: f('branch', 40), type: f('type', 10) || '普通', number: f('number', 10), holder: f('holder', 60) };
    if (bank.bank || bank.number) {
      if (!bank.bank || !bank.branch || !bank.holder || !/^\d{6,8}$/.test(bank.number)) return res.status(400).json({ error: '振込先は、銀行名・支店名・口座番号（数字6〜8桁）・名義をすべて入力してください' });
      bankEnc = seal(JSON.stringify(bank));
    } else bankEnc = null;
  }
  const int = (v: unknown, min: number, max: number, d: number | null) => {
    if (v === '' || v === null || v === undefined) return d;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : d;
  };
  const data: any = {
    legal,
    bankEnabled: !!b.bankEnabled,
    inPersonEnabled: !!b.inPersonEnabled,
    inPersonNote: String(b.inPersonNote ?? '').trim().slice(0, 200) || null,
    shippingFeeYen: int(b.shippingFeeYen, 0, 100_000, 0),
    freeShippingOverYen: int(b.freeShippingOverYen, 0, 10_000_000, null),
    paymentDays: int(b.paymentDays, 1, 30, 7),
    ...(bankEnc !== undefined ? { bankEnc } : {})
  };
  const existing = await prisma.sellerProfile.findUnique({ where: { userId } });
  const merged = { legal, bankEnabled: data.bankEnabled, inPersonEnabled: data.inPersonEnabled, bankEnc: bankEnc !== undefined ? bankEnc : existing?.bankEnc ?? null };
  const missing = missingForSale(merged);
  data.enabled = !!b.enabled && missing.length === 0;
  const p = await prisma.sellerProfile.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  // 販売をやめたら、ページの商品の「購入する」も止める
  if (!p.enabled) await prisma.product.updateMany({ where: { lp: { userId } }, data: { purchasable: false } });
  res.json({ enabled: p.enabled, missing });
});

router.get('/orders', authenticate, async (req: AuthRequest, res) => {
  await sweepOrders();
  const orders = await prisma.order.findMany({ where: { sellerId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 200, include: { lp: { select: { slug: true, businessName: true } } } });
  res.json({ orders });
});

// 出品者の操作: paid = 入金を確認 / shipped = 発送・引き渡し / completed = 完了 / cancel = 取り消し（在庫を戻す）
router.put('/orders/:id', authenticate, async (req: AuthRequest, res) => {
  const o = await prisma.order.findFirst({ where: { id: String(req.params.id), sellerId: req.user!.id } });
  if (!o) return res.status(404).json({ error: '見つかりません' });
  const action = String(req.body?.action);
  const note = req.body?.sellerNote !== undefined ? String(req.body.sellerNote).trim().slice(0, 300) || null : undefined;
  const flow: Record<string, { from: string[]; to: string; stamp?: 'paidAt' | 'shippedAt' }> = {
    paid: { from: ['awaiting_payment'], to: 'paid', stamp: 'paidAt' },
    shipped: { from: ['paid'], to: 'shipped', stamp: 'shippedAt' },
    completed: { from: ['shipped', 'paid'], to: 'completed' }
  };
  if (action === 'cancel') {
    if (!['awaiting_payment', 'paid'].includes(o.status)) return res.status(400).json({ error: 'この状態の注文は取り消せません' });
    await cancelOrder(o.id, note ?? '出品者が取り消しました');
  } else if (flow[action]) {
    if (!flow[action].from.includes(o.status)) return res.status(400).json({ error: 'この操作はいまの状態ではできません' });
    await prisma.order.update({
      where: { id: o.id },
      data: { status: flow[action].to, ...(flow[action].stamp ? { [flow[action].stamp!]: new Date() } : {}), ...(note !== undefined ? { sellerNote: note } : {}) }
    });
  } else if (note !== undefined) {
    await prisma.order.update({ where: { id: o.id }, data: { sellerNote: note } });
  } else {
    return res.status(400).json({ error: '操作が正しくありません' });
  }
  res.json({ order: await prisma.order.findUnique({ where: { id: o.id } }) });
});

// ---- 購入者向け（ログイン不要） ----

// 出品者の特定商取引法に基づく表記
router.get('/legal/:slug', async (req, res) => {
  const lp = await prisma.landingPage.findUnique({ where: { slug: String(req.params.slug) }, select: { businessName: true, hidden: true, userId: true } });
  if (!lp || lp.hidden) return res.status(404).json({ error: 'Not found' });
  const p = await prisma.sellerProfile.findUnique({ where: { userId: lp.userId } });
  if (!p?.enabled) return res.status(404).json({ error: 'Not found' });
  const legal = normalizeLegal(p.legal);
  const methods = [p.bankEnabled ? `銀行振込（注文後${p.paymentDays}日以内）` : '', p.inPersonEnabled ? `店頭・手渡しでのお支払い${p.inPersonNote ? `（${p.inPersonNote}）` : ''}` : ''].filter(Boolean);
  res.json({
    businessName: lp.businessName,
    legal: {
      ...legal,
      address: legal.disclosureOnRequest && !legal.address ? '請求があった場合に遅滞なく開示します' : legal.address,
      phone: legal.disclosureOnRequest && !legal.phone ? '請求があった場合に遅滞なく開示します' : legal.phone
    },
    paymentMethods: methods,
    shipping: { feeYen: p.shippingFeeYen, freeOverYen: p.freeShippingOverYen }
  });
});

router.post('/orders/:slug', async (req, res) => {
  const lp = await prisma.landingPage.findUnique({ where: { slug: String(req.params.slug) }, select: { id: true, userId: true, businessName: true, hidden: true } });
  if (!lp || lp.hidden) return res.status(404).json({ error: 'Not found' });
  if (req.body?.website) return res.status(201).json({ code: 'ok' });
  const seller = await prisma.sellerProfile.findUnique({ where: { userId: lp.userId } });
  if (!seller?.enabled) return res.status(400).json({ error: 'このページでは、いま注文を受け付けていません' });

  const method = req.body?.paymentMethod === 'bank' && seller.bankEnabled ? 'bank' : req.body?.paymentMethod === 'in_person' && seller.inPersonEnabled ? 'in_person' : null;
  if (!method) return res.status(400).json({ error: '支払い方法を選んでください' });
  const buyerName = String(req.body?.buyerName ?? '').trim().slice(0, 40);
  const buyerContact = String(req.body?.buyerContact ?? '').trim().slice(0, 100);
  if (!buyerName) return res.status(400).json({ error: 'お名前を入力してください' });
  if (!EMAIL_RE.test(buyerContact) && !PHONE_RE.test(buyerContact)) return res.status(400).json({ error: 'メールアドレスか電話番号を入力してください' });
  if (!req.body?.agree) return res.status(400).json({ error: '注文内容と個人情報の取り扱いへの同意が必要です' });
  const rawItems = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20) : [];
  const wanted = rawItems.map((i: any) => ({ productId: String(i?.productId ?? ''), qty: Number(i?.qty) })).filter((i: any) => i.productId && Number.isInteger(i.qty) && i.qty >= 1 && i.qty <= 99);
  if (!wanted.length) return res.status(400).json({ error: '商品を選んでください' });
  if (!(await isAdminUser(lp.userId)) && hitRateLimit(`order:${lp.id}`, DAILY_ORDERS_PER_PAGE, DAY_MS)) return res.status(429).json({ error: 'ただいま注文が混み合っています。時間をおいてお試しください' });

  try {
    const order = await prisma.$transaction(async (db) => {
      const products = await db.product.findMany({ where: { id: { in: wanted.map((w: any) => w.productId) }, lpId: lp.id } });
      const items: { productId: string; name: string; priceYen: number; qty: number }[] = [];
      let needsShipping = false;
      for (const w of wanted) {
        const p = products.find((x) => x.id === w.productId);
        if (!p || !p.purchasable || p.soldOut || p.priceYen == null) throw new Error('購入できない商品が含まれています');
        // 在庫を管理している商品は、在庫が足りるときだけ減らす（同時の注文でもマイナスにならない）
        if (p.stock !== null) {
          const r = await db.product.updateMany({ where: { id: p.id, stock: { gte: w.qty } }, data: { stock: { decrement: w.qty } } });
          if (r.count === 0) throw new Error(`「${p.name}」の在庫が足りません`);
        }
        if (p.requiresShipping) needsShipping = true;
        items.push({ productId: p.id, name: p.name, priceYen: p.priceYen, qty: w.qty });
      }
      const subtotalYen = items.reduce((a, i) => a + i.priceYen * i.qty, 0);
      const shippingYen = needsShipping && !(seller.freeShippingOverYen != null && subtotalYen >= seller.freeShippingOverYen) ? seller.shippingFeeYen : 0;
      let shipping: { postal: string; address: string; name: string } | null = null;
      if (needsShipping) {
        shipping = {
          postal: String(req.body?.shipping?.postal ?? '').trim().slice(0, 10),
          address: String(req.body?.shipping?.address ?? '').trim().slice(0, 200),
          name: String(req.body?.shipping?.name ?? buyerName).trim().slice(0, 40)
        };
        if (!/^\d{3}-?\d{4}$/.test(shipping.postal) || !shipping.address) throw new Error('お届け先（郵便番号・住所）を入力してください');
      }
      return db.order.create({
        data: {
          code: code(), lpId: lp.id, sellerId: lp.userId, items, subtotalYen, shippingYen, totalYen: subtotalYen + shippingYen,
          paymentMethod: method, buyerName, buyerContact, shipping: shipping ?? undefined,
          message: String(req.body?.message ?? '').trim().slice(0, 500) || null,
          expiresAt: method === 'bank' ? new Date(Date.now() + seller.paymentDays * DAY_MS) : null
        }
      });
    });
    void notifyUser(lp.userId, '新しい注文', `${buyerName}さん・¥${order.totalYen.toLocaleString('ja-JP')}`, { type: 'order' });
    res.status(201).json({ code: order.code });
  } catch (e: any) {
    res.status(400).json({ error: e?.message?.length < 80 ? e.message : '注文できませんでした' });
  }
});

// 注文の状況（受付番号を知っている購入者だけが見られる）。振込待ちのときだけ振込先を表示する
router.get('/orders/status/:code', async (req, res) => {
  await sweepOrders();
  const o = await prisma.order.findUnique({ where: { code: String(req.params.code) }, include: { lp: { select: { slug: true, businessName: true } } } });
  if (!o) return res.status(404).json({ error: '見つかりません' });
  let bank: Bank | null = null;
  if (o.status === 'awaiting_payment' && o.paymentMethod === 'bank') {
    const seller = await prisma.sellerProfile.findUnique({ where: { userId: o.sellerId } });
    bank = seller?.bankEnc ? JSON.parse(open(seller.bankEnc)) : null;
  }
  const inPersonNote = o.paymentMethod === 'in_person' ? (await prisma.sellerProfile.findUnique({ where: { userId: o.sellerId } }))?.inPersonNote ?? null : null;
  res.json({
    order: {
      code: o.code, items: o.items, subtotalYen: o.subtotalYen, shippingYen: o.shippingYen, totalYen: o.totalYen, paymentMethod: o.paymentMethod,
      status: o.status, expiresAt: o.expiresAt, paidAt: o.paidAt, shippedAt: o.shippedAt, sellerNote: o.sellerNote, createdAt: o.createdAt,
      buyerName: o.buyerName, lp: o.lp
    },
    bank,
    inPersonNote
  });
});

router.post('/orders/status/:code/cancel', async (req, res) => {
  const o = await prisma.order.findUnique({ where: { code: String(req.params.code) } });
  if (!o) return res.status(404).json({ error: '見つかりません' });
  if (o.status !== 'awaiting_payment') return res.status(400).json({ error: '支払い前の注文だけ取り消せます。お店に連絡してください' });
  await cancelOrder(o.id, '購入者が取り消しました');
  void notifyUser(o.sellerId, '注文が取り消されました', `${o.buyerName}さん・¥${o.totalYen.toLocaleString('ja-JP')}`, { type: 'order' });
  res.json({ ok: true });
});

export default router;
