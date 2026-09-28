import prisma from '../prisma';
import { draftForPlatform, SNS_PLATFORMS } from './marketing';
import { checkLpHealth } from './growth';
import { reviewSocialDraft } from './compliance';

// 役割ごとのエージェント（プラットフォーム別のマーケティング担当・成長分析担当・コンプライアンス担当）を
// 定期的に動かすループ。「作成・分析・審査」までは完全に自動で行う。
// 実際にSNS投稿する実行は、審査に通り、かつ本人がautoPublishEnabledを有効にしている場合だけ
// 人間の承認なしで自動的に予約する。無効な場合は今まで通り承認待ちに積む（backend/src/routes/agents.ts）。
const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6時間ごと
const MARKETING_COOLDOWN_MS = 24 * 60 * 60 * 1000; // プラットフォームごとに、SNS下書きは24時間に1本まで（無料枠の節約）

export async function runAgentsForUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return;
  const lp = await prisma.landingPage.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
  if (!lp) return;

  // 成長分析担当：指摘事項があれば最新の1件だけを残す（古い未承認分は消して積み上がらないようにする）
  const health = checkLpHealth({
    pageViews: lp.pageViews,
    sections: lp.sections,
    customDomain: lp.customDomain,
    designSource: lp.designSource,
    hasImage: !!lp.heroImage
  });
  await prisma.agentTask.deleteMany({ where: { userId, role: 'growth', kind: 'lp_health_check', status: 'pending_review' } });
  if (health.issues.length > 0) {
    await prisma.agentTask.create({ data: { userId, role: 'growth', kind: 'lp_health_check', lpId: lp.id, output: health as any } });
  }

  // マーケティング担当：プラットフォームごとに専門エージェントを分け、それぞれ独立して下書きを作る
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) return;
  const sections = Array.isArray(lp.sections) ? (lp.sections as { feature: string; content: unknown }[]) : [];
  const input = { businessName: lp.businessName, heroTitle: lp.heroTitle, strengths: lp.strengths, sections };

  for (const platform of SNS_PLATFORMS) {
    const role = `marketing_${platform}`;
    const recent = await prisma.agentTask.findFirst({
      where: { userId, role, createdAt: { gte: new Date(Date.now() - MARKETING_COOLDOWN_MS) } }
    });
    if (recent) continue;

    try {
      const text = await draftForPlatform(platform, input);

      // コンプライアンス担当が、公開前に必ず審査する（自動承認をオンにしていない場合も、
      // 判断理由を添えることで人間の最終確認の参考にする）
      let reviewPassed: boolean | null = null;
      let reviewNote: string | null = null;
      if (process.env.ANTHROPIC_API_KEY) {
        try {
          const review = await reviewSocialDraft({ platform, text, businessName: lp.businessName, heroTitle: lp.heroTitle, strengths: lp.strengths });
          reviewPassed = review.approved;
          reviewNote = review.reason;
        } catch (e: any) {
          console.error(`compliance review (${platform}) failed`, userId, e?.message);
        }
      }

      // 自動承認の条件：本人がオンにしている・審査に通っている・投稿先のSNSが連携済み
      let autoApproved = false;
      if (user.autoPublishEnabled && reviewPassed) {
        const account = await prisma.socialAccount.findUnique({ where: { userId_platform: { userId, platform } } });
        if (account) {
          await prisma.scheduledPost.create({ data: { userId, text, platforms: [platform], scheduledAt: new Date() } });
          autoApproved = true;
        }
      }

      await prisma.agentTask.create({
        data: {
          userId, role, kind: 'sns_post_draft', lpId: lp.id,
          output: { platform, text } as any,
          reviewPassed, reviewNote, autoApproved,
          status: autoApproved ? 'approved' : 'pending_review',
          reviewedAt: autoApproved ? new Date() : null
        }
      });
    } catch (e: any) {
      console.error(`marketing agent (${platform}) failed`, userId, e?.message);
    }
  }
}

async function tick() {
  // 実行コストがかかるため、有料プラン加入中（または管理者）のアカウントだけを対象にする
  const users = await prisma.user.findMany({ where: { OR: [{ subscriptionStatus: 'active' }, { isAdmin: true }] }, select: { id: true } });
  for (const u of users) {
    await runAgentsForUser(u.id).catch((e) => console.error('agent loop failed', u.id, e?.message));
  }
}

let started = false;
export function startAgentLoop() {
  if (started) return;
  started = true;
  void tick().catch((e) => console.error('agent loop initial tick failed', e?.message));
  setInterval(() => { tick().catch((e) => console.error('agent loop tick failed', e?.message)); }, INTERVAL_MS);
  console.log(`AIエージェント（マーケティング・コンプライアンス審査・成長分析）の定期実行を開始しました（${INTERVAL_MS / 3600000}時間ごと）`);
}
