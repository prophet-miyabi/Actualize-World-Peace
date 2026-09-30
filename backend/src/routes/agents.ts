import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { runAgentsForUser } from '../agents/loop';
import { runSelfPromotionAgents } from '../agents/selfPromotion';

const router = Router();

// エージェントが作った成果物（承認待ち・過去分）の一覧
router.get('/', authenticate, async (req: AuthRequest, res) => {
  const tasks = await prisma.agentTask.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
  res.json({ tasks });
});

// 自動承認（Human out of the loop）の設定。既定はオフで、本人が明示的にオンにするまで有効にならない。
// オンの間は、コンプライアンス担当の審査に通ったSNS投稿下書きが、人間の承認なしで自動的に投稿予約される
router.get('/settings', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { autoPublishEnabled: true } });
  res.json({ autoPublishEnabled: !!user?.autoPublishEnabled });
});

router.put('/settings', authenticate, async (req: AuthRequest, res) => {
  const autoPublishEnabled = req.body?.autoPublishEnabled === true;
  await prisma.user.update({ where: { id: req.user!.id }, data: { autoPublishEnabled } });
  res.json({ ok: true, autoPublishEnabled });
});

// 定期実行を待たず、今すぐエージェントを動かす（お試し・急ぎのとき用）
// 複数プラットフォーム分のAI呼び出しを直列で行うため数十秒かかることがあり、
// 待たせたままにするとプロキシ側のタイムアウトで失敗して見えてしまう。
// そのため即座に202を返し、裏側で実行する（結果は一覧の再読み込みで確認する）
router.post('/run-now', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  runAgentsForUser(userId).catch((e) => console.error('run-now failed', userId, e?.message));
  // 管理者（＝AWP運営者）の場合は、自己PR用のSNS下書き作成もあわせて実行する
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) {
    runSelfPromotionAgents().catch((e) => console.error('self promotion run-now failed', e?.message));
  }
  res.status(202).json({ ok: true, status: 'running' });
});

// 承認：SNS投稿の下書きは、承認した時点で予約投稿（即時）として登録する
router.post('/:id/approve', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const task = await prisma.agentTask.findFirst({ where: { id: String(req.params.id), userId, status: 'pending_review' } });
  if (!task) return res.status(404).json({ error: 'Not found' });

  if (task.kind === 'sns_post_draft') {
    const out = task.output as { platform: string; text: string };
    const account = await prisma.socialAccount.findUnique({ where: { userId_platform: { userId, platform: out.platform } } });
    if (!account) {
      return res.status(400).json({ error: `${out.platform}が連携されていません。先にSNS連携を行ってください。` });
    }
    await prisma.scheduledPost.create({
      data: { userId, text: out.text, platforms: [out.platform], scheduledAt: new Date() }
    });
  } else if (task.kind === 'x_weekly_campaign') {
    // 3投稿1組のキャンペーン。週内に分散させて予約する（agents/xCampaign.tsの自動承認時と同じ間隔）
    const out = task.output as { posts: { type: string; text: string }[] };
    const account = await prisma.socialAccount.findUnique({ where: { userId_platform: { userId, platform: 'x' } } });
    if (!account) return res.status(400).json({ error: 'Xが連携されていません。先にSNS連携を行ってください。' });
    const intervalMs = 3 * 24 * 60 * 60 * 1000;
    await Promise.all(out.posts.map((post, i) =>
      prisma.scheduledPost.create({
        data: { userId, text: post.text, platforms: ['x'], scheduledAt: new Date(Date.now() + i * intervalMs) }
      })
    ));
  }

  await prisma.agentTask.update({ where: { id: task.id }, data: { status: 'approved', reviewedAt: new Date() } });
  res.json({ ok: true });
});

router.post('/:id/reject', authenticate, async (req: AuthRequest, res) => {
  const task = await prisma.agentTask.findFirst({ where: { id: String(req.params.id), userId: req.user!.id, status: 'pending_review' } });
  if (!task) return res.status(404).json({ error: 'Not found' });
  await prisma.agentTask.update({ where: { id: task.id }, data: { status: 'rejected', reviewedAt: new Date() } });
  res.json({ ok: true });
});

export default router;
