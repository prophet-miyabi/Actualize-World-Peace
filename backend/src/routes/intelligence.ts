// AWP Data Intelligence の API。
//   GET  /intent                 ログイン中の利用者への「いま導入すると効く外部ツール」の提案（スコア 80 以上をダッシュボードに出す）
//   POST /intent/refresh         自分の提案を今すぐ計算し直す
//   GET  /benchmarks             （運営者）業種×チャネルの勝ちパターン一覧とレイクの件数
//   GET  /intents                （運営者）導入インテントの上位
//   POST /aggregate              （運営者）集計を今すぐ実行
import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, type AuthRequest } from '../middlewares/auth';
import { requireAdmin } from '../middlewares/admin';
import { industryOf } from '../ai/playbook';
import { INTENT_LABEL, aggregateIndustryBenchmarks, evaluateAllHarnessIntents, evaluateHarnessIntent } from '../automation/awpDataAssetEngine';
import { z } from 'zod';

const router = Router();

router.get('/intent', authenticate, async (req: AuthRequest, res) => {
  const rows = await prisma.harnessIntentSignal.findMany({ where: { ownerId: req.user!.id, isConverted: false, intentScore: { gt: 0 } }, orderBy: { intentScore: 'desc' }, take: 2 });
  res.json({ intents: rows.map((r) => ({ key: r.recommendedAddon, label: INTENT_LABEL[r.recommendedAddon] ?? r.recommendedAddon, score: r.intentScore, reason: r.reason, suggest: r.intentScore >= 80, updatedAt: r.updatedAt, href: r.recommendedAddon === 'custom-domain' ? '/domain' : r.recommendedAddon === 'shop-payments' ? '/shop-settings' : '/harness' })) });
});

router.post('/intent/refresh', authenticate, async (req: AuthRequest, res) => {
  const rows = await evaluateHarnessIntent(req.user!.id);
  res.json({ intents: rows.map((r) => ({ key: r.recommendedAddon, label: INTENT_LABEL[r.recommendedAddon] ?? r.recommendedAddon, score: r.intentScore, reason: r.reason })) });
});

router.get('/benchmarks', authenticate, requireAdmin, async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [rows, total, byStage, recent] = await Promise.all([
    prisma.industryFunnelBenchmark.findMany({ orderBy: [{ sampleSize: 'desc' }] }),
    prisma.awpIntelligenceLake.count(),
    prisma.awpIntelligenceLake.groupBy({ by: ['funnelStage'], _count: { _all: true }, where: { createdAt: { gte: since } } }),
    prisma.awpIntelligenceLake.groupBy({ by: ['industryKey'], _count: { _all: true }, where: { createdAt: { gte: since } }, orderBy: { _count: { industryKey: 'desc' } }, take: 10 })
  ]);
  res.json({
    lake: { total, last30d: Object.fromEntries(byStage.map((s) => [s.funnelStage, s._count._all])), topIndustries: recent.map((r) => ({ key: r.industryKey, label: industryOf(r.industryKey).label, count: r._count._all })) },
    benchmarks: rows.map((r) => ({ ...r, industryLabel: industryOf(r.industryKey).label }))
  });
});

router.get('/intents', authenticate, requireAdmin, async (_req, res) => {
  const rows = await prisma.harnessIntentSignal.findMany({ where: { intentScore: { gt: 0 } }, orderBy: { intentScore: 'desc' }, take: 50 });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.ownerId) } }, select: { id: true, username: true, name: true } });
  const by = new Map(users.map((u) => [u.id, u]));
  res.json({ intents: rows.map((r) => ({ ...r, label: INTENT_LABEL[r.recommendedAddon] ?? r.recommendedAddon, industryLabel: industryOf(r.industryKey).label, owner: by.get(r.ownerId) ? { username: by.get(r.ownerId)!.username, name: by.get(r.ownerId)!.name } : null })) });
});

router.post('/aggregate', authenticate, requireAdmin, async (_req, res) => {
  const benchmarks = await aggregateIndustryBenchmarks();
  const owners = await evaluateAllHarnessIntents();
  res.json({ benchmarks, owners });
});

