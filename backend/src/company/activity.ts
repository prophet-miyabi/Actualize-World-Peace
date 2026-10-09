import { AGENT_BY_KEY } from './registry';
import { getCompanySettings } from './settings';

// エージェントが「いま何をしているか」を、キャラクターの口調で管理画面と Discord に見せる。
// 実行基盤（自前ループ / Claude Platform / 会話）のどれでも同じ呼び方で使う

export type Phase = 'starting' | 'thinking' | 'tool' | 'reporting' | 'waiting_approval' | 'done' | 'failed';

type Voice = { emoji: string; starting: string; thinking: string; tool: string; reporting: string; done: string; blocked: string; failed: string };

// {task} = タスク名、{tool} = 道具の日本語名
const DEFAULT_VOICE: Voice = {
  emoji: '🤖',
  starting: '「{task}」に取りかかります',
  thinking: '考え中…',
  tool: '{tool}を実行中',
  reporting: '報告をまとめています',
  done: '「{task}」を終えました',
  blocked: '「{task}」は承認待ちで止めています',
  failed: '「{task}」でつまずきました'
};

const VOICES: Record<string, Partial<Voice>> = {
  ceo: { emoji: '🎯', starting: '「{task}」、経営の目で見ていきます', thinking: '方針を考えています…', tool: '{tool}で現状を確かめています', reporting: '判断をまとめています', done: '「{task}」の判断を出しました' },
  coo: { emoji: '🗂️', starting: '「{task}」を段取りします', thinking: '誰に何を任せるか整理中…', tool: '{tool}を確認中', reporting: '委任の内容をまとめています', done: '「{task}」の段取りを終えました' },
  research: { emoji: '🔭', starting: '「{task}」を調べ始めます', thinking: '情報を突き合わせています…', tool: '{tool}で調査中', reporting: '調査結果を整理しています', done: '「{task}」の調査を終えました' },
  product: { emoji: '🧩', starting: '「{task}」の企画に入ります', thinking: '利用者の導線を考えています…', tool: '{tool}を見ています', reporting: '企画をまとめています', done: '「{task}」の企画を出しました' },
  engineering: { emoji: '🛠️', starting: '「{task}」、実装の観点で見ます', thinking: '作り方を考えています…', tool: '{tool}を確認中', reporting: '実装依頼をまとめています', done: '「{task}」の実装依頼を出しました' },
  qa: { emoji: '🧪', starting: '「{task}」を検査します', thinking: '確認の手順を組んでいます…', tool: '{tool}で確かめています', reporting: '検査結果を書いています', done: '「{task}」の検査を終えました' },
  data: { emoji: '📊', starting: '「{task}」の数字を見ます', thinking: '指標を読み解いています…', tool: '{tool}を集計中', reporting: 'レポートをまとめています', done: '「{task}」のレポートを出しました' },
  marketing: { emoji: '📣', starting: '「{task}」の打ち手を考えます', thinking: '届け方を考えています…', tool: '{tool}を見ています', reporting: '施策をまとめています', done: '「{task}」の施策を出しました' },
  content: { emoji: '✍️', starting: '「{task}」を書き始めます', thinking: '言葉を選んでいます…', tool: '{tool}で素材を集めています', reporting: '文章を仕上げています', done: '「{task}」を書き上げました' },
  growth: { emoji: '🌱', starting: '「{task}」の伸ばし方を考えます', thinking: '導線の数字を見ています…', tool: '{tool}を確認中', reporting: '実験案をまとめています', done: '「{task}」の案を出しました' },
  cs: { emoji: '💬', starting: '「{task}」、利用者の声から見ます', thinking: '困りごとを整理しています…', tool: '{tool}を確認中', reporting: '対応をまとめています', done: '「{task}」の対応をまとめました' },
  finance: { emoji: '💴', starting: '「{task}」、お金の面から見ます', thinking: '収支を計算しています…', tool: '{tool}で数字を取っています', reporting: '財務の報告を書いています', done: '「{task}」の財務報告を出しました' },
  partnership: { emoji: '🤝', starting: '「{task}」の相手先を考えます', thinking: '組める相手を探しています…', tool: '{tool}を確認中', reporting: '提案をまとめています', done: '「{task}」の提案を出しました' },
  security: { emoji: '🛡️', starting: '「{task}」を安全面から点検します', thinking: 'リスクを洗い出しています…', tool: '{tool}を点検中', reporting: '点検結果を書いています', done: '「{task}」の点検を終えました' },
  legal: { emoji: '⚖️', starting: '「{task}」を法務の目で確認します', thinking: '法令と規約を照らしています…', tool: '{tool}を確認中', reporting: '法務の見解をまとめています', done: '「{task}」の見解を出しました' },
  auditor: { emoji: '🔍', starting: '「{task}」を監査します', thinking: '報告と事実を突き合わせています…', tool: '{tool}で裏取り中', reporting: '判定を書いています', done: '「{task}」の判定を出しました' }
};

