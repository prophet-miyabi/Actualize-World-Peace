import Anthropic from '@anthropic-ai/sdk';
import prisma from '../prisma';
import { describeAiError } from '../lib/aiUsage';
import { AGENT_BY_KEY, COMPANY_RULES, RISK_ORDER, STRONG_MODEL, type AgentDef } from './registry';
import { emitEvent, toolsForAgent, TOOL_BY_NAME } from './tools';
import { getCompanySettings } from './settings';
import { createAnthropic } from '../lib/anthropic';

// エージェントの実行基盤（ハーネス）。1つのタスクにつき:
//   システムプロンプト（会社の決まり + 役割 + 読めるメモリの一覧）→ Claude の道具ループ → finish_task で成果を構造化して保存。
// 道具のリスクが役割の上限を超えるときは実行せず CompanyAction（人間の承認待ち）を作る。
// 利用量は AgentRun に記録し、1日の予算を超えたエージェントはその日は動かない
export const MAX_ROUNDS = 12;
const PRICES: Record<string, { in: number; out: number }> = { opus: { in: 5, out: 25 }, sonnet: { in: 3, out: 15 }, haiku: { in: 1, out: 5 } };
export const SEARCH_COST_USD = 0.01;

// プロンプトキャッシュ: 書き込みは入力単価の1.25倍、読み出しは0.1倍。
// システムプロンプト・道具の定義・会話の履歴は毎回同じ前置きなので、キャッシュに乗せると入力の費用が大きく減る
export function usageCostUsd(usage: any, model: string) {
  const p = priceFor(model);
  const plain = usage?.input_tokens ?? 0;
  const write = usage?.cache_creation_input_tokens ?? 0;
  const read = usage?.cache_read_input_tokens ?? 0;
  const out = usage?.output_tokens ?? 0;
  const searches = usage?.server_tool_use?.web_search_requests ?? 0;
  return (plain * p.in + write * p.in * 1.25 + read * p.in * 0.1 + out * p.out) / 1_000_000 + searches * SEARCH_COST_USD;
}
export function inputTokensOf(usage: any) {
  return (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0);
}
const EPHEMERAL = { type: 'ephemeral' as const };
export function cachedSystem(system: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text: system, cache_control: EPHEMERAL }];
}
export function cachedTools<T extends Record<string, any>>(tools: T[]): T[] {
  if (tools.length === 0) return tools;
  return tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: EPHEMERAL } : t));
}
// 最後のメッセージにだけキャッシュの区切りを付けた複製を返す（元の配列は変えない。区切りは最大4つまでなので毎回付け直す）
export function cachedMessages(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  const content: any[] = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : [...(last.content as any[])];
  if (content.length === 0) return messages;
  content[content.length - 1] = { ...content[content.length - 1], cache_control: EPHEMERAL };
  return [...messages.slice(0, -1), { role: last.role, content }];
}
// モデルIDが存在しない（404）ときは強いモデルに切り替えて続ける
export function isUnknownModelError(e: any) {
  return e?.status === 404 && /model/i.test(String(e?.error?.error?.message ?? e?.message ?? ''));
}

import { FINISH_TOOL, parseFinish, type TaskResult } from './finish';
import { handleToolUse, type ToolExecOpts } from './toolExec';
import { consoleSessionUrl, ensureManagedAgent, managedEnabled, runManagedSession } from './managed';
import { endActivity, startActivity, updateActivity } from './activity';
export type { TaskResult };

export function priceFor(model: string) {
  const k = Object.keys(PRICES).find((p) => model.includes(p)) ?? 'opus';
  return PRICES[k];
}

export async function agentConfig(agent: AgentDef) {
  const c = await prisma.companyAgentConfig.findUnique({ where: { key: agent.key } });
  return { enabled: c?.enabled ?? true, model: c?.model || agent.model, dailyBudgetUsd: c?.dailyBudgetUsd ?? agent.dailyBudgetUsd };
}

