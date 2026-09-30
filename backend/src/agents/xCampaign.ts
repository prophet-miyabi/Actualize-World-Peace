import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import prisma from '../prisma';
import { reviewSocialDraft } from './compliance';
import { captureError } from '../lib/errors';

// X（旧Twitter）向けの週間集客キャンペーン立案エージェント。
// 単発の投稿ではなく、「気づき（教育）」「共感（信頼構築）」「直接訴求（オファー）」の
// 3投稿を通じたストーリーを組み立てる（PASの法則・黄金比率の考え方に基づく）。
// 他のエージェントと同じ大原則を厳守する：与えられていない実績・数字・限定オファー・
// 緊急性の演出は一切作らない（事実でない表示は景品表示法の不当表示に問われるおそれがあるため）。
// 「限定性・緊急性」を使ってよいのは、店主が実際に登録したscarcityOfferがある場合のみ。

const PostSchema = z.object({
  type: z.enum(['educational', 'empathy', 'offer']),
  text: z.string().describe('投稿本文。URLも含めて全角換算140字以内。前置き・見出し・鍵括弧は含めない')
});

const CampaignSchema = z.object({
  scenario: z.string().describe('3投稿を通じてターゲットをLPへ導く、今週の集客戦略シナリオ（3〜4文で簡潔に）'),
  posts: z.array(PostSchema).length(3).describe('気づき→共感→直接訴求の順で3投稿'),
  nextStepSuggestion: z.string().describe('分析すべき指標（クリック数・インプレッション等）と、反応が悪かった場合に次週試すべき別アプローチを1つ')
});

export type XCampaignInput = {
  businessName: string;
  heroTitle: string;
  strengths: string[];
  socialProof: string | null; // 実績・お客様の声（登録されている場合のみ使用してよい）
  scarcityOffer: string | null; // 期間限定オファー等（登録されている場合のみ使用してよい）
  lpUrl: string;
};

export type XCampaignPlan = z.infer<typeof CampaignSchema>;

export async function planWeeklyXCampaign(input: XCampaignInput): Promise<XCampaignPlan | null> {
  const facts = [
    `事業名/サービス名: ${input.businessName}`,
    `キャッチコピー: ${input.heroTitle}`,
    `強み: ${input.strengths.filter(Boolean).join(' / ') || '（登録なし）'}`,
    `実績・お客様の声: ${input.socialProof || '（登録なし。捏造禁止）'}`,
    `限定オファー・キャンペーン: ${input.scarcityOffer || '（登録なし。捏造禁止）'}`,
    `LPのURL: ${input.lpUrl}`
  ].join('\n');

  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: process.env.CLAUDE_MODEL || 'claude-opus-5',
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'あなたは「集客の最大化」をミッションとするSNSマーケティング戦略家です。' +
      '単なる投稿作成者ではなく、ターゲットの関心を引き、信頼を構築し、LPでのコンバージョンへ導く' +
      '3投稿の週間キャンペーンを立案します。\n' +
      '行動原則:\n' +
      '1. 黄金比率: 3投稿すべてを宣伝にしない。教育（気づき）・共感・直接訴求をこの順で1本ずつ配置する。\n' +
      '2. PASの法則: Pain（悩み）に触れ、Agitation（深掘り）し、Solution（LP）を提示する構成を基本とする。\n' +
      '3. 各投稿は140字以内（Xの仕様上、URLは実際の文字数に関わらず23字として数える）。\n' +
      '厳守事項（最重要）: 【事実】に書かれていない実績・数字・受賞歴・限定オファー・キャンペーン・日付・' +
      '緊急性の演出は絶対に作らないこと。実績やオファーが「登録なし」の場合、投稿3（直接訴求）でも' +
      '架空の限定性・緊急性を作らず、強みやLPへの明確な行動喚起で構成すること。',
    messages: [{ role: 'user', content: `【事実】\n${facts}\n\n上記の事実だけを使って、週間キャンペーンを立案してください。` }],
    output_config: { effort: 'medium', format: betaZodOutputFormat(CampaignSchema) }
  });

  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  const out = response.parsed_output;
  if (!out) return null;
  return { ...out, posts: out.posts.map((p) => ({ ...p, text: p.text.slice(0, 280) })) };
}

const POST_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3投稿を週内に分散させる間隔

// 立案→審査→（条件が揃えば）予約投稿までを行い、AgentTaskとして記録する。
// 顧客向け（marketing_x）・AWP自己PR向け（self_promotion_x）の両方から共通で使う。
export async function runXCampaignTask(params: {
  userId: string;
  role: string;
  lpId?: string | null;
  input: XCampaignInput;
  autoPublishEnabled: boolean;
  hasConnectedAccount: boolean;
}): Promise<void> {
  const plan = await planWeeklyXCampaign(params.input);
  if (!plan) return;

  let allPassed = !!process.env.ANTHROPIC_API_KEY;
  const notes: string[] = [];
  if (process.env.ANTHROPIC_API_KEY) {
    for (const post of plan.posts) {
      try {
        const review = await reviewSocialDraft({
          platform: 'x', text: post.text,
          businessName: params.input.businessName, heroTitle: params.input.heroTitle, strengths: params.input.strengths
        });
        if (!review.approved) allPassed = false;
        notes.push(review.reason);
      } catch (e: any) {
        allPassed = false;
        notes.push('審査を完了できませんでした。');
        void captureError('compliance_review', e, { userId: params.userId, platform: 'x', kind: 'x_weekly_campaign' });
      }
    }
  }

  let autoApproved = false;
  if (params.autoPublishEnabled && allPassed && params.hasConnectedAccount) {
    await Promise.all(plan.posts.map((post, i) =>
      prisma.scheduledPost.create({
        data: { userId: params.userId, text: post.text, platforms: ['x'], scheduledAt: new Date(Date.now() + i * POST_INTERVAL_MS) }
      })
    ));
    autoApproved = true;
  }

  await prisma.agentTask.create({
    data: {
      userId: params.userId, role: params.role, kind: 'x_weekly_campaign', lpId: params.lpId ?? null,
      output: { scenario: plan.scenario, posts: plan.posts, nextStepSuggestion: plan.nextStepSuggestion } as any,
      reviewPassed: allPassed, reviewNote: notes.join(' / ') || null,
      autoApproved, status: autoApproved ? 'approved' : 'pending_review', reviewedAt: autoApproved ? new Date() : null
    }
  });
}
