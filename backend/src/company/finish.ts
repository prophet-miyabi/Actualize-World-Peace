import type Anthropic from '@anthropic-ai/sdk';

// タスクの最後に必ず呼ぶ「報告」の道具。自前ループ（Messages API）と Claude Platform（Managed Agents）の両方で同じ定義を使う
export type TaskResult = { summary: string; facts: string[]; assumptions: string[]; artifacts: string[]; nextActions: string[]; blocked?: string };

export const FINISH_TOOL: Anthropic.Tool = {
  name: 'finish_task',
  description: '仕事を終えるときに必ず呼ぶ。成果を構造化して報告する',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'オーナーがそのまま読める日本語の要約（結論から。5行以内）' },
      facts: { type: 'array', items: { type: 'string' }, description: '道具で確認した事実（出典や取得した数値つき）' },
      assumptions: { type: 'array', items: { type: 'string' }, description: '推測・仮定' },
      artifacts: { type: 'array', items: { type: 'string' }, description: '作った成果物（メモリのキー、実装タスクのキー、作ったタスクのIDなど）' },
      nextActions: { type: 'array', items: { type: 'string' }, description: '次にやるべきこと（誰が）' },
      blocked: { type: 'string', description: '人間の判断や承認で止まっている場合、その内容' }
    },
    required: ['summary', 'facts', 'assumptions', 'artifacts', 'nextActions']
  }
};

// 配列のはずの項目に文字列が来ても落ちないようにする
const arr = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).slice(0, 500)).slice(0, 30);

export function parseFinish(inp: any): TaskResult {
  return {
    summary: String(inp?.summary ?? '').slice(0, 4000),
    facts: arr(inp?.facts), assumptions: arr(inp?.assumptions), artifacts: arr(inp?.artifacts), nextActions: arr(inp?.nextActions),
    blocked: inp?.blocked ? String(inp.blocked).slice(0, 1000) : undefined
  };
}