// 会社全体の今月のAI費用の上限（米ドル）。Max プランの月間APIクレジット（$200）を、利用者向けAIの分も残して使うための安全弁
export async function monthlyCapUsd() {
  return (await getCompanySettings()).monthlyCapUsd;
}
export async function spentThisMonthUsd() {
  const now = new Date(Date.now() + 9 * 3600_000);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 9 * 3600_000);
  const agg = await prisma.agentRun.aggregate({ where: { startedAt: { gte: start } }, _sum: { costUsd: true } });
  return agg._sum.costUsd ?? 0;
}

export async function spentTodayUsd(agentKey: string) {
  const today = new Date(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) + 'T00:00:00+09:00');
  const agg = await prisma.agentRun.aggregate({ where: { agent: agentKey, startedAt: { gte: today } }, _sum: { costUsd: true } });
  return agg._sum.costUsd ?? 0;
}

async function memoryIndex(agent: AgentDef) {
  const rows = await prisma.companyMemory.findMany({ where: { scope: { in: agent.memoryRead } }, select: { scope: true, key: true, updatedAt: true, content: true }, orderBy: { updatedAt: 'desc' }, take: 60 });
  return rows.map((r) => `- ${r.scope} / ${r.key}（${r.updatedAt.toISOString().slice(0, 10)}）: ${r.content.replace(/\s+/g, ' ').slice(0, 80)}`).join('\n');
}

async function strategyText() {
  const s = await prisma.companyMemory.findUnique({ where: { scope_key: { scope: 'company', key: 'strategy' } } });
  return s?.content ?? '（戦略メモはまだありません）';
}

// システムプロンプトの共通部分（目標・戦略・読めるメモリの一覧）。タスク実行と会話の両方で使う
export async function buildAgentContext(agent: AgentDef) {
  const [goals, mem, strategy] = await Promise.all([
    prisma.companyGoal.findMany({ where: { status: 'active' }, select: { title: true, kpis: true } }),
    memoryIndex(agent),
    strategyText()
  ]);
  const NL = String.fromCharCode(10);
  return [
    `${NL}【会社の目標】${NL}${goals.map((g) => `- ${g.title} / KPI: ${JSON.stringify(g.kpis)}`).join(NL) || '（未設定）'}`,
    `${NL}【会社の戦略（company/strategy）】${NL}${strategy.slice(0, 6000)}`,
    `${NL}【読めるメモリの一覧（必要なものは read_memory で全文を読む）】${NL}${mem || '（まだありません）'}`
  ].join(NL);
}

