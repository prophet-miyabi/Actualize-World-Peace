import { AsyncLocalStorage } from 'async_hooks';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../prisma';
import { aiAllowanceUsd } from './plans';
import { createAnthropic } from './anthropic';

// AIの利用量の計測と、プランごとの月の利用枠の管理。
// 利用者の操作から始まる処理を runAsUser() で包むと、その中で aiClient() を通したClaudeの呼び出しのトークン数を
// 自動で記録する（あとから裏で続く処理 = デザイン作成なども同じ利用者として数える）。
// 料金は公開価格（100万トークンあたりの米ドル）からの見積もり。AI_PRICE_JSON で上書きできる
type Ctx = { userId: string; feature: string };
const als = new AsyncLocalStorage<Ctx>();

const DEFAULT_PRICES: Record<string, { in: number; out: number }> = {
  opus: { in: 5, out: 25 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 1, out: 5 }
};
function pricesFor(model: string) {
  let table = DEFAULT_PRICES;
  try {
    if (process.env.AI_PRICE_JSON) table = { ...DEFAULT_PRICES, ...JSON.parse(process.env.AI_PRICE_JSON) };
  } catch { /* 既定値を使う */ }
  const key = Object.keys(table).find((k) => model.includes(k)) ?? 'opus';
  return table[key];
}

// APIキーが使える形か（表示用にマスクされた「sk-ant-a••••」などをそのまま貼ると、非ASCII文字が混ざって送信時に失敗する）
export function anthropicKeyProblem(): string | null {
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) return 'ANTHROPIC_API_KEY が未設定です';
  const bad = key.split('').findIndex((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 33);
  if (bad >= 0) return `ANTHROPIC_API_KEY に使えない文字（${bad + 1}文字目「${key[bad]}」）が含まれています。Console で表示される「•」で隠されたキーではなく、作成時に表示された完全なキーを Render に入れ直してください`;
  if (!key.startsWith('sk-ant-')) return 'ANTHROPIC_API_KEY の形式が正しくありません（sk-ant- で始まるキー）';
  return null;
}

// AIの呼び出しで起きたエラーを、運営者がそのまま読める日本語にする
export function describeAiError(e: any): string {
  const msg = String(e?.message ?? e ?? '');
  if (/ByteString/.test(msg)) return anthropicKeyProblem() ?? 'APIキーに使えない文字が含まれています';
  if (/anthropic-workspace-id|not scoped to a workspace/i.test(msg)) return 'APIキーがワークスペースに紐づいていません。直し方は2つ: (A) Console の左上でワークスペース（Default など）を選んでから「キーを作成」し、そのキーを Render の ANTHROPIC_API_KEY に入れる / (B) Render に ANTHROPIC_WORKSPACE_ID を追加する（Console → 組織の設定 → ワークスペース → 使うワークスペースの ID。wrkspc_ で始まる）';
  if (e?.status === 401) return 'APIキーが無効です（Render の ANTHROPIC_API_KEY を確認してください）';
  if (e?.status === 429) return 'AIのレート制限に達しました。少し待ってからお試しください';
  if (e?.status === 402 || /credit balance/i.test(msg)) return 'AIのクレジット残高がありません（Console でクレジットを追加するか、Max プランのクレジットをリンクしてください）';
  return msg.slice(0, 300);
}

export class AiQuotaError extends Error {
  constructor() {
    super('今月のAIの利用枠を使い切りました。プランを上げると、すぐに使えるようになります。');
  }
}

export function runAsUser<T>(userId: string, feature: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ userId, feature }, fn);
}

function monthStartJst() {
  const now = new Date(Date.now() + 9 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 9 * 3600_000);
}

export async function monthUsageUsd(userId: string) {
  const agg = await prisma.aiUsage.aggregate({ where: { userId, createdAt: { gte: monthStartJst() } }, _sum: { costUsd: true } });
  return agg._sum.costUsd ?? 0;
}

export async function aiQuota(userId: string) {
  const [used, allowance] = await Promise.all([monthUsageUsd(userId), aiAllowanceUsd(userId)]);
  return { usedUsd: used, allowanceUsd: allowance, remainingUsd: Math.max(0, allowance - used), exceeded: used >= allowance };
}

// AIを使う前に呼ぶ。今月の利用枠を超えていたら AiQuotaError
export async function assertAiAllowance(userId: string) {
  if ((await aiQuota(userId)).exceeded) throw new AiQuotaError();
}

export async function recordAiCost(feature: string, model: string, costUsd: number, tokens: { input?: number; output?: number } = {}) {
  const ctx = als.getStore();
  if (!ctx) return;
  await prisma.aiUsage.create({
    data: { userId: ctx.userId, feature: ctx.feature || feature, model, inputTokens: tokens.input ?? 0, outputTokens: tokens.output ?? 0, costUsd }
  }).catch(() => {});
}

// 利用量を自動で記録する Claude クライアント（応答の usage を読み取る）
export function aiClient() {
  return createAnthropic({
    fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(url, init);
      const ctx = als.getStore();
      if (ctx && res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
        res.clone().json().then((j: any) => {
          if (!j?.usage || !j?.model) return;
          const p = pricesFor(String(j.model));
          const input = (j.usage.input_tokens ?? 0) + (j.usage.cache_creation_input_tokens ?? 0) + (j.usage.cache_read_input_tokens ?? 0);
          const output = j.usage.output_tokens ?? 0;
          void recordAiCost('claude', String(j.model), (input * p.in + output * p.out) / 1_000_000, { input, output });
        }).catch(() => {});
      }
      return res;
    }
  });
}

// ルートに付けるミドルウェア: このリクエストの中で使ったAIを、ログイン中の本人の利用として数える。
// block = true なら、今月の利用枠を超えているときは 402 で止める（ページ作成など止めたくない処理は false）
export function metered(feature: string, block = true) {
  return async (req: any, res: any, next: (err?: unknown) => void) => {
    const userId = req.user?.id as string | undefined;
    if (!userId) return next();
    if (block) {
      const q = await aiQuota(userId);
      if (q.exceeded) return res.status(402).json({ error: new AiQuotaError().message, quota: q, upgradeUrl: '/plans' });
    }
    als.run({ userId, feature }, () => next());
  };
}
