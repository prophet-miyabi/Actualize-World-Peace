import prisma from '../prisma';
import { draftForPlatform, SNS_PLATFORMS, type SnsPlatform, type MarketingInput } from './marketing';
import { reviewSocialDraft } from './compliance';
import { captureError } from '../lib/errors';

// AWP自身の集客のためのSNS投稿を作る自己PR担当。他事業者向け（marketing.ts）と同じ仕組み・
// 同じ安全策（事実ベースの生成・コンプライアンス審査）を使うが、紹介する事業はAWP自身であり、
// 投稿には必ずAWPのサービスLPへの導線（SITE_URL）を添える。
// 実行対象は管理者（＝AWP運営者自身が連携したSNSアカウント）に限る。
const SELF_PROMOTION_FACTS: MarketingInput = {
  businessName: 'AWP',
  heroTitle: 'あなたのビジネスも、あなた自身も。AIと一緒に世界へ公開しよう。',
  strengths: [
    'AIとの会話だけでLP・HPを自動作成',
    '公式LINE連携（既にお持ちの場合は追加料金なし）',
    'SNS投稿の下書き作成からコンプライアンス審査までAIエージェントが自動化'
  ],
  sections: []
};

// X/Facebookは投稿文中のURLがそのままリンクとして機能する。Instagram/TikTokはキャプション内リンクが
// 機能しないため、プロフィール欄のリンクに誘導する文言にする（運営者は事前にプロフィールへSITE_URLを設定しておく）
const INLINE_LINK_PLATFORMS: SnsPlatform[] = ['x', 'facebook'];

async function draftSelfPromotionPost(platform: SnsPlatform, siteUrl: string): Promise<string> {
  const text = await draftForPlatform(platform, SELF_PROMOTION_FACTS);
  return INLINE_LINK_PLATFORMS.includes(platform) ? `${text}\n\n${siteUrl}` : `${text}\n\n▶ 詳しくはプロフィールのリンクから`;
}

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // プラットフォームごとに24時間に1本まで（無料枠の節約、他事業者向けと同じ方針）

export async function runSelfPromotionAgents(): Promise<void> {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) return;

  const admins = await prisma.user.findMany({ where: { isAdmin: true }, select: { id: true, autoPublishEnabled: true } });

  for (const admin of admins) {
    for (const platform of SNS_PLATFORMS) {
      const role = `self_promotion_${platform}`;
      // 連携済みのSNSだけを対象にする（未連携先には投稿しようがないため）
      const account = await prisma.socialAccount.findUnique({ where: { userId_platform: { userId: admin.id, platform } } });
      if (!account) continue;

      const recent = await prisma.agentTask.findFirst({
        where: { userId: admin.id, role, createdAt: { gte: new Date(Date.now() - COOLDOWN_MS) } }
      });
      if (recent) continue;

      try {
        const text = await draftSelfPromotionPost(platform, siteUrl);

        let reviewPassed: boolean | null = null;
        let reviewNote: string | null = null;
        if (process.env.ANTHROPIC_API_KEY) {
          try {
            const review = await reviewSocialDraft({
              platform, text,
              businessName: SELF_PROMOTION_FACTS.businessName,
              heroTitle: SELF_PROMOTION_FACTS.heroTitle,
              strengths: SELF_PROMOTION_FACTS.strengths
            });
            reviewPassed = review.approved;
            reviewNote = review.reason;
          } catch (e: any) {
            console.error(`self promotion compliance review (${platform}) failed`, e?.message);
            void captureError('self_promotion_compliance', e, { platform });
          }
        }

        // 自動承認の条件は他事業者向けと同じ：管理者本人がautoPublishEnabledをオンにしており、審査に通っていること
        let autoApproved = false;
        if (admin.autoPublishEnabled && reviewPassed) {
          await prisma.scheduledPost.create({ data: { userId: admin.id, text, platforms: [platform], scheduledAt: new Date() } });
          autoApproved = true;
        }

        await prisma.agentTask.create({
          data: {
            userId: admin.id, role, kind: 'sns_post_draft',
            output: { platform, text } as any,
            reviewPassed, reviewNote, autoApproved,
            status: autoApproved ? 'approved' : 'pending_review',
            reviewedAt: autoApproved ? new Date() : null
          }
        });
      } catch (e: any) {
        console.error(`self promotion agent (${platform}) failed`, admin.id, e?.message);
        void captureError('self_promotion_agent', e, { platform });
      }
    }
  }
}
