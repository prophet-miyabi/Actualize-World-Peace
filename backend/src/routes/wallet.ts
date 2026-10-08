import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { ACCOUNTS, accountBalance, cashBalance, OWNER_SHARE_PERCENT, postTransaction, reverseTransaction, splitRevenue } from '../lib/ledger';

// キャッシュ（収益の分配）と、ページの収益化（PR枠）。
// - 収益は、ASP・広告主の管理画面で「確定」した報酬を運営者が記録したときだけ発生する（発生ベースでは数えない）
// - 分配: ページの持ち主 78% / AWP 22%
// - キャッシュの使い道は、いまはAWP自身の有料機能（Harness導入支援）の支払いだけ。
//   出金（銀行振込）は、本人確認・税務・送金の仕組みが整うまで「準備中」とする
const router = Router();
router.use(authenticate);

const PAYMENT_LABEL: Record<string, string> = {
  revenue_share: '収益の分配',
  harness_payment: 'Harness導入支援の支払い',
  plan_payment: '有料プランの支払い',
  reversal: '取り消し'
};

async function requireAdmin(req: AuthRequest, res: any): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!user?.isAdmin) {
    res.status(403).json({ error: '管理者のみ利用できます' });
    return false;
  }
  return true;
}

router.get('/', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [balance, entries, pages] = await Promise.all([
    cashBalance(prisma, userId),
    prisma.ledgerEntry.findMany({
      where: { account: ACCOUNTS.userCash(userId) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { tx: { select: { kind: true, memo: true } } }
    }),
    prisma.landingPage.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { id: true, slug: true, businessName: true, monetizationEnabled: true, hidden: true } })
  ]);
  const clicks = await prisma.affiliateClick.groupBy({
    by: ['lpId'], where: { lpId: { in: pages.map((p) => p.id) }, createdAt: { gte: since } }, _count: { _all: true }
  });
  const clicksBy = Object.fromEntries(clicks.map((c) => [c.lpId, c._count._all]));
  res.json({
    balance,
    ownerSharePercent: OWNER_SHARE_PERCENT,
    withdrawal: { available: false, reason: '出金（銀行振込）は準備中です。いまはAWPの有料機能の支払いに使えます。' },
    history: entries.map((e) => ({
      id: e.id, amount: e.credit - e.debit, label: PAYMENT_LABEL[e.tx.kind] || e.tx.kind, memo: e.tx.memo, createdAt: e.createdAt
    })),
    pages: pages.map((p) => ({ ...p, prClicks30d: clicksBy[p.id] ?? 0 }))
  });
});

// ページの収益化（PR枠）のオン・オフ
router.put('/monetization', async (req: AuthRequest, res) => {
  const lp = await prisma.landingPage.findFirst({ where: { id: String(req.body?.lpId ?? ''), userId: req.user!.id } });
  if (!lp) return res.status(404).json({ error: 'ページが見つかりません' });
  const updated = await prisma.landingPage.update({
    where: { id: lp.id }, data: { monetizationEnabled: !!req.body?.enabled }, select: { id: true, monetizationEnabled: true }
  });
  res.json({ page: updated });
});

// Harness導入支援の申し込みを、キャッシュで支払う
router.post('/pay/harness/:orderId', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  try {
    const result = await prisma.$transaction(async (db) => {
      // 同じ利用者の支払いが同時に走っても残高を超えて使えないよう、利用者の行をロックしてから残高を確認する
      await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const order = await db.harnessOrder.findFirst({ where: { id: String(req.params.orderId), userId } });
      if (!order) return { status: 404, error: '申し込みが見つかりません' };
      if (order.status === 'canceled') return { status: 400, error: '取り消し済みの申し込みです' };
      if (order.paymentStatus !== 'unpaid' || order.totalYen <= 0) return { status: 400, error: 'この申し込みは支払いの必要がありません' };
      const balance = await cashBalance(db, userId);
      if (balance < order.totalYen) return { status: 400, error: `キャッシュが足りません（残高 ${balance.toLocaleString()}円）` };
      await postTransaction(db, {
        kind: 'harness_payment', memo: `Harness導入支援（${order.id.slice(-6)}）`, refType: 'harness_order', refId: order.id, createdBy: userId,
        lines: [{ account: ACCOUNTS.userCash(userId), debit: order.totalYen }, { account: ACCOUNTS.sales, credit: order.totalYen }]
      });
      const updated = await db.harnessOrder.update({ where: { id: order.id }, data: { paymentStatus: 'paid' } });
      return { status: 200, order: updated };
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ order: result.order, balance: await cashBalance(prisma, userId) });
  } catch (e: any) {
    console.error('cash payment failed', e?.message);
    res.status(500).json({ error: '支払いに失敗しました。時間をおいてお試しください。' });
  }
});

// ---- 運営者向け: 確定した報酬の記録と分配 ----

