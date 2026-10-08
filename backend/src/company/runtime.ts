import Anthropic from '@anthropic-ai/sdk';
import prisma from '../prisma';
import { AGENT_BY_KEY, COMPANY_RULES, RISK_ORDER, type AgentDef } from './registry';
import { emitEvent, toolsForAgent, TOOL_BY_NAME, type ToolCtx } from './tools';

// エージェントの実行基盤（ハーネス）。1つのタスクにつき:
//   システムプロンプト（会社の決まり + 役割 + 読めるメモリの一覧）→ Claude の道具ループ → finish_task で成果を構造化して保存。
// 道具のリスクが役割の上限を超えるときは実行せず CompanyAction（人間の承認待ち）を作る。
// 利用量は AgentRun に記録し、1日の予算を超えたエージェントはその日は動かない
const MAX_ROUNDS = 12;
const PRICES: Record<string, { in: number; out: number }> = { opus: { in: 5, out: 25 }, sonnet: { in: 3, out: 15 }, haiku: { in: 1, out: 5 } };
const SEARCH_COST_USD = 0.01;

export type TaskResult = { summary: string; facts: string[]; assumptions: string[]; artifacts: string[]; nextActions: string[]; blocked?: string };

const FINISH_TOOL: Anthropic.Tool = {
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

function priceFor(model: string) {
  const k = Object.keys(PRICES).find((p) => model.includes(p)) ?? 'opus';
  return PRICES[k];
}

export async function agentConfig(agent: AgentDef) {
  const c = await prisma.companyAgentConfig.findUnique({ where: { key: agent.key } });
  return { enabled: c?.enabled ?? true, model: c?.model || agent.model, dailyBudgetUsd: c?.dailyBudgetUsd ?? agent.dailyBudgetUsd };
}

// 会社全体の今月のAI費用の上限（米ドル）。Max プランの月間APIクレジット（$200）を、利用者向けAIの分も残して使うための安全弁
export const COMPANY_MONTHLY_CAP_USD = Number(process.env.COMPANY_MONTHLY_CAP_USD || 150);
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
  if ((await spentThisMonthUsd()) >= COMPANY_MONTHLY_CAP_USD) {
    // 会社全体の月の上限に達した: 来月まで休む（翌日に再確認）
    await prisma.companyTask.update({ where: { id: taskId }, data: { runAt: new Date(Date.now() + 24 * 3600_000) } });
    await emitEvent('company.monthly_cap_reached', 'system', { taskId, capUsd: COMPANY_MONTHLY_CAP_USD });
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

  const ctx: ToolCtx = { agent, taskId, goalId: task.goalId };
  const tools = toolsForAgent(agent);
  const toolDefs: Anthropic.Tool[] = [...tools.map((t) => ({ name: t.name, description: `${t.description}（リスク: ${t.risk}）`, input_schema: t.input_schema })), FINISH_TOOL];
  const serverTools: any[] = agent.webSearch && process.env.COMPANY_WEB_SEARCH !== 'false' ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }] : [];

  const [goals, mem, strategy, parent] = await Promise.all([
    prisma.companyGoal.findMany({ where: { status: 'active' }, select: { title: true, kpis: true } }),
    memoryIndex(agent),
    strategyText(),
    task.parentId ? prisma.companyTask.findUnique({ where: { id: task.parentId }, select: { title: true, assignee: true, result: true } }) : null
  ]);
  const system = [
    COMPANY_RULES,
    `\n【あなたの役割: ${agent.name}（${agent.department}）】\n${agent.mission}`,
    agent.outputRules ? `\n【出力の決まり】\n${agent.outputRules}` : '',
    `\n【会社の目標】\n${goals.map((g) => `- ${g.title} / KPI: ${JSON.stringify(g.kpis)}`).join('\n') || '（未設定）'}`,
    `\n【会社の戦略（company/strategy）】\n${strategy.slice(0, 6000)}`,
    `\n【読めるメモリの一覧（必要なものは read_memory で全文を読む）】\n${mem || '（まだありません）'}`,
    `\n【権限】自動で実行できるのはリスク ${agent.maxAutoRisk} まで。それを超える道具は「人間の承認待ち」になり、結果はあとで届く。承認待ちになったら finish_task の blocked に書いて終える。`,
    `\n今日は ${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}（JST）。道具の呼び出しは最大${MAX_ROUNDS}回。`
  ].join('\n');

  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: `【タスク】${task.title}\n\n【指示】\n${task.instructions}${parent ? `\n\n【このタスクを作った上位タスク】${parent.title}（${parent.assignee}）` : ''}\n\n終わったら finish_task を呼んでください。`
  }];

  const client = new Anthropic();
  let inputTokens = 0, outputTokens = 0, toolCalls = 0, searches = 0;
  let result: TaskResult | null = null;
  let pendingApproval = false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const msg = await client.messages.create({ model: cfg.model, max_tokens: 4096, system, tools: [...toolDefs, ...serverTools], messages });
      inputTokens += msg.usage.input_tokens + ((msg.usage as any).cache_read_input_tokens ?? 0) + ((msg.usage as any).cache_creation_input_tokens ?? 0);
      outputTokens += msg.usage.output_tokens;
      searches += (msg.usage as any).server_tool_use?.web_search_requests ?? 0;
      messages.push({ role: 'assistant', content: msg.content });
      const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || uses.length === 0) break;
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const u of uses) {
        toolCalls++;
        if (u.name === 'finish_task') {
          const inp = u.input as any;
          // 配列のはずの項目に文字列が来ても落ちないようにする
          const arr = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).slice(0, 500)).slice(0, 30);
          result = {
            summary: String(inp.summary ?? '').slice(0, 4000),
            facts: arr(inp.facts), assumptions: arr(inp.assumptions), artifacts: arr(inp.artifacts), nextActions: arr(inp.nextActions),
            blocked: inp.blocked ? String(inp.blocked).slice(0, 1000) : undefined
          };
          results.push({ type: 'tool_result', tool_use_id: u.id, content: '記録しました' });
          continue;
        }
        const tool = TOOL_BY_NAME.get(u.name);
        let content: string;
        if (!tool || !agent.tools.includes(tool.name)) {
          content = JSON.stringify({ error: `この道具（${u.name}）は使えません` });
        } else if (RISK_ORDER[tool.risk] > RISK_ORDER[agent.maxAutoRisk]) {
          const reason = String((u.input as any)?.reason ?? '').slice(0, 1000) || '（理由なし）';
          const action = await prisma.companyAction.create({ data: { taskId, agent: agent.key, tool: tool.name, input: u.input as any, reason, risk: tool.risk } });
          await emitEvent('action.requested', agent.key, { actionId: action.id, tool: tool.name, reason }, taskId);
          pendingApproval = true;
          content = JSON.stringify({ status: 'awaiting_human_approval', actionId: action.id, note: 'この操作は人間の承認が必要です。承認されると実行され、結果は新しいタスクとして届きます。finish_task の blocked に書いて終えてください' });
        } else {
          try {
            const out = await tool.run(u.input, ctx);
            content = JSON.stringify(out ?? null).slice(0, 60_000);
            await emitEvent('tool.called', agent.key, { tool: tool.name }, taskId);
          } catch (e: any) {
            content = JSON.stringify({ error: String(e?.message ?? e).slice(0, 500) });
          }
        }
        results.push({ type: 'tool_result', tool_use_id: u.id, content });
      }
      messages.push({ role: 'user', content: results });
      if (result) break;
    }
    if (!result) {
      // finish_task を呼ばずに終わった: もう1回だけ、報告だけを求める
      try {
        messages.push({ role: 'user', content: '道具の呼び出しはここまでです。いまわかっていることで finish_task を呼び、報告してください。' });
        const fin = await client.messages.create({ model: cfg.model, max_tokens: 2048, system, tools: [FINISH_TOOL], tool_choice: { type: 'tool', name: 'finish_task' }, messages });
        inputTokens += fin.usage.input_tokens; outputTokens += fin.usage.output_tokens;
        const u = fin.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        if (u) {
          const inp = u.input as any;
          const arr = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).slice(0, 500)).slice(0, 30);
          result = { summary: String(inp.summary ?? '').slice(0, 4000), facts: arr(inp.facts), assumptions: arr(inp.assumptions), artifacts: arr(inp.artifacts), nextActions: arr(inp.nextActions), blocked: inp.blocked ? String(inp.blocked).slice(0, 1000) : undefined };
        }
      } catch { /* 下の素の要約に進む */ }
    }
    if (!result) {
      // それでも報告がない: 最後の文章を要約として残す
      const last = messages[messages.length - 1];
      const txt = typeof last.content === 'string' ? last.content : (last.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      result = { summary: txt.slice(0, 2000) || '（報告なし）', facts: [], assumptions: [], artifacts: [], nextActions: [] };
    }
    const p = priceFor(cfg.model);
    const costUsd = (inputTokens * p.in + outputTokens * p.out) / 1_000_000 + searches * SEARCH_COST_USD;
    await prisma.agentRun.update({ where: { id: run.id }, data: { inputTokens, outputTokens, toolCalls, costUsd, status: 'ok', finishedAt: new Date() } });
    const needsVerification = (RISK_ORDER[task.risk as keyof typeof RISK_ORDER] ?? 0) >= 1 || result.artifacts.length > 0;
    await prisma.companyTask.update({
      where: { id: taskId },
      data: { status: pendingApproval ? 'awaiting_approval' : needsVerification && agent.key !== 'auditor' ? 'verifying' : 'done', result: result as any, costUsd: { increment: costUsd }, finishedAt: new Date() }
    });
    await emitEvent(pendingApproval ? 'task.awaiting_approval' : 'task.finished', agent.key, { title: task.title, costUsd, toolCalls, summary: result.summary.slice(0, 300) }, taskId);
  } catch (e: any) {
    const p = priceFor(cfg.model);
    await prisma.agentRun.update({ where: { id: run.id }, data: { inputTokens, outputTokens, toolCalls, costUsd: (inputTokens * p.in + outputTokens * p.out) / 1_000_000, status: 'error', error: String(e?.message ?? e).slice(0, 500), finishedAt: new Date() } });
    const retry = task.attempts < 2;
    await prisma.companyTask.update({ where: { id: taskId }, data: { status: retry ? 'queued' : 'failed', error: String(e?.message ?? e).slice(0, 500), runAt: new Date(Date.now() + 30 * 60_000) } });
    await emitEvent('task.error', agent.key, { error: String(e?.message ?? e).slice(0, 300), retry }, taskId);
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