export const TOOL_JA: Record<string, string> = {
  get_overview: '全体の状況', get_metrics: '指標', get_costs: 'AI費用', get_goals: '目標', list_tasks: 'タスク一覧', get_task: 'タスクの詳細',
  read_memory: 'メモリ', write_memory: 'メモリへの記録', create_task: 'タスクの作成', report_to_owner: 'オーナーへの報告', get_launch_plan: '公開計画',
  request_implementation: '実装依頼', list_open_errors: 'エラー一覧', draft_content: '文章の下書き', get_support_signals: '利用者の声', get_ledger: '台帳',
  get_plan_config: 'プラン設定', propose_plan_config: 'プラン変更の提案', get_tool_catalog: 'ツール一覧', propose_tool_catalog: 'ツール追加の提案',
  list_events: '出来事の記録', list_actions: '承認の記録', propose_flag: '設定変更の提案', web_search: 'Web検索', web_fetch: 'Webページの取得', finish_task: '報告'
};

export function voiceFor(agentKey: string) {
  return { ...DEFAULT_VOICE, ...(VOICES[agentKey] ?? {}) };
}

export function phraseFor(agentKey: string, phase: Phase, ctx: { task?: string; tool?: string; blocked?: boolean }) {
  const v = voiceFor(agentKey);
  const task = (ctx.task ?? '').slice(0, 40);
  const tool = ctx.tool ? (TOOL_JA[ctx.tool] ?? ctx.tool) : '';
  const t = phase === 'starting' ? v.starting : phase === 'thinking' ? v.thinking : phase === 'tool' ? v.tool : phase === 'reporting' ? v.reporting
    : phase === 'waiting_approval' ? v.blocked : phase === 'done' ? (ctx.blocked ? v.blocked : v.done) : v.failed;
  return t.replace('{task}', task).replace('{tool}', tool);
}

export type Activity = { taskId: string; agent: string; agentName: string; emoji: string; task: string; phase: Phase; tool?: string; text: string; since: string; updatedAt: string; toolCalls: number; via?: 'task' | 'chat' };

const live = new Map<string, Activity & { discordMsgId?: string | null; discordTimer?: NodeJS.Timeout | null; discordDirty?: boolean; lastEditAt?: number }>();

export function listActivity(): Activity[] {
  return [...live.values()].map(({ discordMsgId: _m, discordTimer: _t, discordDirty: _d, lastEditAt: _l, ...a }) => a).sort((a, b) => a.since.localeCompare(b.since));
}

export function activityOf(agentKey: string): Activity | null {
  return listActivity().find((a) => a.agent === agentKey) ?? null;
}

// タスクの開始。Discord（#AI企業）に「取りかかります」と1件だけ投稿し、以後はその投稿を書き換える
export async function startActivity(o: { taskId: string; agent: string; task: string; via?: 'task' | 'chat' }) {
  const def = AGENT_BY_KEY.get(o.agent);
  const now = new Date().toISOString();
  const a = { taskId: o.taskId, agent: o.agent, agentName: def?.name ?? o.agent, emoji: voiceFor(o.agent).emoji, task: o.task, phase: 'starting' as Phase, text: phraseFor(o.agent, 'starting', { task: o.task }), since: now, updatedAt: now, toolCalls: 0, via: o.via ?? 'task', discordMsgId: null as string | null };
  live.set(o.taskId, a);
  if (a.via === 'task') a.discordMsgId = await postDiscord(a).catch(() => null);
}