router.get('/admin/revenue', async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [events, tools, receivable, revenue, sales, clicks] = await Promise.all([
    prisma.revenueEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.toolCatalogItem.findMany({ orderBy: { name: 'asc' }, select: { key: true, name: true, revenueShareAllowed: true } }),
    accountBalance(prisma, ACCOUNTS.receivable),
    accountBalance(prisma, ACCOUNTS.revenue),
    accountBalance(prisma, ACCOUNTS.sales),
    prisma.affiliateClick.groupBy({ by: ['toolKey', 'lpId'], where: { createdAt: { gte: since } }, _count: { _all: true } })
  ]);
  const lpIds = [...new Set([...events.map((e) => e.lpId), ...clicks.map((c) => c.lpId)].filter(Boolean) as string[])];
  const lps = await prisma.landingPage.findMany({ where: { id: { in: lpIds } }, select: { id: true, slug: true } });
  const slugOf = Object.fromEntries(lps.map((l) => [l.id, l.slug]));
  const userCash = await prisma.ledgerEntry.aggregate({ where: { account: { startsWith: 'user:' } }, _sum: { credit: true, debit: true } });
  res.json({
    totals: {
      receivableYen: receivable.debit - receivable.credit,
      platformRevenueYen: revenue.credit - revenue.debit,
      cashSalesYen: sales.credit - sales.debit,
      userCashOutstandingYen: (userCash._sum.credit ?? 0) - (userCash._sum.debit ?? 0)
    },
    events: events.map((e) => ({ ...e, slug: e.lpId ? slugOf[e.lpId] ?? null : null })),
    tools,
    clicks30d: clicks.map((c) => ({ toolKey: c.toolKey, slug: c.lpId ? slugOf[c.lpId] ?? '(削除済み)' : null, count: c._count._all }))
  });
});

router.post('/admin/revenue', async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const toolKey = String(req.body?.toolKey ?? '');
  const grossYen = Number(req.body?.grossYen);
  const slug = String(req.body?.slug ?? '').trim();
  const externalRef = String(req.body?.externalRef ?? '').trim().slice(0, 100) || null;
  const note = String(req.body?.note ?? '').trim().slice(0, 300) || null;
  const occurredOn = new Date(String(req.body?.occurredOn ?? ''));

  const tool = await prisma.toolCatalogItem.findUnique({ where: { key: toolKey } });
  if (!tool) return res.status(400).json({ error: '提携ツールを選んでください' });
  if (!Number.isInteger(grossYen) || grossYen <= 0 || grossYen > 10_000_000) return res.status(400).json({ error: '金額は1円以上の整数で入力してください' });
  if (Number.isNaN(occurredOn.getTime())) return res.status(400).json({ error: '確定日を入力してください' });

  let lp: { id: string; userId: string; monetizationEnabled: boolean } | null = null;
  if (slug) {
    lp = await prisma.landingPage.findUnique({ where: { slug }, select: { id: true, userId: true, monetizationEnabled: true } });
    if (!lp) return res.status(400).json({ error: 'そのURLのページはありません' });
    // 分配は、ASPの規約で認められた案件で、かつ持ち主が収益化をオンにしているページだけ
    if (!tool.revenueShareAllowed) return res.status(400).json({ error: 'このツールは分配が許可されていません（提携ツールの設定で「報酬の分配OK」にしてから記録してください）' });
    if (!lp.monetizationEnabled) return res.status(400).json({ error: 'このページは収益化（PR枠）がオフです' });
  }

  const { ownerYen, platformYen } = lp ? splitRevenue(grossYen) : { ownerYen: 0, platformYen: grossYen };
  try {
    const event = await prisma.$transaction(async (db) => {
      const tx = await postTransaction(db, {
        kind: 'revenue_share',
        memo: `${tool.name}の報酬${lp ? `（/${slug}）` : '（AWP直接）'}`,
        refType: 'revenue_event',
        createdBy: req.user!.id,
        lines: [
          { account: ACCOUNTS.receivable, debit: grossYen },
          ...(lp ? [{ account: ACCOUNTS.userCash(lp.userId), credit: ownerYen }] : []),
          { account: ACCOUNTS.revenue, credit: platformYen }
        ]
      });
      const ev = await db.revenueEvent.create({
        data: {
          toolKey, lpId: lp?.id ?? null, userId: lp?.userId ?? null, grossYen, ownerYen, platformYen,
          occurredOn, externalRef, note, txId: tx.id, createdBy: req.user!.id
        }
      });
      await db.ledgerTransaction.update({ where: { id: tx.id }, data: { refId: ev.id } });
      return ev;
    });
    res.status(201).json({ event });
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(400).json({ error: 'この成果IDは記録済みです（二重記録を防止しました）' });
    throw e;
  }
});

// 記録の取り消し（ASP側で否認・取り消しになった場合など）。分配したキャッシュも逆仕訳で戻す
router.post('/admin/revenue/:id/reverse', async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const ev = await prisma.revenueEvent.findUnique({ where: { id: String(req.params.id) } });
  if (!ev) return res.status(404).json({ error: '見つかりません' });
  if (ev.status === 'reversed') return res.status(400).json({ error: '取り消し済みです' });
  await prisma.$transaction(async (db) => {
    await reverseTransaction(db, ev.txId, `報酬記録の取り消し（${ev.toolKey}）`, req.user!.id);
    await db.revenueEvent.update({ where: { id: ev.id }, data: { status: 'reversed' } });
  });
  res.json({ ok: true });
});

export default router;

// Harnessの申し込みが取り消されたとき、キャッシュで支払っていれば返金する（逆仕訳）
export async function refundHarnessCash(orderId: string, createdBy: string) {
  return prisma.$transaction(async (db) => {
    const order = await db.harnessOrder.findUnique({ where: { id: orderId } });
    if (!order || order.paymentStatus !== 'paid') return false;
    const payment = await db.ledgerTransaction.findFirst({ where: { kind: 'harness_payment', refType: 'harness_order', refId: orderId }, orderBy: { createdAt: 'desc' } });
    if (!payment) return false;
    await reverseTransaction(db, payment.id, `Harness導入支援の返金（${orderId.slice(-6)}）`, createdBy);
    await db.harnessOrder.update({ where: { id: orderId }, data: { paymentStatus: 'refunded' } });
    return true;
  });
}
