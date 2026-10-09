import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import prisma from '../prisma';
import { createAnthropic } from '../lib/anthropic';

// 監視・障害対応担当エージェント：記録されたエラー（backend/src/lib/errors.ts）を分析し、
// 「原因と直し方」を人（運営者）に提示するところまでを担当する。
// コードの自動修正・本番への自動デプロイ・ロールバックの自動実行は行わない
// （本番環境への変更は人が確認のうえ自分で行う。human on the loopの原則）。

const DiagnosisSchema = z.object({
  rootCause: z.string().describe('推測される根本原因。日本語で2〜3文以内の簡潔な説明にすること'),
  suggestedFix: z.string().describe('人が確認・適用するための修正方針。日本語で3〜4文以内、箇条書きにはしない'),
  severity: z.enum(['low', 'medium', 'high']).describe('影響の大きさ（例: 単発の外部API失敗はlow、認証全体が壊れる場合はhigh）')
});

const MAX_PER_RUN = 5;

export async function diagnoseOpenErrors(): Promise<number> {
  if (!process.env.ANTHROPIC_API_KEY) return 0;

  const errors = await prisma.systemError.findMany({
    where: { status: 'open' },
    orderBy: { createdAt: 'asc' },
    take: MAX_PER_RUN
  });
  if (errors.length === 0) return 0;

  const client = createAnthropic();
  let diagnosed = 0;

  for (const error of errors) {
    try {
      const response = await client.beta.messages.parse({
        model: process.env.CLAUDE_MODEL || 'claude-opus-5',
        max_tokens: 2048,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system:
          'あなたはNode.js/TypeScript（Express, Prisma/PostgreSQL, Next.js）で作られたSaaSの' +
          '監視・障害対応担当です。渡されたエラーの発生元・メッセージ・スタックトレースから、' +
          '根本原因と修正方針を推測してください。実際にコードを書き換えるのではなく、' +
          '運営者が確認して自分で直すための「診断結果」を作成してください。',
        messages: [{
          role: 'user',
          content: `発生元: ${error.source}\nメッセージ: ${error.message}\n` +
            `スタックトレース:\n${(error.stack || '（なし）').slice(0, 3000)}\n` +
            `付随情報: ${JSON.stringify(error.context ?? {}).slice(0, 1000)}`
        }],
        output_config: { effort: 'medium', format: betaZodOutputFormat(DiagnosisSchema) }
      });

      if (response.stop_reason === 'max_tokens') {
        console.error('monitoring agent diagnosis truncated (max_tokens)', error.id);
        continue;
      }
      const out = response.parsed_output;
      if (response.stop_reason === 'refusal' || !out) continue;

      const diagnosis = `【原因】${out.rootCause}\n【修正方針】${out.suggestedFix}\n【重大度】${out.severity}`;
      await prisma.systemError.update({ where: { id: error.id }, data: { status: 'diagnosed', diagnosis } });
      diagnosed++;
    } catch (e: any) {
      console.error('monitoring agent diagnosis failed', error.id, e?.message);
    }
  }
  return diagnosed;
}