export async function runTask(taskId: string): Promise<void> {
  const task = await prisma.companyTask.findUnique({ where: { id: taskId } });
  if (!task || task.status !== 'queued') return;
  const agent = AGENT_BY_KEY.get(task.assignee);
  if (!agent) {
    await prisma.companyTask.update({ where: { id: taskId }, data: { status: 'failed', error: `担当エージェント ${task.assignee} が存在しません` } });
    return;
  }
  const cfg = await agentConfig(agent);
  if (!cfg.enabled) {
    await prisma.companyTask.update({ where: { id: taskId }, data: { runAt: new Date(Date.now() + 6 * 3600_000) } });
    return;
  }
  const cap = await monthlyCapUsd();
  if ((await spentThisMonthUsd()) >= cap) {
    // 会社全体の月の上限に達した: 来月まで休む（翌日に再確認）
    await prisma.companyTask.update({ where: { id: taskId }, data: { runAt: new Date(Date.now() + 24 * 3600_000) } });
    await emitEvent('company.monthly_cap_reached', 'system', { taskId, capUsd: cap });
    return;
  }
  if ((await spentTodayUsd(agent.key)) >= cfg.dailyBudgetUsd) {
    // 予算を使い切った日は翌日に回す
    await prisma.companyTask.update({ where: { id: taskId }, data: { runAt: new Date(Date.now() + 12 * 3600_000) } });
    await emitEvent('agent.budget_exhausted', agent.key, { taskId, budgetUsd: cfg.dailyBudgetUsd });
    return;
  }

  await prisma.companyTask.update({ where: { id: taskId }, data: { status: 'running', startedAt: new Date(), attempts: { increment: 1 } } });
  const run = await prisma.agentRun.create({ data: { agent: agent.key, taskId, model: cfg.model, status: 'ok' } });
  await emitEvent('task.started', agent.key, { title: task.title }, taskId);
  await startActivity({ taskId, agent: agent.key, task: task.title });

  const tools = toolsForAgent(agent);
  const toolDefs: Anthropic.Tool[] = [...tools.map((t) => ({ name: t.name, description: `${t.description}（リスク: ${t.risk}）`, input_schema: t.input_schema })), FINISH_TOOL];
  const serverTools: any[] = agent.webSearch && process.env.COMPANY_WEB_SEARCH !== 'false' ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] : [];

  const [goals, mem, strategy, parent] = await Promise.all([
    prisma.companyGoal.findMany({ where: { status: 'active' }, select: { title: true, kpis: true } }),
    memoryIndex(agent),
    strategyText(),
    task.parentId ? prisma.companyTask.findUnique({ where: { id: task.parentId }, select: { title: true, assignee: true, result: true } }) : null
  ]);
  // タスクごとに変わる状況（目標・戦略・メモリの一覧・日付）。自前ループでは system に、Platform では最初のメッセージに入れる
  const situation = [
    `【会社の目標】\n${goals.map((g) => `- ${g.title} / KPI: ${JSON.stringify(g.kpis)}`).join('\n') || '（未設定）'}`,
    `\n【会社の戦略（company/strategy）】\n${strategy.slice(0, 6000)}`,
    `\n【読めるメモリの一覧（必要なものは read_memory で全文を読む）】\n${mem || '（まだありません）'}`,
    `\n今日は ${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}（JST）。`
  ].join('\n');
  const system = [
    COMPANY_RULES,
    `\n【あなたの役割: ${agent.name}（${agent.department}）】\n${agent.mission}`,
    agent.outputRules ? `\n【出力の決まり】\n${agent.outputRules}` : '',
    `\n${situation}`,
    `\n【権限】自動で実行できるのはリスク ${agent.maxAutoRisk} まで。それを超える道具は「人間の承認待ち」になり、結果はあとで届く。承認待ちになったら finish_task の blocked に書いて終える。`,
    `道具の呼び出しは最大${MAX_ROUNDS}回。`
  ].join('\n');
  const taskText = `【タスク】${task.title}\n\n【指示】\n${task.instructions}${parent ? `\n\n【このタスクを作った上位タスク】${parent.title}（${parent.assignee}）` : ''}\n\n終わったら finish_task を呼んでください。`;
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: taskText }];
  const execOpts: ToolExecOpts = { agent, taskId, goalId: task.goalId, approvalLabel: task.title };

  let inputTokens = 0, outputTokens = 0, toolCalls = 0, costUsd = 0;
  let result: TaskResult | null = null;
  let pendingApproval = false;
  let engine: 'messages' | 'managed' = 'messages';
  let sessionId: string | null = null;
  try {
    // ---- 実行基盤1: Claude Platform（Managed Agents）。定義は版管理され、ループ・圧縮・予算は Platform が受け持つ ----
    if (managedEnabled()) {
      try {
        const m = await ensureManagedAgent(agent);
        if (!m.id || !m.version) throw new Error('Managed Agent の同期に失敗しました');
        const remaining = Math.max(0.5, Math.min(cfg.dailyBudgetUsd - (await spentTodayUsd(agent.key)), cap - (await spentThisMonthUsd())));
        const r = await runManagedSession({
          agent, managedAgentId: m.id, managedVersion: m.version,
          title: `${agent.name}: ${task.title}`.slice(0, 120),
          message: `${taskText}\n\n【状況】\n${situation}`,
          budgetUsd: remaining,
          metadata: { awp_task: taskId, awp_agent: agent.key },
          onSessionCreated: async (id) => {
            sessionId = id;
            await prisma.agentRun.update({ where: { id: run.id }, data: { engine: 'managed', sessionId: id } });
          },
          onActivity: (phase, tool) => updateActivity(taskId, phase, { tool }),
          onToolUse: async (name, input, fromKey) => {
            // マルチエージェント: 専門職のスレッドからの道具呼び出しは、その専門職の権限で実行する（finish_task はコーディネータのもの）
            const sub = fromKey ? AGENT_BY_KEY.get(fromKey) : undefined;
            const opts: ToolExecOpts = sub ? { ...execOpts, agent: sub, approvalLabel: `${task.title}（${sub.name} 経由）` } : execOpts;
            if (sub && name === 'finish_task') return { content: JSON.stringify({ note: '専門職は finish_task を使わない。結果はコーディネータへのメッセージで返すこと' }), isError: true };
            const h = await handleToolUse(name, input, opts);
            if (h.pendingApproval) updateActivity(taskId, 'waiting_approval');
            return { content: h.content, isError: h.isError, result: h.result, pendingApproval: h.pendingApproval };
          }
        });
        engine = 'managed';
        sessionId = r.sessionId; result = r.result; pendingApproval = r.pendingApproval;
        toolCalls = r.toolCalls; inputTokens = r.inputTokens; outputTokens = r.outputTokens; costUsd = r.costUsd;
        if (!result) result = { summary: r.lastText.slice(0, 2000) || `（報告なし: ${r.stopReason}${r.errors.length ? ' / ' + r.errors.join(' / ') : ''}）`, facts: [], assumptions: [], artifacts: [], nextActions: [] };
        if (r.stopReason === 'budget_reached') await emitEvent('agent.session_budget_reached', agent.key, { sessionId: r.sessionId, budgetUsd: remaining }, taskId);
        if (r.errors.length) await emitEvent('agent.session_warning', agent.key, { sessionId: r.sessionId, errors: r.errors.slice(0, 3) }, taskId);
      } catch (e: any) {
        // セッションが始まった後の失敗は、二重実行を避けるためそのまま失敗にする。始まる前（同期や作成の失敗）は自前ループに切り替える
        if (sessionId) throw e;
        await emitEvent('agent.engine_fallback', agent.key, { from: 'managed', to: 'messages', error: String(e?.error?.error?.message ?? e?.message ?? e).slice(0, 300) }, taskId);
      }
    }

    // ---- 実行基盤2: 自前ループ（Messages API）。Platform が使えないときの退路 ----
    if (engine === 'messages') {
      const client = createAnthropic();
      const sys = cachedSystem(system);
      const allTools = cachedTools([...toolDefs, ...serverTools]);
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let msg: Anthropic.Message;
        updateActivity(taskId, 'thinking');
        try {
          msg = await client.messages.create({ model: cfg.model, max_tokens: 4096, system: sys, tools: allTools as any, messages: cachedMessages(messages) });
        } catch (e: any) {
          if (!isUnknownModelError(e) || cfg.model === STRONG_MODEL) throw e;
          await emitEvent('agent.model_fallback', agent.key, { from: cfg.model, to: STRONG_MODEL }, taskId);
          cfg.model = STRONG_MODEL;
          await prisma.agentRun.update({ where: { id: run.id }, data: { model: cfg.model } });
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
          updateActivity(taskId, u.name === 'finish_task' ? 'reporting' : 'tool', { tool: u.name });
          const h = await handleToolUse(u.name, u.input, execOpts);
          if (h.result) result = h.result;
          if (h.pendingApproval) { pendingApproval = true; updateActivity(taskId, 'waiting_approval'); }
          results.push({ type: 'tool_result', tool_use_id: u.id, content: h.content });
        }
        messages.push({ role: 'user', content: results });
        if (result) break;
      }
      if (!result) {
        // finish_task を呼ばずに終わった: もう1回だけ、報告だけを求める
        try {
          messages.push({ role: 'user', content: '道具の呼び出しはここまでです。いまわかっていることで finish_task を呼び、報告してください。' });
          const fin = await client.messages.create({ model: cfg.model, max_tokens: 2048, system: sys, tools: [FINISH_TOOL], tool_choice: { type: 'tool', name: 'finish_task' }, messages: cachedMessages(messages) });
          inputTokens += inputTokensOf(fin.usage); outputTokens += fin.usage.output_tokens; costUsd += usageCostUsd(fin.usage, cfg.model);
          const u = fin.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
          if (u) result = parseFinish(u.input);
        } catch { /* 下の素の要約に進む */ }
      }
      if (!result) {
        // それでも報告がない: 最後の文章を要約として残す
        const last = messages[messages.length - 1];
        const txt = typeof last.content === 'string' ? last.content : (last.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        result = { summary: txt.slice(0, 2000) || '（報告なし）', facts: [], assumptions: [], artifacts: [], nextActions: [] };
      }
    }

    const final: TaskResult = result ?? { summary: '（報告なし）', facts: [], assumptions: [], artifacts: [], nextActions: [] };
    await prisma.agentRun.update({ where: { id: run.id }, data: { inputTokens, outputTokens, toolCalls, costUsd, engine, sessionId, status: 'ok', finishedAt: new Date() } });
    // 自己点検は監査しない（点検そのものの費用を増やさないため）
    const isSelftest = task.title.startsWith('自己点検:');
    const needsVerification = !isSelftest && ((RISK_ORDER[task.risk as keyof typeof RISK_ORDER] ?? 0) >= 1 || final.artifacts.length > 0);
    await prisma.companyTask.update({
      where: { id: taskId },
      data: { status: pendingApproval ? 'awaiting_approval' : needsVerification && agent.key !== 'auditor' ? 'verifying' : 'done', result: final as any, costUsd: { increment: costUsd }, finishedAt: new Date() }
    });
    await emitEvent(pendingApproval ? 'task.awaiting_approval' : 'task.finished', agent.key, { title: task.title, costUsd, toolCalls, engine, sessionId, summary: final.summary.slice(0, 300) }, taskId);
    await endActivity(taskId, { status: pendingApproval ? 'waiting_approval' : 'done', summary: final.summary, costUsd, toolCalls, sessionUrl: sessionId ? consoleSessionUrl(sessionId) : null });
  } catch (e: any) {
    await endActivity(taskId, { status: 'failed', summary: describeAiError(e), costUsd, toolCalls, sessionUrl: sessionId ? consoleSessionUrl(sessionId) : null });
    await prisma.agentRun.update({ where: { id: run.id }, data: { inputTokens, outputTokens, toolCalls, costUsd, engine, sessionId, status: 'error', error: String(e?.message ?? e).slice(0, 500), finishedAt: new Date() } });
    const retry = task.attempts < 2;
    await prisma.companyTask.update({ where: { id: taskId }, data: { status: retry ? 'queued' : 'failed', error: describeAiError(e).slice(0, 500), runAt: new Date(Date.now() + 30 * 60_000) } });
    await emitEvent('task.error', agent.key, { error: String(e?.message ?? e).slice(0, 300), retry, engine, sessionId }, taskId);
  }
}

