import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { ACCOUNTS, cashBalance, postTransaction } from '../lib/ledger';
import { activePlan, getPlanConfig, PLAN_KEYS, PLAN_LABEL, planPrices, setPlanConfig, type PlanKey } from '../lib/plans';
import { aiQuota } from '../lib/aiUsage';
import { seal, open } from '../lib/secretBox';
import { notifyUser } from '../lib/push';

// AWPの有料プランの申し込みと請求（自前の請求。決済会社を通さないので決済手数料がかからない）。
// 支払い方法: 銀行振込（運営者が入金を確認して有効化）/ キャッシュ（収益化で受け取った分。すぐに有効化）。
// AWPは利用者の口座情報やカード情報を預からない
const router = Router();

// 公開: 料金表（特定商取引法に基づく表記・料金ページで使う）
router.get('/public', async (_req, res) => {
  const c = await getPlanConfig();
  const prices = planPrices(c);
  res.json({ plans: PLAN_KEYS.map((k) => prices[k]), months: MONTH_OPTIONS });
});

router.use(authenticate);

const MONTH_OPTIONS = [1, 3, 6, 12];
const BANK_DAYS = 14;
const DAY_MS = 86_400_000;

type BankInfo = { bank: string; branch: string; type: string; number: string; holder: string };

async function awpBank(): Promise<BankInfo | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'awp_bank' } });
  if (!row) return null;
  try {
    return JSON.parse(open(row.value));
  } catch {
    return null;
  }
}

async function requireAdmin(req: AuthRequest, res: any): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!user?.isAdmin) {
    res.status(403).json({ error: '管理者のみ利用できます' });
    return false;
  }
  return true;
}

// プランを有効にする。同じプランなら期限を延ばし、別のプランに変えるときは、いまのプランの残り日数を金額で換算して新しいプランに足す
export async function activatePlan(db: any, userId: string, plan: PlanKey, months: number) {
  const [user, c] = await Promise.all([db.user.findUnique({ where: { id: userId }, select: { plan: true, planUntil: true, isAdmin: true } }), getPlanConfig()]);
  const prices = planPrices(c);
  const now = Date.now();
  const current = activePlan(user);
  let start = now;
  let bonusDays = 0;
  if (current === plan && user.planUntil) start = user.planUntil.getTime();
  else if (current !== 'free' && user.planUntil) {
    const remainingDays = (user.planUntil.getTime() - now) / DAY_MS;
    bonusDays = (remainingDays * prices[current].priceYen) / prices[plan].priceYen;
  }
  const until = new Date(start + (months * 30 + bonusDays) * DAY_MS);
  await db.user.update({ where: { id: userId }, data: { plan, planUntil: until } });
  return until;
}

async function expireStale() {
  await prisma.planPayment.updateMany({ where: { status: 'pending', expiresAt: { lt: new Date() } }, data: { status: 'expired' } });
}

router.get('/', async (req: AuthRequest, res) => {
  await expireStale();
  const userId = req.user!.id;
  const [user, c, quota, payments, bank, cash] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { plan: true, planUntil: true, isAdmin: true, subscriptionStatus: true } }),
    getPlanConfig(),
    aiQuota(userId),
    prisma.planPayment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    awpBank(),
    cashBalance(prisma, userId)
  ]);
  const prices = planPrices(c);
  const pending = payments.find((p) => p.status === 'pending' && p.method === 'bank');
  res.json({
    plans: PLAN_KEYS.map((k) => prices[k]),
    free: { aiUsd: c.freeAiUsd, aiYen: Math.round(c.freeAiUsd * c.usdJpy) },
    basis: { baseUsd: c.baseUsd, usdJpy: c.usdJpy, aiShare: 78 },
    current: { plan: activePlan(user!), label: PLAN_LABEL[activePlan(user!)], until: user?.planUntil ?? null, legacyStripe: user?.subscriptionStatus === 'active' },
    quota: { ...quota, usedYen: Math.round(quota.usedUsd * c.usdJpy), allowanceYen: Number.isFinite(quota.allowanceUsd) ? Math.round(quota.allowanceUsd * c.usdJpy) : null },
    methods: { bank: !!bank, cash },
    months: MONTH_OPTIONS,
    payments: payments.map((p) => ({ ...p, bank: p.id === pending?.id ? bank : undefined }))
  });
});

