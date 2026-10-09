import Anthropic from '@anthropic-ai/sdk';
import prisma from '../prisma';
import { AGENT_BY_KEY, COMPANY_RULES, RISK_ORDER } from './registry';
import { emitEvent, toolsForAgent, TOOL_BY_NAME, type ToolCtx } from './tools';
import { agentConfig, buildAgentContext, MAX_ROUNDS, monthlyCapUsd, priceFor, SEARCH_COST_USD, spentThisMonthUsd } from './runtime';
import { notifyApproval } from './settings';

// 運営者とエージェントの会話（管理画面のチャット）。
// エージェントは人間のオーナーと直接やり取りしながら、通常のタスクと同じ権限・同じリスク判定で道具を使って実行する。
// 高リスクの操作は承認待ち（CompanyAction）になり、画面に承認ボタンが出る。文字が届くたびに emit する（SSE）
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'action'; id: string; tool: string; reason: string }
  | { type: 'done'; costUsd: number }
  | { type: 'error'; message: string };

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export async function chatWithAgent(agentKey: string, history: ChatTurn[], chatId: string, emit: (e: ChatEvent) => void) {
  const agent = AGENT_BY_KEY.get(agentKey);
  if (!agent) throw new Error('エージェントが見つかりません');
  const cfg = await agentConfig(agent);
  if ((await spentThisMonthUsd()) >= (await monthlyCapUsd())) throw new Error('今月の会社のAI費用の上限に達しています');

  // 会話の中で作る操作・タスクの親になるタスク（会話ごとに1つ。追跡のため）
  const chat = await prisma.companyChat.findUnique({ where: { id: chatId } });
  if (!chat) throw new Error('会話が見つかりません');
  let taskId = chat.taskId;
  if (!taskId) {
    const goal = await prisma.companyGoal.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });
    const t = await prisma.companyTask.create({
      data: { goalId: goal?.id ?? null, assignee: agent.key, createdBy: 'human', title: `会話: ${chat.title}`.slice(0, 120), instructions: '運営者との会話（管理画面のチャット）', status: 'done', risk: 'low' }
    });
    taskId = t.id;
    await prisma.companyChat.update({ where: { id: chatId }, data: { taskId } });
  }
  const ctx: ToolCtx = { agent, taskId, goalId: null };
  const tools = toolsForAgent(agent);
  const toolDefs: Anthropic.Tool[] = tools.map((t) => ({ name: t.name, description: `${t.description}（リスク: ${t.risk}）`, input_schema: t.input_schema }));
  const serverTools: any[] = agent.webSearch && process.env.COMPANY_WEB_SEARCH !== 'false' ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] : [];

  const context = await buildAgentContext(agent);
  const system = [
    COMPANY_RULES,
    `\n【あなたの役割: ${agent.name}（${agent.department}）】\n${agent.mission}`,
    context,
    `\n【いまの状況】あなたは人間のオーナー（運営者）と直接会話しています。依頼されたことは道具で実際に実行し、何をしたか・結果・次にできることを短く報告してください。やっていないことを「やった」と言わない。` +
      `自動で実行できるのはリスク ${agent.maxAutoRisk} まで。それを超える道具は「承認待ち」になるので、承認を待っていることを伝えてください。今日は ${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}（JST）。`
  ].join('\n');

  const messages: Anthropic.MessageParam[] = history.slice(-30).map((m) => ({ role: m.role, content: m.content }));
  const run = await prisma.agentRun.create({ data: { agent: agent.key, taskId, model: cfg.model, status: 'ok' } });
  const client = new Anthropic();
  let inputTokens = 0, outputTokens = 0, toolCalls = 0, searches = 0;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const stream = client.messages.stream({ model: cfg.model, max_tokens: 4096, system, tools: [...toolDefs, ...serverTools], messages });
      stream.on('text', (delta) => emit({ type: 'text', text: delta }));
      const msg = await stream.finalMessage();
      inputTokens += msg.usage.input_tokens + ((msg.usage as any).cache_read_input_tokens ?? 0) + ((msg.usage as any).cache_creation_input_tokens ?? 0);
      outputTokens += msg.usage.output_tokens;
      searches += (msg.usage as any).server_tool_use?.web_search_requests ?? 0;
      messages.push({ role: 'assistant', content: msg.content });
      const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || uses.length === 0) break;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        toolCalls++;
        emit({ type: 'tool', name: u.name });
        const tool = TOOL_BY_NAME.get(u.name);
        let content: string;
        if (!tool || !agent.tools.includes(tool.name)) {
          content = JSON.stringify({ error: `この道具（${u.name}）は使えません` });
        } else if (RISK_ORDER[tool.risk] > RISK_ORDER[agent.maxAutoRisk]) {
          const reason = String((u.input as any)?.reason ?? '').slice(0, 1000) || '（理由なし）';
          const action = await prisma.companyAction.create({ data: { taskId, agent: agent.key, tool: tool.name, input: u.input as any, reason, risk: tool.risk } });
          await emitEvent('action.requested', agent.key, { actionId: action.id, tool: tool.name, reason, viaChat: true }, taskId);
          void notifyApproval(agent.name, tool.name, reason, `会話: ${chat.title}`);
          emit({ type: 'action', id: action.id, tool: tool.name, reason });
          content = JSON.stringify({ status: 'awaiting_human_approval', actionId: action.id, note: 'この操作は人間の承認が必要です。画面に承認ボタンが表示されています。承認を待っていることを伝えてください' });
        } else {
          try {
            const out = await tool.run(u.input, ctx);
            content = JSON.stringify(out ?? null).slice(0, 60_000);
            await emitEvent('tool.called', agent.key, { tool: tool.name, viaChat: true }, taskId);
          } catch (e: any) {
            content = JSON.stringify({ error: String(e?.message ?? e).slice(0, 500) });
          }
        }
        results.push({ type: 'tool_result', tool_use_id: u.id, content });
      }
      messages.push({ role: 'user', content: results });
    }
    const p = priceFor(cfg.model);
    const costUsd = (inputTokens * p.in + outputTokens * p.out) / 1_000_000 + searches * SEARCH_COST_USD;
    await prisma.agentRun.update({ where: { id: run.id }, data: { inputTokens, outputTokens, toolCalls, costUsd, status: 'ok', finishedAt: new Date() } });
    await prisma.companyChat.update({ where: { id: chatId }, data: { costUsd: { increment: costUsd } } });
    emit({ type: 'done', costUsd });
  } catch (e: any) {
    await prisma.agentRun.update({ where: { id: run.id }, data: { inputTokens, outputTokens, toolCalls, status: 'error', error: String(e?.message ?? e).slice(0, 500), finishedAt: new Date() } });
    emit({ type: 'error', message: String(e?.message ?? e).slice(0, 300) });
  }
}
