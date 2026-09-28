import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';

// コンプライアンス担当エージェント：他のエージェントが作った投稿下書きを、
// 実際に公開する前に審査する「意思決定ポイント」に特化したエージェント。
// マーケティング担当より高精度なClaudeを使う（安全性に直結する判断のため、コストより精度を優先）。
// ここを通過し、かつ本人がautoPublishEnabledを有効にしている場合だけ、人間の承認なしで自動投稿される。

const ReviewSchema = z.object({
  approved: z.boolean().describe('公開して問題ないか（事実に基づき、誇張・虚偽・過度な表現がないか）'),
  reason: z.string().describe('判断理由。却下した場合は具体的な問題点、承認した場合は簡潔な確認内容')
});

export type ComplianceInput = {
  platform: string;
  text: string;
  businessName: string;
  heroTitle: string;
  strengths: string[];
};

export type ComplianceResult = { approved: boolean; reason: string };

export async function reviewSocialDraft(input: ComplianceInput): Promise<ComplianceResult> {
  const facts = [
    `事業名: ${input.businessName}`,
    `キャッチコピー: ${input.heroTitle}`,
    `登録済みの強み: ${input.strengths.filter(Boolean).join(' / ')}`
  ].join('\n');

  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: process.env.CLAUDE_MODEL || 'claude-opus-5',
    max_tokens: 1024,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'あなたは中小事業者のSNS投稿を、実際に公開する前に審査するコンプライアンス担当です。' +
      '厳格に、かつ機械的にではなく実務的に判断してください。以下のいずれかに該当する場合は却下（approved=false）してください。\n' +
      '- 【登録済みの事実】に含まれていない実績・数字・受賞歴・限定オファー・キャンペーン・日付が書かれている\n' +
      '- 「No.1」「最高」「業界随一」など、根拠のない誇張表現がある\n' +
      '- 差別的・攻撃的・誤解を招く表現がある\n' +
      '- 医療効果・健康効果を断定するなど、法規制に触れるおそれのある表現がある\n' +
      'これらに該当しなければ承認（approved=true）してください。',
    messages: [{
      role: 'user',
      content: `【登録済みの事実】\n${facts}\n\n【審査対象の投稿文（${input.platform}向け）】\n${input.text}`
    }],
    output_config: { effort: 'low', format: betaZodOutputFormat(ReviewSchema) }
  });

  const out = response.parsed_output;
  if (response.stop_reason === 'refusal' || !out) {
    // 審査自体が失敗した場合は、安全側に倒して却下扱いにする（=人間の確認に回す）
    return { approved: false, reason: '審査を完了できなかったため、人による確認が必要です。' };
  }
  return { approved: out.approved, reason: out.reason.slice(0, 500) };
}