router.post('/purchase', async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const plan = String(req.body?.plan) as PlanKey;
  const months = Number(req.body?.months);
  const method = req.body?.method === 'cash' ? 'cash' : req.body?.method === 'bank' ? 'bank' : null;
  if (!PLAN_KEYS.includes(plan)) return res.status(400).json({ error: 'プランを選んでください' });
  if (!MONTH_OPTIONS.includes(months)) return res.status(400).json({ error: '期間を選んでください' });
  if (!method) return res.status(400).json({ error: '支払い方法を選んでください' });
  const amountYen = planPrices(await getPlanConfig())[plan].priceYen * months;
  const reference = `AWP${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;

  if (method === 'bank') {
    const bank = await awpBank();
    if (!bank) return res.status(400).json({ error: '銀行振込はただいま準備中です' });
    await expireStale();
    if (await prisma.planPayment.findFirst({ where: { userId, status: 'pending' } })) return res.status(400).json({ error: '振込待ちの申し込みがあります。先に取り消すか、振込を済ませてください' });
    const payment = await prisma.planPayment.create({
      data: { userId, plan, months, amountYen, method, reference, expiresAt: new Date(Date.now() + BANK_DAYS * DAY_MS) }
    });
    return res.status(201).json({ payment, bank });
  }

  // キャッシュ: 残高を確認して、その場で支払い・有効化（同時に2回押されても二重に使えないよう、利用者の行をロックする）
  try {
    const result = await prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const balance = await cashBalance(db, userId);
      if (balance < amountYen) return { error: `キャッシュが足りません（残高 ${balance.toLocaleString()}円）` };
      const payment = await db.planPayment.create({ data: { userId, plan, months, amountYen, method, reference, status: 'confirmed', confirmedAt: new Date(), confirmedBy: 'cash' } });
      await postTransaction(db, {
        kind: 'plan_payment', memo: `${PLAN_LABEL[plan]}プラン ${months}か月`, refType: 'plan_payment', refId: payment.id, createdBy: userId,
        lines: [{ account: ACCOUNTS.userCash(userId), debit: amountYen }, { account: ACCOUNTS.sales, credit: amountYen }]
      });
      const until = await activatePlan(db, userId, plan, months);
      return { payment, until };
    });
    if ('error' in result) return res.status(400).json({ error: result.error });
    res.status(201).json(result);
  } catch (e: any) {
    console.error('plan cash payment failed', e?.message);
    res.status(500).json({ error: '支払いに失敗しました。時間をおいてお試しください' });
  }
});

router.post('/payments/:id/cancel', async (req: AuthRequest, res) => {
  const p = await prisma.planPayment.findFirst({ where: { id: String(req.params.id), userId: req.user!.id, status: 'pending' } });
  if (!p) return res.status(404).json({ error: '取り消せる申し込みがありません' });
  await prisma.planPayment.update({ where: { id: p.id }, data: { status: 'canceled' } });
  res.json({ ok: true });
});

// ---- 運営者向け ----

router.get('/admin', async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  await expireStale();
  const [payments, c, bank] = await Promise.all([
    prisma.planPayment.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 100, include: { user: { select: { name: true, email: true } } } }),
    getPlanConfig(),
    awpBank()
  ]);
  res.json({ payments, config: c, prices: planPrices(c), bank });
});

router.put('/admin/config', async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const b = req.body ?? {};
  const num = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const baseUsd = num(b.baseUsd, 1, 1000);
  const usdJpy = num(b.usdJpy, 50, 500);
  const freeAiUsd = num(b.freeAiUsd, 0, 100);
  const multipliers = Object.fromEntries(PLAN_KEYS.map((k) => [k, num(b.multipliers?.[k], 0.1, 50)]));
  if (baseUsd === null || usdJpy === null || freeAiUsd === null || Object.values(multipliers).some((v) => v === null)) {
    return res.status(400).json({ error: '数値の範囲が正しくありません' });
  }
  const config = { baseUsd, usdJpy, freeAiUsd, multipliers: multipliers as Record<PlanKey, number> };
  await setPlanConfig(config, req.user!.id);
  res.json({ config, prices: planPrices(config) });
});

router.put('/admin/bank', async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const f = (k: string, max: number) => String(req.body?.[k] ?? '').trim().slice(0, max);
  const bank: BankInfo = { bank: f('bank', 40), branch: f('branch', 40), type: f('type', 10), number: f('number', 10), holder: f('holder', 60) };
  if (!bank.bank || !bank.branch || !bank.number || !bank.holder || !/^\d{6,8}$/.test(bank.number)) return res.status(400).json({ error: '銀行名・支店名・口座番号（数字6〜8桁）・名義を入力してください' });
  await prisma.systemSetting.upsert({ where: { key: 'awp_bank' }, update: { value: seal(JSON.stringify(bank)), updatedBy: req.user!.id }, create: { key: 'awp_bank', value: seal(JSON.stringify(bank)), updatedBy: req.user!.id } });
  res.json({ bank });
});

// 入金を確認したら有効化（台帳: 口座への入金 / 売上）
router.post('/admin/payments/:id/confirm', async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const p = await prisma.planPayment.findUnique({ where: { id: String(req.params.id) } });
  if (!p || !['pending', 'expired'].includes(p.status)) return res.status(400).json({ error: '確認できる申し込みではありません' });
  const until = await prisma.$transaction(async (db) => {
    await db.planPayment.update({ where: { id: p.id }, data: { status: 'confirmed', confirmedAt: new Date(), confirmedBy: req.user!.id } });
    await postTransaction(db, {
      kind: 'plan_payment', memo: `${PLAN_LABEL[p.plan as PlanKey]}プラン ${p.months}か月（振込 ${p.reference}）`, refType: 'plan_payment', refId: p.id, createdBy: req.user!.id,
      lines: [{ account: ACCOUNTS.bank, debit: p.amountYen }, { account: ACCOUNTS.sales, credit: p.amountYen }]
    });
    return activatePlan(db, p.userId, p.plan as PlanKey, p.months);
  });
  void notifyUser(p.userId, '有料プランが有効になりました', `${PLAN_LABEL[p.plan as PlanKey]}プラン（${until.toLocaleDateString('ja-JP')}まで）`, { type: 'plan' });
  res.json({ ok: true, until });
});

router.post('/admin/payments/:id/cancel', async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const p = await prisma.planPayment.findUnique({ where: { id: String(req.params.id) } });
  if (!p || !['pending', 'expired'].includes(p.status)) return res.status(400).json({ error: '取り消せる申し込みではありません' });
  await prisma.planPayment.update({ where: { id: p.id }, data: { status: 'canceled' } });
  res.json({ ok: true });
});

export default router;
