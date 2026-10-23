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

export default router;
