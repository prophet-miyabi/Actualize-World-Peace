import prisma from '../prisma';
import { RISK_ORDER, type AgentDef } from './registry';
import { emitEvent, TOOL_BY_NAME, type ToolCtx } from './tools';
import { notifyApproval } from './settings';
import { parseFinish, type TaskResult } from './finish';

// エージェントが呼んだ道具を1つ実行する。実行基盤（自前ループ / Claude Platform / 会話）に関係なく、
// 権限（リスクの上限）・承認待ちの作成・finish_task の解釈はここで一元化する
export type ToolExecOpts = {
  agent: AgentDef;
  taskId: string;
  goalId: string | null;
  approvalLabel: string;           // 承認通知に出す件名（タスク名や会話名）
  viaChat?: boolean;
  awaitingNote?: string;           // 承認待ちになったときにエージェントへ返す説明
  onAction?: (action: { id: string; tool: string; reason: string }) => void;
};

export type ToolExecResult = { content: string; pendingApproval: boolean; result?: TaskResult; isError?: boolean };

export async function handleToolUse(name: string, input: any, o: ToolExecOpts): Promise<ToolExecResult> {
  const { agent, taskId } = o;
  if (name === 'finish_task') return { content: '記録しました', pendingApproval: false, result: parseFinish(input) };
  const tool = TOOL_BY_NAME.get(name);
  if (!tool || !agent.tools.includes(tool.name)) {
    return { content: JSON.stringify({ error: `この道具（${name}）は使えません` }), pendingApproval: false, isError: true };
  }
  if (RISK_ORDER[tool.risk] > RISK_ORDER[agent.maxAutoRisk]) {
    const reason = String(input?.reason ?? '').slice(0, 1000) || '（理由なし）';
    const action = await prisma.companyAction.create({ data: { taskId, agent: agent.key, tool: tool.name, input: input as any, reason, risk: tool.risk } });
    await emitEvent('action.requested', agent.key, { actionId: action.id, tool: tool.name, reason, ...(o.viaChat ? { viaChat: true } : {}) }, taskId);
    void notifyApproval(agent.name, tool.name, reason, o.approvalLabel);
    o.onAction?.({ id: action.id, tool: tool.name, reason });
    const note = o.awaitingNote ?? 'この操作は人間の承認が必要です。承認されると実行され、結果は新しいタスクとして届きます。finish_task の blocked に書いて終えてください';
    return { content: JSON.stringify({ status: 'awaiting_human_approval', actionId: action.id, note }), pendingApproval: true };
  }
  const ctx: ToolCtx = { agent, taskId, goalId: o.goalId };
  try {
    const out = await tool.run(input, ctx);
    await emitEvent('tool.called', agent.key, { tool: tool.name, ...(o.viaChat ? { viaChat: true } : {}) }, taskId);
    return { content: JSON.stringify(out ?? null).slice(0, 60_000), pendingApproval: false };
  } catch (e: any) {
    return { content: JSON.stringify({ error: String(e?.message ?? e).slice(0, 500) }), pendingApproval: false, isError: true };
  }
}
