import crypto from 'crypto';
import prisma from '../prisma';
import { createAnthropic } from '../lib/anthropic';
import { AGENTS, AGENT_BY_KEY, COMPANY_RULES, type AgentDef } from './registry';
import { toolsForAgent } from './tools';
import { FINISH_TOOL, type TaskResult } from './finish';

// Claude Platform の Managed Agents を実行基盤として使う。
//   - エージェント定義（役割・決まり・道具）は Platform 側に「版」として保存され、変更のたびに新しい版になる（巻き戻し可能）
//   - 1タスク = 1セッション。会話のループ・圧縮・キャッシュ・予算の上限は Platform が受け持つ
//   - 道具（指標・メモリ・タスク作成など）は「カスタムツール」として AWP 側で実行する。権限と承認は今までどおり AWP が判断する
//   - 全過程は Console のセッション画面で追える（AgentRun.sessionId）
// COMPANY_ENGINE=messages にすると従来の自前ループに戻る

export function managedEnabled() {
  return (process.env.COMPANY_ENGINE || 'managed') !== 'messages' && !!process.env.ANTHROPIC_API_KEY;
}

export function consoleSessionUrl(sessionId: string) {
  const ws = (process.env.ANTHROPIC_WORKSPACE_ID || '').trim() || 'default';
  return `https://platform.claude.com/workspaces/${ws}/sessions/${sessionId}`;
}

const ENV_SETTING_KEY = 'company_managed_environment';

// セッションの入れ物（環境）。道具は AWP 側で動くので、コンテナ自体は外に出られない最小構成にする
export async function ensureEnvironment(client = createAnthropic()): Promise<string> {
  const row = await prisma.systemSetting.findUnique({ where: { key: ENV_SETTING_KEY } });
  if (row?.value) {
    try {
      const env = await client.beta.environments.retrieve(row.value);
      if (!(env as any).archived_at) return row.value;
    } catch (e: any) {
      if (e?.status !== 404) throw e;
    }
  }
  const env = await client.beta.environments.create({
    name: 'AWP AI company',
    description: 'AWP（Actualize World Peace）のAI企業のエージェントが動く環境。道具はAWPのサーバー側で実行するため、ネットワークは閉じている',
    config: { type: 'cloud', networking: { type: 'limited' } }
  });
  await prisma.systemSetting.upsert({ where: { key: ENV_SETTING_KEY }, update: { value: env.id }, create: { key: ENV_SETTING_KEY, value: env.id } });
  return env.id;
}

// Platform に保存するエージェント定義。タスクごとに変わる情報（目標・戦略・メモリの一覧・日付）は最初のメッセージで渡す
export function agentSpec(agent: AgentDef, model: string) {
  const custom = [...toolsForAgent(agent).map((t) => ({ type: 'custom' as const, name: t.name, description: `${t.description}（リスク: ${t.risk}）`, input_schema: t.input_schema as any })),
    { type: 'custom' as const, name: FINISH_TOOL.name, description: FINISH_TOOL.description!, input_schema: FINISH_TOOL.input_schema as any }];
  const tools: any[] = [...custom];
  if (agent.webSearch && process.env.COMPANY_WEB_SEARCH !== 'false') {
    tools.unshift({ type: 'agent_toolset_20260401', default_config: { enabled: false }, configs: [{ name: 'web_search', enabled: true }, { name: 'web_fetch', enabled: true }] });
  }
  const system = [
    COMPANY_RULES,
    `\n【あなたの役割: ${agent.name}（${agent.department}）】\n${agent.mission}`,
    agent.outputRules ? `\n【出力の決まり】\n${agent.outputRules}` : '',
    `\n【権限】自動で実行できるのはリスク ${agent.maxAutoRisk} まで。それを超える道具は「人間の承認待ち」になり、結果はあとで届く。承認待ちになったら finish_task の blocked に書いて終える。`,
    '\n【進め方】会社の目標・戦略・読めるメモリの一覧・今日の日付は、最初のメッセージに書かれている。道具は必要な分だけ使い、終わったら必ず finish_task を呼んで報告する。finish_task を呼ばずに終えてはいけない。'
  ].join('\n');
  return { name: `AWP ${agent.name}`, description: agent.mission.slice(0, 2000), model, system, tools, metadata: { awp_agent: agent.key } };
}

function specHash(spec: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify(spec)).digest('hex').slice(0, 16);
}