// 人間が承認した高リスクの操作を実行し、依頼したエージェントに結果を新しいタスクとして返す
export async function executeAction(actionId: string, decidedBy: string) {
  const action = await prisma.companyAction.findUnique({ where: { id: actionId }, include: { task: true } });
  if (!action || action.status !== 'approved') return;
  const agent = AGENT_BY_KEY.get(action.agent);
  const tool = TOOL_BY_NAME.get(action.tool);
  if (!agent || !tool) {
    await prisma.companyAction.update({ where: { id: actionId }, data: { status: 'failed', result: { error: '道具またはエージェントが見つかりません' } } });
    return;
  }
  try {
    const out = await tool.run(action.input, { agent, taskId: action.taskId, goalId: action.task.goalId });
    await prisma.companyAction.update({ where: { id: actionId }, data: { status: 'executed', result: (out ?? null) as any } });
    await emitEvent('action.executed', decidedBy, { actionId, tool: tool.name }, action.taskId);
    await prisma.companyTask.update({ where: { id: action.taskId }, data: { status: 'done' } }).catch(() => {});
    await prisma.companyTask.create({
      data: {
        goalId: action.task.goalId, parentId: action.taskId, assignee: agent.key, createdBy: 'human',
        title: `承認された操作の続き: ${action.task.title}`.slice(0, 120),
        instructions: `あなたが依頼した操作「${tool.name}」が人間に承認され、実行されました。\n結果: ${JSON.stringify(out).slice(0, 3000)}\n\n元のタスクの続きを進め、finish_task で報告してください。`,
        risk: 'low'
      }
    });
  } catch (e: any) {
    await prisma.companyAction.update({ where: { id: actionId }, data: { status: 'failed', result: { error: String(e?.message ?? e).slice(0, 500) } } });
    await emitEvent('action.failed', decidedBy, { actionId, error: String(e?.message ?? e).slice(0, 300) }, action.taskId);
  }
}
