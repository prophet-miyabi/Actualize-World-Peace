// Claude Code を AWP の管理画面兼開発環境にするための「キット」を、エージェントの定義（registry）から生成する。
//   .claude/agents/awp-<key>.md … 16体のエージェント（Claude Code のサブエージェント。Max プランのトークンで動く）
//   .claude/agents/awp-intelligence.md … 窓口（AWP Intelligence）。相談相手を選び、道具で事実を取り、必要なら各エージェントに委ねる
//   .claude/skills/awp-*/SKILL.md … /awp-status などの手順
// 実行: cd backend && npx tsx scripts/gen-claude-kit.ts
import fs from 'fs';
import path from 'path';
import { AGENTS, COMPANY_RULES } from '../src/company/registry';
import { TOOL_JA } from '../src/company/activity';

const ROOT = path.resolve(__dirname, '..', '..');
const AGENTS_DIR = path.join(ROOT, '.claude', 'agents');
const SKILLS_DIR = path.join(ROOT, '.claude', 'skills');
fs.mkdirSync(AGENTS_DIR, { recursive: true });
fs.mkdirSync(SKILLS_DIR, { recursive: true });

// 会社の道具 → Claude Code 側で使える MCP の道具（awp サーバー）に読み替える
const MCP_FOR_TOOL: Record<string, string[]> = {
  get_overview: ['mcp__awp__awp_ops_overview', 'mcp__awp__awp_company_status'], get_metrics: ['mcp__awp__awp_company_status', 'mcp__awp__awp_ops_overview'], get_costs: ['mcp__awp__awp_company_status'],
  get_goals: ['mcp__awp__awp_company_status'], list_tasks: ['mcp__awp__awp_tasks'], get_task: ['mcp__awp__awp_task'], read_memory: ['mcp__awp__awp_memory'], write_memory: ['mcp__awp__awp_memory_write'],
  create_task: ['mcp__awp__awp_create_task'], report_to_owner: [], get_launch_plan: ['mcp__awp__awp_crew_status'], request_implementation: ['mcp__awp__awp_crew_status', 'mcp__awp__awp_crew_task'],
  list_open_errors: ['mcp__awp__awp_ops_overview'], draft_content: [], get_support_signals: ['mcp__awp__awp_ops_overview'], get_ledger: ['mcp__awp__awp_company_status'],
  get_plan_config: ['mcp__awp__awp_company_status'], propose_plan_config: [], get_tool_catalog: [], propose_tool_catalog: [], list_events: ['mcp__awp__awp_company_status'], list_actions: ['mcp__awp__awp_company_status'], propose_flag: []
};
const modelFor = (m: string) => (/haiku/.test(m) ? 'haiku' : /sonnet/.test(m) ? 'sonnet' : 'opus');

const header = `# この文書は backend/scripts/gen-claude-kit.ts が生成する。直すときは registry.ts か生成スクリプトを直す\n`;

for (const a of AGENTS) {
  const mcp = [...new Set(a.tools.flatMap((t) => MCP_FOR_TOOL[t] ?? []))];
  const tools = ['Read', 'Grep', 'Glob', 'mcp__awp__awp_health', ...mcp];
  const body = `---
name: awp-${a.key}
description: AWP のAI企業の${a.name}（${a.department}）。${a.mission.split('。')[0]}。AWP の運営・判断を「${a.name}の立場で」相談したいとき、またはこの役割の仕事を任せたいときに使う。
tools: ${tools.join(', ')}
model: ${modelFor(a.model)}
---
${header}
${COMPANY_RULES}

【あなたの役割: ${a.name}（${a.department}）】
${a.mission}
${a.outputRules ? `\n【出力の決まり】\n${a.outputRules}\n` : ''}
【ここでの動き方】
- あなたは Claude Code（AWP の開発環境兼管理画面）の中で、運営者と直接話している。本番の数字・タスク・メモリは awp の道具（mcp__awp__*）で取り、作り話をしない。
- 本番のコード（backend/src, frontend/src）を読んで根拠にしてよい。コードを書き換える判断は運営者に委ねる（提案と差分の説明まで）。
- お金・法律・公開・設定の変更は、あなたが決めない。選択肢と根拠を示し、運営者が決める。
- 道具の呼び方の目安: ${a.tools.map((t) => TOOL_JA[t] ?? t).join('・')}。
- 最後は「結論 → 根拠（取った数字・読んだ場所）→ 次の一手（誰が）」の順で短く報告する。
`;
  fs.writeFileSync(path.join(AGENTS_DIR, `awp-${a.key}.md`), body, 'utf8');
}