// ---- 雅テック 資金トラッカー（オーナー決定 2026-10-23）: 年内 300 万円 → 2027 年初頭に 3,300 万円の融資 ----
// 受託の案件（提案中・成約・入金）と融資のエビデンスを SystemSetting(JSON) に持ち、AWP 側の収益（確定報酬の AWP 分・プラン売上）は台帳から足す
const TRACKER_KEY = 'miyabi_funding_tracker';
const Deal = z.object({
  id: z.string().min(1).max(40), client: z.string().min(1).max(80), pkg: z.enum(['ume', 'take', 'matsu', 'custom']).default('custom'),
  amountYen: z.number().int().min(0).max(100_000_000), maintenanceYen: z.number().int().min(0).max(1_000_000).default(0),
  status: z.enum(['proposed', 'signed', 'paid', 'lost']).default('proposed'), proposedOn: z.string().max(10).optional().nullable(), signedOn: z.string().max(10).optional().nullable(), paidOn: z.string().max(10).optional().nullable(), note: z.string().max(300).optional().nullable()
});
const Tracker = z.object({
  deals: z.array(Deal).max(200).default([]),
  loan: z.object({ status: z.enum(['preparing', 'consulting', 'applied', 'approved', 'executed']).default('preparing'), lender: z.string().max(120).default('浜松市スタートアップ支援・金融機関（創業融資）'), note: z.string().max(500).default('') }).default({}),
  evidence: z.record(z.string().max(40), z.boolean()).default({})
});
type TrackerT = z.infer<typeof Tracker>;
const TARGETS = { selfCapitalYen: 3_000_000, selfCapitalBy: '2026-12-31', dealsTarget: 7, maintenanceTarget: 3, loanYen: 33_000_000, loanApplyBy: '2027-02-28', loanBy: '2027-03-31' };
const EVIDENCE = [
  { key: 'self_capital_ratio', label: '自己資金比率（300万/3,300万 ≒ 9%。10%以上が望ましい）' },
  { key: 'signed_deals', label: '受託の成約件数と契約書・請求書・入金記録' },
  { key: 'awp_roi', label: 'AWP の自社実証 ROI（投稿・閲覧・予約・成約の実測）' },
  { key: 'maintenance_contracts', label: '月額保守への転換数（継続収入の根拠）' },
  { key: 'business_plan', label: '事業計画書・資金繰り表（finance/ の P/L・B/S・CF から作成）' },
  { key: 'registration', label: '開業届・屋号口座・インボイス登録' }
];

async function readTracker(): Promise<TrackerT> {
  const row = await prisma.systemSetting.findUnique({ where: { key: TRACKER_KEY } });
  try { return Tracker.parse(row ? JSON.parse(row.value) : {}); } catch { return Tracker.parse({}); }
}

async function trackerView(t: TrackerT) {
  const since = new Date('2026-10-01T00:00:00+09:00');
  const [rev, plans] = await Promise.all([
    prisma.revenueEvent.aggregate({ _sum: { platformYen: true }, where: { status: 'recorded', occurredOn: { gte: since } } }),
    prisma.planPayment.aggregate({ _sum: { amountYen: true }, where: { createdAt: { gte: since } } }).catch(() => ({ _sum: { amountYen: 0 } }))
  ]);
  const awpYen = (rev._sum.platformYen ?? 0) + ((plans as any)._sum?.amountYen ?? 0);
  const signed = t.deals.filter((d) => d.status === 'signed' || d.status === 'paid');
  const paid = t.deals.filter((d) => d.status === 'paid');
  const signedYen = signed.reduce((a, d) => a + d.amountYen, 0);
  const paidYen = paid.reduce((a, d) => a + d.amountYen, 0);
  const maintenanceCount = signed.filter((d) => d.maintenanceYen > 0).length;
  const totalYen = paidYen + awpYen;
  return {
    targets: TARGETS, evidenceList: EVIDENCE, tracker: t,
    progress: {
      paidYen, signedYen, awpYen, totalYen, pct: Math.min(100, Math.round((totalYen / TARGETS.selfCapitalYen) * 100)), remainingYen: Math.max(0, TARGETS.selfCapitalYen - totalYen),
      signedDeals: signed.length, paidDeals: paid.length, proposedDeals: t.deals.filter((d) => d.status === 'proposed').length, maintenanceCount,
      selfCapitalRatioPct: Math.round((totalYen / TARGETS.loanYen) * 1000) / 10,
      daysLeft: Math.max(0, Math.ceil((new Date(`${TARGETS.selfCapitalBy}T23:59:59+09:00`).getTime() - Date.now()) / 86_400_000))
    }
  };
}

router.get('/funding-tracker', authenticate, requireAdmin, async (_req, res) => res.json(await trackerView(await readTracker())));

router.put('/funding-tracker', authenticate, requireAdmin, async (req: AuthRequest, res) => {
  const parsed = Tracker.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: '入力の形式が正しくありません' });
  await prisma.systemSetting.upsert({ where: { key: TRACKER_KEY }, update: { value: JSON.stringify(parsed.data), updatedBy: req.user!.id }, create: { key: TRACKER_KEY, value: JSON.stringify(parsed.data), updatedBy: req.user!.id } });
  res.json(await trackerView(parsed.data));
});

export default router;
