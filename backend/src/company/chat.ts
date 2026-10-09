import Anthropic from '@anthropic-ai/sdk';
import prisma from '../prisma';
import { describeAiError } from '../lib/aiUsage';
import { AGENT_BY_KEY, COMPANY_RULES, STRONG_MODEL } from './registry';
import { toolsForAgent } from './tools';
import { agentConfig, buildAgentContext, cachedMessages, cachedSystem, cachedTools, inputTokensOf, isUnknownModelError, MAX_ROUNDS, monthlyCapUsd, spentThisMonthUsd, usageCostUsd } from './runtime';
import { handleToolUse } from './toolExec';
import { phraseFor } from './activity';
import { createAnthropic } from '../lib/anthropic';

// 運営者とエージェントの会話（管理画面のチャット）。
// エージェントは人間のオーナーと直接やり取りしながら、通常のタスクと同じ権限・同じリスク判定で道具を使って実行する。
// 高リスクの操作は承認待ち（CompanyAction）になり、画面に承認ボタンが出る。文字が届くたびに emit する（SSE）
export type ChatEvent =
  | { type: 'status'; phase: 'thinking' | 'tool' | 'reporting' | 'done'; text: string }
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
  const client = createAnthropic();
  let inputTokens = 0, outputTokens = 0, toolCalls = 0, costUsd = 0;
  const sys = cachedSystem(system);
  const allTools = cachedTools([...toolDefs, ...serverTools]);
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let msg: Anthropic.Message;
      emit({ type: 'status', phase: 'thinking', text: phraseFor(agent.key, 'thinking', {}) });
      try {
        const stream = client.messages.stream({ model: cfg.model, max_tokens: 4096, system: sys, tools: allTools as any, messages: cachedMessages(messages) });
        stream.on('text', (delta) => emit({ type: 'text', text: delta }));
        msg = await stream.finalMessage();
      } catch (e: any) {
        if (!isUnknownModelError(e) || cfg.model === STRONG_MODEL) throw e;
        cfg.model = STRONG_MODEL;
        round--; continue;
      }
      inputTokens += inputTokensOf(msg.usage);
      outputTokens += msg.usage.output_tokens;
      costUsd += usageCostUsd(msg.usage, cfg.model);
      messages.push({ role: 'assistant', content: msg.content });
      const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || uses.length === 0) break;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        toolCalls++;
        emit({ type: 'tool', name: u.name });
        emit({ type: 'status', phase: 'tool', text: phraseFor(agent.key, 'tool', { tool: u.name }) });
        const h = await handleToolUse(u.name, u.input, {
          agent, taskId, goalId: null, approvalLabel: `会話: ${chat.title}`, viaChat: true,
          awaitingNote: 'この操作は人間の承認が必要です。画面に承認ボタンが表示されています。承認を待っていることを伝えてください',
          onAction: (a) => emit({ type: 'action', id: a.id, tool: a.tool, reason: a.reason })
        });
        results.push({ type: 'tool_result', tool_use_id: u.id, content: h.content });
      }
      messages.push({ role: 'user', content: results });
    }
    await prisma.agentRun.update({ where: { id: run.id }, data: { inputTokens, outputTokens, toolCalls, costUsd, status: 'ok', finishedAt: new Date() } });
    await prisma.companyChat.update({ where: { id: chatId }, data: { costUsd: { increment: costUsd } } });
    emit({ type: 'done', costUsd });
  } catch (e: any) {
    await prisma.agentRun.update({ where: { id: run.id }, data: { inputTokens, outputTokens, toolCalls, status: 'error', error: String(e?.message ?? e).slice(0, 500), finishedAt: new Date() } });
    emit({ type: 'error', message: describeAiError(e) });
  }
}