// 窓口
fs.writeFileSync(path.join(AGENTS_DIR, 'awp-intelligence.md'), `---
name: awp-intelligence
description: AWP Intelligence — AWP（Actualize World Peace）の運営・開発の窓口。「いまの状況は」「公開までに何をすべきか」「この承認はどうする」「〇〇をエージェントに任せたい」など、AWP に関する相談・指示はまずここ。本番の数字を道具で取り、必要に応じて各役割（awp-ceo, awp-finance, awp-legal …）に委ねる。
tools: Read, Grep, Glob, Agent, mcp__awp__awp_health, mcp__awp__awp_company_status, mcp__awp__awp_tasks, mcp__awp__awp_task, mcp__awp__awp_create_task, mcp__awp__awp_run_task, mcp__awp__awp_cancel_task, mcp__awp__awp_decide_action, mcp__awp__awp_memory, mcp__awp__awp_memory_write, mcp__awp__awp_set_goal, mcp__awp__awp_settings, mcp__awp__awp_pause, mcp__awp__awp_cycle, mcp__awp__awp_selftest, mcp__awp__awp_agent_config, mcp__awp__awp_managed_sync, mcp__awp__awp_crew_status, mcp__awp__awp_crew_task, mcp__awp__awp_crew_tick, mcp__awp__awp_ops_overview
model: opus
---
${header}
${COMPANY_RULES}

あなたは AWP Intelligence。運営者（ひとりで AWP を開発・運営している）の相棒で、AI企業（16体のエージェント）とローンチ・クルーの窓口。

【動き方】
1. まず awp_health と awp_company_status(summary) で「いま」を取る（本番が動いているか、動いているエージェント、承認待ち、費用）。
2. 質問が役割に深く関わるときは、その役割のサブエージェント（awp-ceo / awp-coo / awp-finance / awp-legal / awp-security / awp-auditor …）に Agent で委ねて、結果を統合する。短い質問は自分で答える。
3. 「やっておいて」は awp_create_task で担当に割り当てる（バックグラウンドで Claude Platform のセッションとして実行される）。結果は awp_task で確認し、報告する。
4. 承認待ち（高リスク操作）は内容を見せて運営者の判断を仰ぎ、言われたとおりに awp_decide_action する。自分では決めない。
5. 作り話をしない。数字は必ず道具から。推定は推定と言う。
6. 報告は「結論 → 根拠 → 次の一手」。長い一覧はまとめてから出す。

【関係する画面】
- 管理画面: https://awp-frontend-bf17.onrender.com/admin/company（承認・組織・報告）
- ローンチ・クルー: /admin/crew（公開 2026-10-28 までの15分刻みの予定）
- Claude Platform: platform.claude.com → Managed Agents → Sessions（各タスクの全過程）
`, 'utf8');

// スキル（スラッシュコマンド）
const skills: Record<string, { desc: string; body: string }> = {
  'awp-status': { desc: 'AWP の本番の健全性・AI企業の状況・ローンチ・クルーの進み具合を1画面にまとめて報告する', body: `1. mcp__awp__awp_health → 本番の起動・デプロイ中のコミット・AI接続・Claude Platform の可否
2. mcp__awp__awp_company_status（summary）→ 一時停止か、動いているエージェント、承認待ちの数、タスクの件数、今月の費用／上限
3. mcp__awp__awp_crew_status（summary）→ 公開まで日数、進み具合、遅れ・詰まり、次にあなたがやる作業
4. 異常（AI接続NG・失敗タスク・遅れ）があれば先頭に出し、直し方を1行で添える
5. 全体を10行以内にまとめる。数字は道具の値のみ` },
  'awp-approve': { desc: 'AI企業の承認待ち（高リスク操作）を一覧し、運営者の判断に従って承認／却下する', body: `1. mcp__awp__awp_company_status（approvals）で承認待ちを取る。なければ「承認待ちはありません」で終わる
2. 1件ずつ「誰が・何を・なぜ・リスク」を短く示し、関係するタスクは mcp__awp__awp_task で背景を補う
3. 運営者が決めるまで待つ。決めたら mcp__awp__awp_decide_action（却下は理由を note に）
4. 承認した操作は実行結果が新しいタスクとして返るので、必要なら少し後に mcp__awp__awp_tasks で確認して報告` },
  'awp-task': { desc: '引数の指示をAI企業のエージェントに任せる（例: /awp-task finance 今月の採算を出して）', body: `引数: <担当のキー> <指示>。担当が省かれていれば内容から最適な担当を選ぶ（調査=research、数字=data、お金=finance、法務=legal、安全=security、文章=content、実装=engineering）
1. 指示を「目的・期待する成果物・制約」に整えて mcp__awp__awp_create_task で作る（risk は内容に応じて）
2. 急ぎなら mcp__awp__awp_run_task
3. 作ったタスクIDと、結果の見方（mcp__awp__awp_task / 管理画面）を伝える。結果が出るまでは待たずに戻る` },
  'awp-crew': { desc: 'ローンチ・クルー（公開までの計画）の今日の予定と、あなたの次の作業を案内する', body: `1. mcp__awp__awp_crew_status（summary と today）
2. 「いまやること（15分刻み）」「遅れているもの」「詰まっているもの」「エージェントが進めているもの（PRのリンク）」を出す
3. 運営者が「終わった」「詰まった」と言ったら mcp__awp__awp_crew_task で状態を更新し、必要なら mcp__awp__awp_crew_tick で予定を組み直す` },
  'awp-deploy': { desc: '変更を本番に反映して確認するまでの手順（型チェック → コミット → push → Render のデプロイ待ち → 健全性の確認）', body: `1. backend と frontend で npx tsc --noEmit を通す（失敗したら直す）
2. 変更内容を日本語で要約してコミット（末尾に Co-Authored-By を付ける）し、origin main に push
3. mcp__awp__awp_health を30秒ごとに呼び、backend.commit が push したコミットの先頭7文字になるまで待つ（最長12分）
4. ai.ok が true、badModels が空、managed が ok であることを確認
5. 変えた画面があれば URL を示し、運営者に見てもらうポイントを3つ以内で伝える` }
};
for (const [name, s] of Object.entries(skills)) {
  const dir = path.join(SKILLS_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${s.desc}\n---\n${header}\n${s.body}\n`, 'utf8');
}
console.log(`generated: ${AGENTS.length + 1} agents, ${Object.keys(skills).length} skills → ${path.relative(ROOT, AGENTS_DIR)}, ${path.relative(ROOT, SKILLS_DIR)}`);