export type SyncResult = { key: string; status: 'created' | 'updated' | 'unchanged' | 'error'; id?: string; version?: number; error?: string };

// エージェント定義を Platform に同期する（変更があった分だけ新しい版を作る）
export async function syncManagedAgents(keys?: string[]): Promise<{ environmentId: string; results: SyncResult[] }> {
  const client = createAnthropic();
  const environmentId = await ensureEnvironment(client);
  const results: SyncResult[] = [];
  for (const agent of AGENTS.filter((a) => !keys || keys.includes(a.key))) {
    try {
      results.push(await ensureManagedAgent(agent, client));
    } catch (e: any) {
      results.push({ key: agent.key, status: 'error', error: String(e?.error?.error?.message ?? e?.message ?? e).slice(0, 300) });
    }
  }
  return { environmentId, results };
}

// 1体分の同期。モデルや道具が変わっていれば update（新しい版）、未登録なら create
export async function ensureManagedAgent(agent: AgentDef, client = createAnthropic()): Promise<SyncResult> {
  const row = await prisma.companyAgentConfig.findUnique({ where: { key: agent.key } });
  const model = row?.model || agent.model;
  const spec = agentSpec(agent, model);
  const hash = specHash(spec);
  if (row?.managedAgentId && row.managedHash === hash && row.managedVersion) {
    return { key: agent.key, status: 'unchanged', id: row.managedAgentId, version: row.managedVersion };
  }
  let remote: { id: string; version: number } | null = null;
  let status: SyncResult['status'] = 'created';
  if (row?.managedAgentId) {
    try {
      remote = await client.beta.agents.update(row.managedAgentId, spec as any);
      status = 'updated';
    } catch (e: any) {
      if (e?.status !== 404) throw e;
    }
  }
  if (!remote) remote = await client.beta.agents.create(spec as any);
  await prisma.companyAgentConfig.upsert({
    where: { key: agent.key },
    update: { managedAgentId: remote.id, managedVersion: remote.version, managedHash: hash, managedSyncedAt: new Date() },
    create: { key: agent.key, managedAgentId: remote.id, managedVersion: remote.version, managedHash: hash, managedSyncedAt: new Date() }
  });
  return { key: agent.key, status, id: remote.id, version: remote.version };
}

export type ManagedRunOpts = {
  agent: AgentDef;
  managedAgentId: string;
  managedVersion: number;
  title: string;
  message: string;                       // 最初のメッセージ（タスクと状況）
  budgetUsd: number;                     // このセッションの上限（Platform が強制）
  metadata?: Record<string, string>;
  onToolUse: (name: string, input: any) => Promise<{ content: string; isError?: boolean; result?: TaskResult; pendingApproval?: boolean }>;
  onSessionCreated?: (sessionId: string) => Promise<void> | void;
  onActivity?: (phase: 'thinking' | 'tool' | 'reporting', tool?: string) => void;
  timeoutMs?: number;
};

export type ManagedRunOutcome = {
  sessionId: string;
  result: TaskResult | null;
  pendingApproval: boolean;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stopReason: string;
  lastText: string;
  errors: string[];
};