export function updateActivity(taskId: string, phase: Phase, ctx: { tool?: string } = {}) {
  const a = live.get(taskId);
  if (!a) return;
  a.phase = phase;
  a.tool = ctx.tool;
  if (phase === 'tool') a.toolCalls++;
  a.text = phraseFor(a.agent, phase, { task: a.task, tool: ctx.tool });
  a.updatedAt = new Date().toISOString();
  scheduleDiscordEdit(a);
}

// 終了。Discord の投稿を結果で書き換え、一覧から消す
export async function endActivity(taskId: string, outcome: { status: 'done' | 'failed' | 'waiting_approval'; summary?: string; costUsd?: number; toolCalls?: number; sessionUrl?: string | null }) {
  const a = live.get(taskId);
  if (!a) return;
  live.delete(taskId);
  if (a.discordTimer) clearTimeout(a.discordTimer);
  if (!a.discordMsgId) return;
  const head = outcome.status === 'done' ? `✅ ${phraseFor(a.agent, 'done', { task: a.task })}` : outcome.status === 'waiting_approval' ? `🧑‍⚖️ ${phraseFor(a.agent, 'waiting_approval', { task: a.task })}` : `❌ ${phraseFor(a.agent, 'failed', { task: a.task })}`;
  const meta = [outcome.toolCalls != null ? `道具${outcome.toolCalls}回` : null, outcome.costUsd != null ? `$${outcome.costUsd.toFixed(3)}` : null].filter(Boolean).join('・');
  const body = [head, outcome.summary ? `> ${outcome.summary.split('\n')[0].slice(0, 200)}` : '', meta ? `（${meta}）` : '', outcome.sessionUrl ? `Console: ${outcome.sessionUrl}` : ''].filter(Boolean).join('\n');
  await editDiscord(a, body).catch(() => {});
}

function discordName(a: Activity) {
  return `${a.emoji} ${a.agentName}`;
}

async function postDiscord(a: Activity): Promise<string | null> {
  const s = await getCompanySettings();
  if (!s.discordActivity) return null;
  const { sayAs, discordConfigured } = await import('../crew/discord');
  if (!discordConfigured()) return null;
  return sayAs(discordName(a), 'company', `💭 ${a.text}\nタスク: ${a.task.slice(0, 120)}`);
}

// 書き換えは4秒に1回まで（Discord のレート制限と読みやすさのため）
function scheduleDiscordEdit(a: Activity & { discordMsgId?: string | null; discordTimer?: NodeJS.Timeout | null; lastEditAt?: number }) {
  if (!a.discordMsgId) return;
  const wait = Math.max(0, 4000 - (Date.now() - (a.lastEditAt ?? 0)));
  if (a.discordTimer) clearTimeout(a.discordTimer);
  a.discordTimer = setTimeout(() => {
    a.discordTimer = null;
    a.lastEditAt = Date.now();
    const icon = a.phase === 'tool' ? '🔧' : a.phase === 'reporting' ? '📝' : a.phase === 'waiting_approval' ? '🧑‍⚖️' : '💭';
    void editDiscord(a, `${icon} ${a.text}${a.toolCalls ? `（道具${a.toolCalls}回）` : ''}\nタスク: ${a.task.slice(0, 120)}`).catch(() => {});
  }, wait);
}

async function editDiscord(a: Activity & { discordMsgId?: string | null }, content: string) {
  if (!a.discordMsgId) return;
  const { editAs } = await import('../crew/discord');
  await editAs('company', a.discordMsgId, content);
}

// サーバー再起動などで残った表示を掃除する（20分以上更新がないもの）
export function sweepActivity(maxAgeMs = 20 * 60_000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [id, a] of live) if (new Date(a.updatedAt).getTime() < cutoff) live.delete(id);
}