// 1タスクを1セッションとして実行する。ストリームを先に開き、履歴と突き合わせて取りこぼしを防ぐ
export async function runManagedSession(o: ManagedRunOpts): Promise<ManagedRunOutcome> {
  const client = createAnthropic();
  const environmentId = await ensureEnvironment(client);
  const cents = Math.max(50, Math.floor(o.budgetUsd * 100));
  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: o.managedAgentId, version: o.managedVersion },
    environment_id: environmentId,
    title: o.title.slice(0, 200),
    metadata: o.metadata,
    budget: { type: 'limit', max_list_cost: { amount: String(cents), currency: 'USD' } }
  });
  await o.onSessionCreated?.(session.id);

  const out: ManagedRunOutcome = { sessionId: session.id, result: null, pendingApproval: false, toolCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, stopReason: 'unknown', lastText: '', errors: [] };
  const seen = new Set<string>();
  const deadline = Date.now() + (o.timeoutMs ?? 30 * 60_000);
  let nudged = false;
  let done = false;

  const send = (events: any[]) => client.beta.sessions.events.send(session.id, { events });

  // 1イベントの処理。true を返したらループを終える
  const handle = async (ev: any): Promise<boolean> => {
    if (ev.id) {
      if (seen.has(ev.id)) return false;
      seen.add(ev.id);
    }
    switch (ev.type) {
      case 'agent.custom_tool_use': {
        out.toolCalls++;
        o.onActivity?.(ev.name === 'finish_task' ? 'reporting' : 'tool', ev.name);
        const r = await o.onToolUse(ev.name, ev.input ?? {});
        if (r.result) out.result = r.result;
        if (r.pendingApproval) out.pendingApproval = true;
        await send([{ type: 'user.custom_tool_result', custom_tool_use_id: ev.id, content: [{ type: 'text', text: r.content }], is_error: !!r.isError }]);
        return false;
      }
      case 'span.model_request_start':
        o.onActivity?.('thinking');
        return false;
      case 'agent.tool_use':
        o.onActivity?.('tool', ev.name);
        return false;
      case 'agent.message': {
        const txt = (ev.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
        if (txt) out.lastText = txt;
        return false;
      }
      case 'span.model_request_end': {
        const u = ev.model_usage ?? {};
        out.inputTokens += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        out.outputTokens += u.output_tokens ?? 0;
        return false;
      }
      case 'session.error': {
        out.errors.push(String(ev.error?.message ?? ev.message ?? 'session.error').slice(0, 300));
        return false;
      }
      case 'session.status_idle': {
        const reason = ev.stop_reason?.type ?? 'end_turn';
        if (reason === 'requires_action') return false; // 道具の結果待ち（すでに返している）
        out.stopReason = reason;
        if (reason === 'end_turn' && !out.result && !nudged && Date.now() < deadline) {
          // finish_task を呼ばずに終わった: 一度だけ報告を求める
          nudged = true;
          await send([{ type: 'user.message', content: [{ type: 'text', text: '道具の呼び出しはここまでです。いまわかっていることで finish_task を呼び、報告してください。' }] }]);
          return false;
        }
        return true;
      }
      case 'session.status_terminated':
        out.stopReason = 'terminated';
        return true;
      default:
        return false;
    }
  };

  // 接続が切れても再接続して続ける（ストリームに再送はないので、履歴と突き合わせる）
  let attempts = 0;
  let kicked = false;
  while (!done && attempts < 4) {
    attempts++;
    try {
      const stream = await client.beta.sessions.events.stream(session.id);
      if (!kicked) {
        kicked = true;
        await send([{ type: 'user.message', content: [{ type: 'text', text: o.message }] }]);
      } else {
        // 再接続: 取りこぼした分を履歴から拾う
        for await (const ev of client.beta.sessions.events.list(session.id)) {
          if (await handle(ev)) { done = true; break; }
        }
        if (done) break;
      }
      for await (const ev of stream) {
        if (Date.now() > deadline) {
          await send([{ type: 'user.interrupt' }]).catch(() => {});
          out.stopReason = 'timeout';
          done = true;
          break;
        }
        if (await handle(ev)) { done = true; break; }
      }
      if (!done) {
        // ストリームが静かに閉じた: セッションの状態を見て判断する
        const s = await client.beta.sessions.retrieve(session.id);
        if (s.status === 'terminated' || (s.status === 'idle' && out.result)) { out.stopReason = s.status; done = true; }
      }
    } catch (e: any) {
      out.errors.push(String(e?.error?.error?.message ?? e?.message ?? e).slice(0, 300));
      if (attempts >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempts));
    }
  }

  // 費用はセッションの list_cost（定価換算。実行時間分も含む）を正とする
  try {
    const s = await client.beta.sessions.retrieve(session.id);
    const usage: any = s.usage ?? {};
    if (usage.list_cost?.amount) out.costUsd = Number(usage.list_cost.amount) / 100;
    if (usage.input_tokens != null) out.inputTokens = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    if (usage.output_tokens != null) out.outputTokens = usage.output_tokens;
  } catch { /* 取れなければストリームで数えた値を使う */ }

  // 使い終わったセッションは読み取り専用にする（履歴は Console に残る）
  void (async () => {
    for (let i = 0; i < 10; i++) {
      const s = await client.beta.sessions.retrieve(session.id).catch(() => null);
      if (!s) return;
      if (s.status !== 'running') { await client.beta.sessions.archive(session.id).catch(() => {}); return; }
      await new Promise((r) => setTimeout(r, 500));
    }
  })();
  return out;
}

// 既存のセッションに承認結果などを伝える必要が出たときのために、エージェント定義の取得だけ公開しておく
export function managedAgentDef(key: string) {
  return AGENT_BY_KEY.get(key) ?? null;
}
