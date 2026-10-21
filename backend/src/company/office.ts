// AWP Operations Office — 運営業務を intelligence エージェントに委任し、3D オフィスで監視・指示・承認するための土台。
//
// 既存の AWP 企業（registry.ts の23エージェント、CompanyTask / CompanyAction / CompanyEvent）を壊さず、
// その上に「部署 → 役割（デジタル社員）」の層を置く。役割は registry のエージェントに対応づけられ、
// 役割宛てのタスクは対応するエージェントが実行する（指示文に役割の観点を添える）。
// 追加した仕組み: 委任プラン（分解→提案→承認）、ループ（定義・実行・自動継続）、承認トレイ（AgentApproval）、
// 警報（OperationsAlert）、指標（AgentMetric）、オフィス向けの状態（エージェント状態・タスク状態）。
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import prisma from '../prisma';
import { aiClient } from '../lib/aiUsage';
import { getFlag, SETTING_KEYS } from '../lib/systemSettings';
import { AGENT_BY_KEY, AGENTS, COMPANY_MODELS, isAgentKey } from './registry';
import { listActivity } from './activity';
import { collectMetrics, emitEvent } from './tools';
import { runTask } from './runtime';
import { aiOutageInfo } from './outage';

// ---- 部署と役割 ------------------------------------------------------------------------------------

export type Department = { key: string; name: string; color: string; summary: string; position: [number, number] };
export const DEPARTMENTS: Department[] = [
  { key: 'executive', name: 'CEO席 / 経営コントロールルーム', color: '#7c3aed', summary: '全体の稼働・承認・KPI・優先意思決定', position: [0, 0] },
  { key: 'product', name: 'プロダクト開発部', color: '#2563eb', summary: 'AWP そのものの改善', position: [-2, -1] },
  { key: 'success', name: 'ユーザー成功部', color: '#059669', summary: '活用促進とサポート', position: [2, -1] },
  { key: 'growth', name: 'グロース・マーケティング部', color: '#ea580c', summary: '認知拡大と利用促進', position: [-2, 1] },
  { key: 'social', name: 'SNS運用・配信管理部', color: '#db2777', summary: 'SNS連携・投稿・予約配信', position: [2, 1] },
  { key: 'revenue', name: '収益・パートナー部', color: '#ca8a04', summary: '収益化と外部連携', position: [-1, 2] },
  { key: 'risk', name: 'コンプライアンス・リスク管理部', color: '#dc2626', summary: '安全な運営を守る', position: [1, 2] },
  { key: 'data', name: 'データ・分析部', color: '#0891b2', summary: '測定と経営判断の支援', position: [0, -2] }
];

export type Role = { key: string; name: string; department: string; agent: string; duties: string[]; color: string };
const roleOf = (key: string, name: string, department: string, agent: string, duties: string[]): Role => ({ key, name, department, agent, duties, color: DEPARTMENTS.find((d) => d.key === department)!.color });
export const ROLES: Role[] = [
  roleOf('ceo', 'CEO（経営判断）', 'executive', 'ceo', ['優先順位の決定', '委任の方針', '目標・KPIの見直し']),
  roleOf('orchestrator', 'Operations Orchestrator', 'executive', 'coo', ['業務の分解', '担当と協業ルートの提案', '承認ポイントと完了条件の提示']),
  roleOf('product_strategy', 'Product Strategy', 'product', 'product', ['機能要望の整理', '優先順位の提案', 'ロードマップ案']),
  roleOf('product_research', 'Product Research', 'product', 'research', ['競合SNS・LPビルダー・予約配信ツールの調査', 'ユーザー行動・市場動向の分析']),
  roleOf('ux', 'UX Improvement', 'product', 'product', ['375px 表示・導線・離脱ポイント・操作性の改善提案']),
  roleOf('engineering_task', 'Engineering Task', 'product', 'engineering', ['実装タスクの分解と優先度付け', 'バグ・技術的負債・テスト不足の検出']),
  roleOf('qa', 'QA', 'product', 'qa', ['機能テスト・回帰テスト', '型エラー・Prisma整合性・brand-words 検査の確認']),
  roleOf('onboarding', 'Onboarding', 'success', 'cs', ['新規ユーザーの初期設定支援', '最初のページ作成・投稿・SNS連携の完了支援']),
  roleOf('support', 'Support', 'success', 'cs', ['問い合わせの分類', '回答案の作成', 'エスカレーション判定']),
  roleOf('user_success', 'User Success', 'success', 'cs', ['利用頻度低下ユーザーの検出', '再活性化施策の提案', '成功事例の収集']),
  roleOf('feedback', 'Feedback', 'success', 'cs', ['要望・不満・バグ報告の集約と優先順位付け']),
  roleOf('growth_strategy', 'Growth Strategy', 'growth', 'growth', ['新規獲得・継続率・収益化の施策提案']),
  roleOf('content_marketing', 'Content Marketing', 'growth', 'content', ['公式ブログ・X・Instagram・TikTok の企画と原稿']),
  roleOf('seo', 'SEO', 'growth', 'content', ['検索流入向上の記事・キーワード・内部リンク提案']),
  roleOf('campaign', 'Campaign', 'growth', 'marketing', ['キャンペーン設計・成果測定・改善提案']),
  roleOf('community', 'Community', 'growth', 'growth', ['コミュニティ運営・イベント企画・交流促進']),
  roleOf('social_ops', 'Social Operations', 'social', 'instagram', ['公式アカウントの運用計画', '投稿カレンダーの管理']),
  roleOf('publishing', 'Content Publishing', 'social', 'content', ['投稿文・画像・動画・ハッシュタグ・CTA の作成']),
  roleOf('platform_sync', 'Platform Sync', 'social', 'instagram', ['Instagram / X / TikTok の連携状態・トークン期限・同期エラーの監視']),
  roleOf('scheduler', 'Scheduler', 'social', 'instagram', ['予約投稿の実行・失敗時の再試行・配信結果の記録']),
  roleOf('social_analytics', 'Social Analytics', 'social', 'data', ['各SNSの反応・リーチ・クリック・登録誘導効果の分析']),
  roleOf('monetization', 'Monetization', 'revenue', 'finance', ['プラン設計・課金施策・アップセル機会の分析']),
  roleOf('partnership', 'Partnership', 'revenue', 'partnership', ['潜在パートナーの調査・連携案・提案資料']),
  roleOf('sales', 'Sales', 'revenue', 'partnership', ['法人・クリエイター・店舗向けの提案準備']),
  roleOf('billing', 'Billing', 'revenue', 'finance', ['請求・未払い・プラン変更・解約理由の監視']),
  roleOf('compliance', 'Compliance', 'risk', 'legal', ['利用規約・プライバシー・著作権・肖像権・商標権の確認']),
  roleOf('security', 'Security', 'risk', 'security', ['異常アクセス・認証情報・APIキー・権限設定の監視']),
  roleOf('moderation', 'Moderation', 'risk', 'security', ['不適切投稿・スパム・なりすまし・危険コンテンツの検出と対応案']),
  roleOf('legal_support', 'Legal Support', 'risk', 'legal', ['法務確認が必要な事項の整理', '専門家確認用の要約']),
  roleOf('data_analyst', 'Data Analyst', 'data', 'data', ['KPI・ユーザー行動・機能利用・収益指標の分析']),
  roleOf('experiment', 'Experiment', 'data', 'growth', ['A/Bテスト・機能検証・改善仮説の設計と評価']),
  roleOf('forecast', 'Forecast', 'data', 'data', ['ユーザー数・収益・負荷・サポート量の予測']),
  roleOf('reporting', 'Reporting', 'data', 'data', ['日次・週次・月次レポートの作成'])
];
export const ROLE_BY_KEY = new Map(ROLES.map((r) => [r.key, r]));
export const isRoleKey = (k: unknown): k is string => typeof k === 'string' && ROLE_BY_KEY.has(k);

// 役割宛てのタスクに添える観点
export function roleBrief(roleKey: string) {
  const r = ROLE_BY_KEY.get(roleKey);
  if (!r) return '';
  const dept = DEPARTMENTS.find((d) => d.key === r.department);
  return `【あなたの役割】${r.name}（${dept?.name ?? ''}）\n担当: ${r.duties.join(' / ')}\nこの役割の観点で進め、他の役割の仕事は提案にとどめる。`;
}

// ---- タスク状態（オフィス表示用） ------------------------------------------------------------------------

export const TASK_STATES = ['DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_INPUT', 'WAITING_APPROVAL', 'BLOCKED', 'RETRYING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type TaskState = (typeof TASK_STATES)[number];
type TaskLike = { status: string; assignee: string; error: string | null; runAt: Date; attempts: number; pausedAt: Date | null; result: unknown };

export function taskState(t: TaskLike): TaskState {
  if (t.status === 'draft') return 'DRAFT';
  if (t.status === 'paused' || t.pausedAt) return 'BLOCKED';
  // オーナー（人間）宛てのタスクは、人の入力待ち
  if (t.assignee === 'user' || t.assignee === 'owner') return t.status === 'done' ? 'COMPLETED' : t.status === 'canceled' ? 'CANCELLED' : 'WAITING_INPUT';
  switch (t.status) {
    case 'queued': return t.error && t.attempts > 0 ? 'RETRYING' : 'ASSIGNED';
    case 'running': return 'IN_PROGRESS';
    case 'verifying': return 'IN_PROGRESS';
    case 'awaiting_approval': return 'WAITING_APPROVAL';
    case 'done': return 'COMPLETED';
    case 'failed': return 'FAILED';
    case 'rejected': return 'FAILED';
    case 'canceled': return 'CANCELLED';
    default: return 'ASSIGNED';
  }
}

// ---- エージェント状態 ---------------------------------------------------------------------------------

export const AGENT_STATES = ['待機中', 'タスク受領', '調査中', '作成中', '実行中', '外部API呼び出し中', 'レビュー中', '承認待ち', '待ち状態', '成功', '失敗', '再試行中', '停止中', '要対応'] as const;
export type AgentState = (typeof AGENT_STATES)[number];
const RESEARCH_ROLES = new Set(['product_research', 'data_analyst', 'forecast', 'social_analytics', 'security', 'moderation', 'compliance']);
const WRITING_ROLES = new Set(['content_marketing', 'publishing', 'seo', 'reporting', 'legal_support']);

// ---- 委任プラン（分解→提案→承認） ------------------------------------------------------------------------

const PlanSchema = z.object({
  summary: z.string().describe('目的の言い換え（1〜2文）'),
  steps: z.array(z.object({
    role: z.string().describe(`担当する役割のキー。次のいずれか: ${ROLES.map((r) => r.key).join(' / ')}`),
    title: z.string().describe('タスク名（30文字以内）'),
    instructions: z.string().describe('具体的な指示（何を・どの情報を使って・何を出すか。200〜400字）'),
    doneCriteria: z.string().describe('完了条件（1〜2文）'),
    approval: z.boolean().describe('結果に管理者の承認が必要か（公開・金銭・法務・セキュリティ・削除・外部配信は true）'),
    risk: z.string().describe('low / medium / high'),
    dependsOn: z.array(z.number()).describe('先に終わっている必要があるステップ番号（0始まり）')
  })).describe('3〜7ステップ。役割の重複は最小に'),
  approvalPoints: z.array(z.string()).describe('管理者が判断すべき点（箇条書き）'),
  kpi: z.string().describe('関連する KPI（1つ）'),
  risks: z.array(z.string()).describe('想定されるリスクと回避策（2〜4個）')
});
export type Plan = z.infer<typeof PlanSchema>;

export async function planDelegation(objective: string, opts: { priority?: number; dueAt?: string | null; kpi?: string; feature?: string; services?: string[] } = {}): Promise<Plan> {
  const fallback = (): Plan => ({
    summary: objective.slice(0, 200),
    steps: [
      { role: 'product_research', title: '現状と前例の調査', instructions: `目的「${objective}」に関して、AWP の現状の数値・利用者の声・競合の前例を調べ、判断材料をまとめる。`, doneCriteria: '調査メモに根拠と出典がある', approval: false, risk: 'low', dependsOn: [] },
      { role: 'product_strategy', title: '施策案の作成', instructions: '調査結果をもとに、効果と手間の見積もり付きで施策案を3つ出し、推奨を1つ選ぶ。', doneCriteria: '推奨案と理由、必要な承認が明記されている', approval: true, risk: 'medium', dependsOn: [0] },
      { role: 'qa', title: '実施前チェック', instructions: '推奨案について、法規・文言規則（人工知能を指す英字2文字の略語を使わない）・スマホ表示・既存機能への影響を確認する。', doneCriteria: '問題点が列挙され、重大なものがない', approval: false, risk: 'low', dependsOn: [1] }
    ],
    approvalPoints: ['推奨案の採用', '費用・外部サービスの利用'],
    kpi: opts.kpi || '公開数・7日継続',
    risks: ['事実でない数値が入る → 入力された事実のみ使う', '承認待ちで止まる → 承認トレイに理由と選択肢を出す']
  });
  if (!process.env.ANTHROPIC_API_KEY) return fallback();
  try {
    const r = await aiClient().beta.messages.parse({
      model: COMPANY_MODELS.balanced,
      max_tokens: 4000,
      system: [
        'あなたは AWP（日本のスマホ向けページ作成＋SNS プラットフォーム）の Operations Orchestrator です。',
        '管理者の目的を、役割（デジタル社員）に割り当てられる3〜7個のタスクに分解します。',
        '原則: 金銭・法務・セキュリティ・公開・削除・外部配信に関わるステップは approval=true。事実を作らない。英字2文字の略語（人工知能を指す語）は使わず「AWP」「intelligence」と書く。',
        `役割一覧:\n${ROLES.map((r) => `- ${r.key}: ${r.name}（${r.duties.join('・')}）`).join('\n')}`
      ].join('\n'),
      messages: [{ role: 'user', content: [`目的: ${objective}`, opts.kpi ? `関連KPI: ${opts.kpi}` : '', opts.feature ? `関連機能: ${opts.feature}` : '', opts.services?.length ? `外部サービス: ${opts.services.join(', ')}` : '', opts.dueAt ? `期限: ${opts.dueAt}` : '', opts.priority ? `優先度: ${opts.priority}` : ''].filter(Boolean).join('\n') }],
      output_config: { effort: 'low', format: betaZodOutputFormat(PlanSchema) }
    });
    if (!r.parsed_output) throw new Error('no plan');
    const plan = r.parsed_output;
    plan.steps = plan.steps.filter((s) => isRoleKey(s.role)).slice(0, 7);
    if (!plan.steps.length) return fallback();
    return plan;
  } catch (e: any) {
    console.error('office plan failed', e?.message);
    await emitEvent('office.error', 'office', { stage: 'plan', error: String(e?.message ?? e) });
    return fallback();
  }
}

export type DelegateInput = {
  title: string; objective: string; roles?: string[]; priority: number; dueAt?: Date | null; kpi?: string | null; info?: string | null;
  approvalRequired: boolean; recurrence?: string | null; doneCriteria?: string | null; feature?: string | null; services?: string[]; risk: 'low' | 'medium' | 'high';
};

// 委任プランをタスクに変換する。親タスク（委任票）＋ステップごとの子タスク。依存のあるステップは runAt を後ろにずらす
export async function createDelegation(plan: Plan, input: DelegateInput, createdBy = 'human') {
  const goal = await prisma.companyGoal.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });
  const parent = await prisma.companyTask.create({ data: {
    title: input.title.slice(0, 120), instructions: `${input.objective}\n\n【委任プラン】${plan.summary}\n承認ポイント: ${plan.approvalPoints.join(' / ')}`.slice(0, 6000),
    assignee: 'coo', createdBy, goalId: goal?.id ?? null, risk: input.risk, status: 'done', role: 'orchestrator', priority: input.priority, dueAt: input.dueAt ?? null, kpi: input.kpi ?? plan.kpi,
    approvalRequired: false, recurrence: input.recurrence ?? null, doneCriteria: input.doneCriteria ?? null, feature: input.feature ?? null, services: input.services ?? [],
    result: { summary: `委任票: ${plan.summary}`, facts: [], assumptions: [], artifacts: [], nextActions: plan.steps.map((s) => `${s.role}: ${s.title}`), plan } as any, finishedAt: new Date()
  } });
  const children = [];
  for (const [i, s] of plan.steps.entries()) {
    const role = ROLE_BY_KEY.get(s.role)!;
    const delayMin = (s.dependsOn ?? []).length ? 8 * (Math.max(...s.dependsOn) + 1) : 0;
    const t = await prisma.companyTask.create({ data: {
      parentId: parent.id, title: s.title.slice(0, 120), assignee: role.agent, role: role.key, createdBy, goalId: goal?.id ?? null,
      instructions: `${roleBrief(role.key)}\n\n【目的】${input.objective}\n${input.info ? `【必要な情報】${input.info}\n` : ''}\n【指示】${s.instructions}\n\n【完了条件】${s.doneCriteria}${(s.dependsOn ?? []).length ? `\n\n【前提】ステップ ${s.dependsOn.map((d) => d + 1).join(', ')} の結果（上位タスク「${input.title}」の子タスク）を先に確認する。` : ''}`.slice(0, 6000),
      risk: (['low', 'medium', 'high'].includes(s.risk) ? s.risk : input.risk) as string, priority: input.priority, dueAt: input.dueAt ?? null, kpi: input.kpi ?? plan.kpi,
      approvalRequired: input.approvalRequired || s.approval, doneCriteria: s.doneCriteria, feature: input.feature ?? null, services: input.services ?? [],
      runAt: new Date(Date.now() + delayMin * 60_000)
    } });
    children.push(t);
  }
  await emitEvent('office.delegated', 'owner', { parentId: parent.id, title: input.title, steps: children.map((c) => ({ id: c.id, role: c.role, title: c.title })) }, parent.id);
  return { parent, children };
}

// ---- ループ ----------------------------------------------------------------------------------------------

type LoopStep = { role: string; label: string; instructions: string; approval?: boolean };
export const LOOP_SEED: { key: string; name: string; department: string; description: string; schedule: string; steps: LoopStep[] }[] = [
  { key: 'product_improvement', name: 'プロダクト改善ループ', department: 'product', description: '要望 → 調査 → 戦略 → 実装計画 → 検証 → 承認 → 効果測定', schedule: 'weekly', steps: [
    { role: 'feedback', label: '要望・不満・バグの集約', instructions: '直近の問い合わせ・通報・利用状況から、要望・不満・不具合を集約し、影響の大きい順に5件まで挙げる。' },
    { role: 'product_research', label: '前例と競合の調査', instructions: '上位の課題について、競合や前例がどう解いているかを調べ、AWP に合う解き方を示す。' },
    { role: 'product_strategy', label: '優先順位とロードマップ案', instructions: '課題と調査をもとに、今週着手する1〜3件を選び、理由と期待効果を書く。' },
    { role: 'engineering_task', label: '実装タスクへの分解', instructions: '選んだ改善を実装タスクに分解し、影響範囲・テスト観点・所要の目安を付ける。' },
    { role: 'qa', label: '検証計画と品質確認', instructions: '分解された実装タスクの検証手順（375px・型・Prisma・brand-words）を用意し、抜けを指摘する。' },
    { role: 'product_strategy', label: 'リリース計画（承認）', instructions: '検証計画を踏まえたリリース計画を1枚にまとめる。管理者の承認を求める。', approval: true },
    { role: 'data_analyst', label: '効果測定と次の候補', instructions: 'リリース後の指標の変化を測り、次の改善候補を3つ挙げる。' }
  ] },
  { key: 'user_activation', name: 'ユーザー活性化ループ', department: 'success', description: '分析 → 停滞ユーザー検出 → 支援・施策 → 効果測定', schedule: 'weekly', steps: [
    { role: 'data_analyst', label: '利用状況の分析', instructions: '7日・30日の利用状況から、停滞しているユーザー層と離脱ポイントを特定する。' },
    { role: 'user_success', label: '再活性化の施策案', instructions: '停滞層ごとに再活性化の施策（お知らせ・導線・支援）を提案し、優先順位を付ける。' },
    { role: 'onboarding', label: '初期設定支援の改善', instructions: '新規ユーザーが最初のページ作成・投稿・SNS連携を完了しやすくする改善を具体化する。' },
    { role: 'support', label: '問い合わせの先回り', instructions: 'よくある詰まりに先回りする回答案・ガイドを用意する。' },
    { role: 'data_analyst', label: '効果測定と次のアクション', instructions: '施策後の継続率・公開数の変化を測り、次のアクションを決める。' }
  ] },
  { key: 'social_ops', name: 'SNS運用ループ', department: 'social', description: '計画 → 原稿 → 連携確認 → 配信 → 分析 → 改善', schedule: 'daily', steps: [
    { role: 'social_ops', label: '投稿計画', instructions: '今週の投稿カレンダーを確認し、今日出す投稿の狙いと枠を決める。' },
    { role: 'publishing', label: '原稿と素材', instructions: '投稿文・画像/動画の指示・ハッシュタグ・CTA を作り、承認待ちの下書きとして登録する。' },
    { role: 'platform_sync', label: '連携とトークンの確認', instructions: 'Instagram / X / TikTok の接続状態とトークン期限、直近の同期エラーを確認し、問題があれば警報を出す。' },
    { role: 'scheduler', label: '配信の実行確認', instructions: '予約配信の結果（成功・失敗・再試行）を確認し、失敗分の対処を記録する。' },
    { role: 'social_analytics', label: '反応の分析と改善', instructions: '直近投稿の反応・リーチ・クリック・登録誘導を分析し、次回の改善点を3つにまとめる。' }
  ] },
  { key: 'risk_response', name: 'リスク対応ループ', department: 'risk', description: '検知 → 影響判定 → 対応（自動/承認）→ 再発防止 → 監視更新', schedule: 'daily', steps: [
    { role: 'security', label: 'セキュリティ検知', instructions: '異常アクセス・認証情報・APIキー・権限設定の兆候を点検し、見つかったものを影響度付きで列挙する。' },
    { role: 'moderation', label: 'コンテンツ検知', instructions: '不適切投稿・スパム・なりすまし・危険コンテンツを検出し、対応案（非表示・警告・凍結）を出す。' },
    { role: 'compliance', label: '影響度判定と対応方針（承認）', instructions: '検知結果の影響度を判定し、自動対応で良いものと管理者承認が要るものに分ける。承認を求める。', approval: true },
    { role: 'security', label: '再発防止と監視設定', instructions: '対応後の再発防止策と、監視設定の更新案をまとめる。' }
  ] },
  { key: 'revenue', name: '収益改善ループ', department: 'revenue', description: '分析 → 収益化案 → 成長施策 → 実験設計 → 承認 → 実行 → 測定', schedule: 'weekly', steps: [
    { role: 'data_analyst', label: '収益指標の分析', instructions: 'プラン売上・分配・PR枠・受託の指標を分析し、伸びしろの大きい箇所を特定する。' },
    { role: 'monetization', label: '収益化の仮説', instructions: 'プラン設計・課金施策・アップセルの仮説を3つ出し、期待効果を見積もる。' },
    { role: 'growth_strategy', label: '成長施策との接続', instructions: '収益化の仮説を新規獲得・継続の施策と結びつけ、実施順を提案する。' },
    { role: 'experiment', label: '実験の設計（承認）', instructions: '最有力の仮説の A/B テストまたは検証計画を設計し、管理者の承認を求める。', approval: true },
    { role: 'data_analyst', label: '効果測定と次の仮説', instructions: '実験結果を評価し、次の仮説を生成する。' }
  ] }
];

export async function seedLoops() {
  for (const l of LOOP_SEED) {
    await prisma.agentLoopDefinition.upsert({ where: { key: l.key }, update: {}, create: { key: l.key, name: l.name, department: l.department, description: l.description, steps: l.steps as any, schedule: l.schedule } });
  }
}

async function createStepTask(run: { id: string; loopKey: string }, loopName: string, step: LoopStep, index: number, previous?: string) {
  const role = ROLE_BY_KEY.get(step.role);
  const agent = role?.agent ?? 'coo';
  const goal = await prisma.companyGoal.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });
  return prisma.companyTask.create({ data: {
    title: `${loopName} ${index + 1}: ${step.label}`.slice(0, 120), assignee: agent, role: role?.key ?? null, createdBy: 'office', goalId: goal?.id ?? null, risk: step.approval ? 'medium' : 'low',
    instructions: `${roleBrief(role?.key ?? '')}\n\n【ループ】${loopName}（ステップ ${index + 1}）\n【指示】${step.instructions}${previous ? `\n\n【前のステップの結果】\n${previous.slice(0, 2500)}` : ''}\n\n終わったら finish_task で報告する。`.slice(0, 6000),
    approvalRequired: !!step.approval, loopRunId: run.id, priority: 3, kpi: null
  } });
}

export async function startLoop(loopKey: string, startedBy: 'human' | 'schedule') {
  const def = await prisma.agentLoopDefinition.findUnique({ where: { key: loopKey } });
  if (!def || !def.enabled) throw new Error('ループがありません、または無効です');
  const running = await prisma.agentLoopRun.findFirst({ where: { loopKey, status: { in: ['running', 'waiting_approval'] } } });
  if (running) throw new Error('このループは実行中です');
  const steps = def.steps as unknown as LoopStep[];
  const run = await prisma.agentLoopRun.create({ data: { loopKey, startedBy, stats: { stepMs: [], failures: 0 } as any } });
  const task = await createStepTask(run, def.name, steps[0], 0);
  await emitEvent('office.loop.started', startedBy === 'human' ? 'owner' : 'office', { loopKey, runId: run.id, firstTask: task.id });
  return run;
}

// ループの継続・承認待ち・失敗を、現在のステップのタスクの状態から進める（tick から呼ぶ）
async function advanceLoops() {
  const runs = await prisma.agentLoopRun.findMany({ where: { status: { in: ['running', 'waiting_approval'] } }, include: { loop: true, tasks: { orderBy: { createdAt: 'asc' } } } });
  for (const run of runs) {
    const steps = run.loop.steps as unknown as LoopStep[];
    const current = run.tasks[run.currentStep];
    if (!current) continue;
    const stats = (run.stats as { stepMs: number[]; failures: number } | null) ?? { stepMs: [], failures: 0 };
    if (current.status === 'failed' || current.status === 'rejected' || current.status === 'canceled') {
      await prisma.agentLoopRun.update({ where: { id: run.id }, data: { status: 'failed', error: `ステップ ${run.currentStep + 1}（${steps[run.currentStep]?.label}）が ${current.status}`, finishedAt: new Date(), stats: { ...stats, failures: stats.failures + 1 } as any } });
      await upsertAlert(`loop_failed:${run.id}`, 'critical', `${run.loop.name} が止まりました`, `ステップ ${run.currentStep + 1}「${steps[run.currentStep]?.label}」が ${current.status} になりました。${current.error ?? ''}`.slice(0, 500), 'loop', current.id, current.assignee);
      await emitEvent('office.loop.failed', 'office', { loopKey: run.loopKey, runId: run.id, step: run.currentStep });
      continue;
    }
    if (current.status === 'awaiting_approval') { if (run.status !== 'waiting_approval') await prisma.agentLoopRun.update({ where: { id: run.id }, data: { status: 'waiting_approval' } }); continue; }
    if (current.status !== 'done') continue;
    const ms = current.finishedAt && current.startedAt ? current.finishedAt.getTime() - current.startedAt.getTime() : 0;
    const next = run.currentStep + 1;
    if (next >= steps.length) {
      await prisma.agentLoopRun.update({ where: { id: run.id }, data: { status: 'completed', finishedAt: new Date(), stats: { ...stats, stepMs: [...stats.stepMs, ms] } as any } });
      await emitEvent('office.loop.completed', 'office', { loopKey: run.loopKey, runId: run.id, steps: steps.length });
      continue;
    }
    const prev = (current.result as { summary?: string } | null)?.summary ?? '';
    const t = await createStepTask(run, run.loop.name, steps[next], next, prev);
    await prisma.agentLoopRun.update({ where: { id: run.id }, data: { currentStep: next, status: 'running', stats: { ...stats, stepMs: [...stats.stepMs, ms] } as any } });
    await emitEvent('office.loop.step', 'office', { loopKey: run.loopKey, runId: run.id, step: next, taskId: t.id });
  }
}

// スケジュール（daily / weekly / monthly）で autoRun のループを開始する
async function scheduleLoops(now: Date) {
  const defs = await prisma.agentLoopDefinition.findMany({ where: { enabled: true, autoRun: true } });
  for (const d of defs) {
    const last = await prisma.agentLoopRun.findFirst({ where: { loopKey: d.key }, orderBy: { startedAt: 'desc' } });
    const gap = d.schedule === 'daily' ? 86_400_000 : d.schedule === 'weekly' ? 7 * 86_400_000 : d.schedule === 'monthly' ? 30 * 86_400_000 : 0;
    if (!gap) continue;
    if (last && now.getTime() - last.startedAt.getTime() < gap) continue;
    if (last && ['running', 'waiting_approval'].includes(last.status)) continue;
    await startLoop(d.key, 'schedule').catch(() => {});
  }
}

// ---- 承認トレイ -----------------------------------------------------------------------------------------

export async function upsertAlert(key: string, level: 'info' | 'warning' | 'critical', title: string, body: string, source: string, taskId?: string | null, agent?: string | null) {
  return prisma.operationsAlert.upsert({ where: { key }, update: { level, title, body }, create: { key, level, title, body, source, taskId: taskId ?? null, agent: agent ?? null } });
}

// approvalRequired のタスクが完了したら、承認トレイに載せて awaiting_approval に戻す
async function collectApprovals() {
  const done = await prisma.companyTask.findMany({ where: { approvalRequired: true, status: 'done', approvals: { none: {} } }, take: 20 });
  for (const t of done) {
    const summary = (t.result as { summary?: string } | null)?.summary ?? '';
    await prisma.agentApproval.create({ data: {
      taskId: t.id, loopRunId: t.loopRunId, kind: t.loopRunId ? 'loop_gate' : 'task_result', title: `承認: ${t.title}`.slice(0, 160),
      reason: summary.slice(0, 1500) || '成果物の確認をお願いします', impact: `担当 ${ROLE_BY_KEY.get(t.role ?? '')?.name ?? t.assignee} / リスク ${t.risk}${t.kpi ? ` / KPI ${t.kpi}` : ''}`,
      options: [{ key: 'approve', label: '承認して次へ', effect: '完了として記録し、後続のステップに進みます' }, { key: 'reject', label: '差し戻す', effect: '理由を添えて担当に見直しを依頼します' }] as any
    } });
    await prisma.companyTask.update({ where: { id: t.id }, data: { status: 'awaiting_approval' } });
    await emitEvent('office.approval.requested', 'office', { taskId: t.id, title: t.title }, t.id);
  }
}

export async function decideApproval(id: string, decision: 'approve' | 'reject', decidedBy: string, note?: string) {
  const a = await prisma.agentApproval.findUnique({ where: { id }, include: { task: true } });
  if (!a || a.status !== 'pending') throw new Error('承認待ちの項目ではありません');
  await prisma.agentApproval.update({ where: { id }, data: { status: decision === 'approve' ? 'approved' : 'rejected', decision, note: note?.slice(0, 1000) ?? null, decidedBy, decidedAt: new Date() } });
  if (a.task) {
    if (decision === 'approve') {
      await prisma.companyTask.update({ where: { id: a.task.id }, data: { status: 'done' } });
    } else {
      await prisma.companyTask.update({ where: { id: a.task.id }, data: { status: 'rejected' } });
      await prisma.companyTask.create({ data: {
        parentId: a.task.id, assignee: a.task.assignee, role: a.task.role, createdBy: 'human', title: `差し戻し: ${a.task.title}`.slice(0, 120), risk: a.task.risk, priority: a.task.priority, approvalRequired: true, loopRunId: a.task.loopRunId,
        instructions: `${roleBrief(a.task.role ?? '')}\n\n前回の成果は管理者に差し戻されました。${note ? `\n【管理者のコメント】${note.slice(0, 1500)}` : ''}\n\n【元の指示】\n${a.task.instructions.slice(0, 3000)}\n\n指摘に沿って作り直し、finish_task で報告する。`.slice(0, 6000)
      } });
      if (a.task.loopRunId) {
        // ループは差し戻しタスクを現在ステップとして続ける（タスク配列の末尾に追加されるので currentStep を合わせる）
        const run = await prisma.agentLoopRun.findUnique({ where: { id: a.task.loopRunId }, include: { tasks: { orderBy: { createdAt: 'asc' } } } });
        if (run) await prisma.agentLoopRun.update({ where: { id: run.id }, data: { currentStep: run.tasks.length, status: 'running' } });
      }
    }
  }
  await emitEvent(decision === 'approve' ? 'office.approval.approved' : 'office.approval.rejected', 'owner', { approvalId: id, taskId: a.taskId, kind: a.kind }, a.taskId ?? undefined);
}

// ---- 警報 ------------------------------------------------------------------------------------------------

async function collectAlerts(now: Date) {
  const h24 = new Date(now.getTime() - 86_400_000);
  const failed = await prisma.companyTask.findMany({ where: { status: 'failed', updatedAt: { gte: h24 } }, select: { id: true, title: true, assignee: true, error: true }, take: 30 });
  for (const t of failed) await upsertAlert(`task_failed:${t.id}`, 'warning', `失敗: ${t.title}`.slice(0, 160), (t.error ?? '原因不明').slice(0, 500), 'task', t.id, t.assignee);
  const stale = await prisma.companyTask.findMany({ where: { status: 'running', startedAt: { lt: new Date(now.getTime() - 30 * 60_000) } }, select: { id: true, title: true, assignee: true }, take: 20 });
  for (const t of stale) await upsertAlert(`task_stale:${t.id}`, 'warning', `30分以上実行中: ${t.title}`.slice(0, 160), '処理が長引いています。停止または再実行を検討してください。', 'task', t.id, t.assignee);
  const oldApprovals = await prisma.agentApproval.count({ where: { status: 'pending', createdAt: { lt: new Date(now.getTime() - 12 * 3600_000) } } });
  const oldActions = await prisma.companyAction.count({ where: { status: 'pending', createdAt: { lt: new Date(now.getTime() - 12 * 3600_000) } } });
  if (oldApprovals + oldActions > 0) await upsertAlert('approvals_waiting', 'warning', `承認待ちが ${oldApprovals + oldActions} 件、12時間以上止まっています`, '承認トレイで判断してください。ループもここで止まっています。', 'approval');
  else await prisma.operationsAlert.updateMany({ where: { key: 'approvals_waiting', status: 'open' }, data: { status: 'resolved' } });
  const expiring = await prisma.socialAccount.findMany({ where: { expiresAt: { lt: new Date(now.getTime() + 7 * 86_400_000) } }, select: { id: true, platform: true, accountLabel: true, expiresAt: true } });
  for (const s of expiring) await upsertAlert(`token_expiring:${s.id}`, s.expiresAt && s.expiresAt < now ? 'critical' : 'warning', `${s.platform} のトークン期限${s.expiresAt && s.expiresAt < now ? '切れ' : 'が近い'}: ${s.accountLabel ?? ''}`.slice(0, 160), `期限 ${s.expiresAt?.toISOString().slice(0, 10) ?? '不明'}。再接続が必要です。`, 'social');
  const outage = aiOutageInfo() as { active?: boolean; since?: string; reason?: string } | null;
  if (outage?.active) await upsertAlert('ai_outage', 'critical', 'intelligence が止まっています', `${outage.reason ?? ''}（${outage.since ?? ''}）`.slice(0, 300), 'ai');
  else await prisma.operationsAlert.updateMany({ where: { key: 'ai_outage', status: 'open' }, data: { status: 'resolved' } });
  // 直った失敗・停滞は自動で解決にする
  const openTaskAlerts = await prisma.operationsAlert.findMany({ where: { status: 'open', source: 'task', taskId: { not: null } }, select: { id: true, key: true, taskId: true } });
  for (const al of openTaskAlerts) {
    const t = await prisma.companyTask.findUnique({ where: { id: al.taskId! }, select: { status: true } });
    const resolved = !t || (al.key.startsWith('task_failed:') ? !['failed'].includes(t.status) : t.status !== 'running');
    if (resolved) await prisma.operationsAlert.update({ where: { id: al.id }, data: { status: 'resolved' } });
  }
}

// ---- 指標 ------------------------------------------------------------------------------------------------

const jstDay = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

async function updateMetrics(now: Date) {
  const day = jstDay(now);
  const start = new Date(new Date(`${day}T00:00:00+09:00`).getTime());
  const tasks = await prisma.companyTask.findMany({ where: { updatedAt: { gte: start }, status: { in: ['done', 'failed', 'rejected'] } }, select: { assignee: true, role: true, status: true, startedAt: true, finishedAt: true, costUsd: true } });
  const by = new Map<string, { done: number; failed: number; ms: number[]; cost: number }>();
  for (const t of tasks) {
    for (const key of new Set([t.assignee, t.role].filter((x): x is string => !!x))) {
      const b = by.get(key) ?? { done: 0, failed: 0, ms: [], cost: 0 };
      if (t.status === 'done') b.done++; else b.failed++;
      if (t.startedAt && t.finishedAt) b.ms.push(t.finishedAt.getTime() - t.startedAt.getTime());
      b.cost += t.costUsd;
      by.set(key, b);
    }
  }
  for (const [agent, b] of by) {
    const avgMs = b.ms.length ? Math.round(b.ms.reduce((a, c) => a + c, 0) / b.ms.length) : 0;
    const health = Math.max(0, Math.min(100, Math.round(100 - (b.failed / Math.max(1, b.done + b.failed)) * 100)));
    await prisma.agentMetric.upsert({ where: { agent_day: { agent, day } }, update: { done: b.done, failed: b.failed, avgMs, costUsd: b.cost, health }, create: { agent, day, done: b.done, failed: b.failed, avgMs, costUsd: b.cost, health } });
  }
}

// ---- tick（30秒ごと） -----------------------------------------------------------------------------------

let ticking = false;
export async function officeTick(now = new Date()) {
  if (ticking) return;
  ticking = true;
  try {
    await seedLoops();
    await collectApprovals();
    await advanceLoops();
    if (!(await getFlag(SETTING_KEYS.pauseCompany))) await scheduleLoops(now);
    await collectAlerts(now);
    await updateMetrics(now);
    // 期限が来た定期タスク（recurrence）を複製して再キュー
    const due = await prisma.companyTask.findMany({ where: { recurrence: { in: ['daily', 'weekly', 'monthly'] }, status: 'done', parentId: null }, select: { id: true, title: true, instructions: true, assignee: true, role: true, risk: true, recurrence: true, finishedAt: true, priority: true, kpi: true, approvalRequired: true, doneCriteria: true, feature: true, services: true, goalId: true }, take: 50 });
    for (const t of due) {
      const gap = t.recurrence === 'daily' ? 86_400_000 : t.recurrence === 'weekly' ? 7 * 86_400_000 : 30 * 86_400_000;
      if (!t.finishedAt || now.getTime() - t.finishedAt.getTime() < gap) continue;
      const already = await prisma.companyTask.findFirst({ where: { title: t.title, status: { in: ['queued', 'running', 'awaiting_approval', 'verifying'] } }, select: { id: true } });
      if (already) continue;
      await prisma.companyTask.create({ data: { title: t.title, instructions: t.instructions, assignee: t.assignee, role: t.role, risk: t.risk, recurrence: t.recurrence, priority: t.priority, kpi: t.kpi, approvalRequired: t.approvalRequired, doneCriteria: t.doneCriteria, feature: t.feature, services: t.services, goalId: t.goalId, createdBy: 'office' } });
      await prisma.companyTask.update({ where: { id: t.id }, data: { recurrence: null } });
    }
  } catch (e: any) {
    console.error('office tick failed', e?.message);
  } finally {
    ticking = false;
  }
}

let timer: NodeJS.Timeout | null = null;
export function startOffice() {
  if (timer) return;
  timer = setInterval(() => { void officeTick(); }, 30_000);
  setTimeout(() => { void officeTick(); }, 5_000);
}

// ---- 状態（画面用） ---------------------------------------------------------------------------------------

export async function officeState() {
  const now = new Date();
  const since24 = new Date(now.getTime() - 86_400_000);
  const since7 = new Date(now.getTime() - 7 * 86_400_000);
  const [tasks, actions, approvals, alerts, loops, runs, configs, metrics, goals, paused, events, metricsToday] = await Promise.all([
    prisma.companyTask.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }], take: 300, select: { id: true, title: true, assignee: true, role: true, status: true, risk: true, priority: true, dueAt: true, kpi: true, approvalRequired: true, recurrence: true, doneCriteria: true, feature: true, services: true, parentId: true, loopRunId: true, error: true, result: true, attempts: true, runAt: true, pausedAt: true, costUsd: true, startedAt: true, finishedAt: true, createdAt: true, updatedAt: true, createdBy: true } }),
    prisma.companyAction.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, include: { task: { select: { title: true, role: true } } } }),
    prisma.agentApproval.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } }),
    prisma.operationsAlert.findMany({ where: { status: { in: ['open', 'acked'] } }, orderBy: [{ level: 'asc' }, { createdAt: 'desc' }], take: 50 }),
    prisma.agentLoopDefinition.findMany({ orderBy: { key: 'asc' } }),
    prisma.agentLoopRun.findMany({ orderBy: { startedAt: 'desc' }, take: 40, include: { tasks: { select: { id: true, title: true, status: true, role: true, assignee: true, startedAt: true, finishedAt: true }, orderBy: { createdAt: 'asc' } } } }),
    prisma.companyAgentConfig.findMany(),
    collectMetrics(30).catch(() => null),
    prisma.companyGoal.findMany({ where: { status: 'active' }, orderBy: { createdAt: 'desc' }, take: 5 }),
    getFlag(SETTING_KEYS.pauseCompany),
    prisma.companyEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 40 }),
    prisma.agentMetric.findMany({ where: { day: jstDay(now) } })
  ]);
  const activity = listActivity();
  const cfg = new Map(configs.map((c) => [c.key, c]));
  const metricBy = new Map(metricsToday.map((m) => [m.agent, m]));

  const taskRows = tasks.map((t) => ({ ...t, state: taskState(t), summary: (t.result as { summary?: string } | null)?.summary?.slice(0, 240) ?? null, result: undefined }));
  const byRole = (roleKey: string, agentKey: string) => taskRows.filter((t) => t.role === roleKey || (!t.role && t.assignee === agentKey && roleKey === primaryRoleOf(agentKey)));

  const agents = ROLES.map((r) => {
    const mine = byRole(r.key, r.agent);
    const running = mine.find((t) => t.status === 'running');
    const act = activity.find((a) => a.agent === r.agent && (!running || a.taskId === running.id));
    const enabled = cfg.get(r.agent)?.enabled ?? true;
    const recentFail = mine.find((t) => t.status === 'failed' && t.updatedAt >= since24);
    const retry = mine.find((t) => t.status === 'queued' && t.error && t.attempts > 0);
    const awaiting = mine.find((t) => t.status === 'awaiting_approval');
    const verifying = mine.find((t) => t.status === 'verifying');
    const queued = mine.find((t) => t.status === 'queued' && !t.pausedAt);
    const lastDone = mine.find((t) => t.status === 'done');
    let state: AgentState = '待機中';
    if (!enabled) state = '停止中';
    else if (running) state = act?.phase === 'tool' ? '外部API呼び出し中' : act?.phase === 'reporting' ? '作成中' : RESEARCH_ROLES.has(r.key) ? '調査中' : WRITING_ROLES.has(r.key) ? '作成中' : '実行中';
    else if (awaiting) state = '承認待ち';
    else if (verifying) state = 'レビュー中';
    else if (recentFail) state = '要対応';
    else if (retry) state = '再試行中';
    else if (queued) state = 'タスク受領';
    else if (lastDone && lastDone.finishedAt && now.getTime() - lastDone.finishedAt.getTime() < 10 * 60_000) state = '成功';
    const m = metricBy.get(r.key) ?? metricBy.get(r.agent);
    const done7 = mine.filter((t) => t.status === 'done' && t.finishedAt && t.finishedAt >= since7).length;
    const failed7 = mine.filter((t) => ['failed', 'rejected'].includes(t.status) && t.updatedAt >= since7).length;
    const durations = mine.filter((t) => t.startedAt && t.finishedAt).map((t) => t.finishedAt!.getTime() - t.startedAt!.getTime());
    return {
      ...r, agentName: AGENT_BY_KEY.get(r.agent)?.name ?? r.agent, enabled, state,
      currentTask: running ? { id: running.id, title: running.title, since: running.startedAt, text: act?.text ?? null, tool: act?.tool ?? null } : null,
      counts: { done7, failed7, open: mine.filter((t) => ['queued', 'running', 'verifying', 'awaiting_approval'].includes(t.status)).length },
      avgMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : (m?.avgMs ?? 0),
      lastArtifact: lastDone ? { id: lastDone.id, title: lastDone.title, summary: lastDone.summary, at: lastDone.finishedAt } : null,
      pendingApprovals: approvals.filter((a) => mine.some((t) => t.id === a.taskId)).length + actions.filter((a) => a.agent === r.agent).length,
      recentLogs: events.filter((e) => e.actor === r.agent || (e.payload as any)?.role === r.key).slice(0, 5).map((e) => ({ type: e.type, at: e.createdAt })),
      health: m?.health ?? Math.max(0, 100 - failed7 * 15)
    };
  });

  const approvalItems = [
    ...approvals.map((a) => ({ id: a.id, source: 'approval' as const, kind: a.kind, title: a.title, reason: a.reason, impact: a.impact, options: a.options, taskId: a.taskId, createdAt: a.createdAt })),
    ...actions.map((a) => ({ id: a.id, source: 'action' as const, kind: 'tool', title: `操作の承認: ${a.tool}（${a.task?.title ?? ''}）`.slice(0, 160), reason: a.reason, impact: `リスク ${a.risk} / 担当 ${ROLE_BY_KEY.get(a.task?.role ?? '')?.name ?? a.agent}`, options: [{ key: 'approve', label: '承認して実行' }, { key: 'reject', label: '却下' }], taskId: a.taskId, createdAt: a.createdAt, input: a.input }))
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const open = taskRows.filter((t) => ['ASSIGNED', 'IN_PROGRESS', 'RETRYING', 'WAITING_INPUT'].includes(t.state));
  const today = open.filter((t) => t.priority <= 2 || (t.dueAt && t.dueAt.getTime() - now.getTime() < 2 * 86_400_000)).slice(0, 12);
  const decisions = [
    ...approvalItems.map((a) => ({ kind: 'approval', id: a.id, title: a.title, source: a.source })),
    ...alerts.filter((a) => a.level === 'critical' && a.status === 'open').map((a) => ({ kind: 'alert', id: a.id, title: a.title, source: 'alert' })),
    // オーナー宛てのタスクは多いので、優先度が高いか期限が近いものだけを「判断が必要」に載せる
    ...taskRows.filter((t) => t.state === 'WAITING_INPUT' && (t.priority <= 2 || (t.dueAt && t.dueAt.getTime() - now.getTime() < 2 * 86_400_000))).map((t) => ({ kind: 'input', id: t.id, title: t.title, source: 'task' }))
  ];
  const deptHealth = DEPARTMENTS.map((d) => {
    const members = agents.filter((a) => a.department === d.key);
    const failed = members.reduce((n, a) => n + a.counts.failed7, 0);
    const working = members.filter((a) => ['実行中', '調査中', '作成中', '外部API呼び出し中'].includes(a.state)).length;
    const attention = members.filter((a) => ['要対応', '承認待ち', '停止中'].includes(a.state)).length;
    return { ...d, members: members.length, working, attention, done7: members.reduce((n, a) => n + a.counts.done7, 0), failed7: failed, health: attention ? 'warning' : failed > 2 ? 'warning' : 'ok' };
  });
  const counts = { running: taskRows.filter((t) => t.state === 'IN_PROGRESS').length, done: taskRows.filter((t) => t.state === 'COMPLETED').length, waitingApproval: approvalItems.length, failed: taskRows.filter((t) => ['FAILED', 'RETRYING'].includes(t.state)).length, open: open.length };
  const kpi = metrics ? { totals: metrics.totals, period: metrics.period, series: metrics.series.slice(-14), goals: goals.map((g) => ({ id: g.id, title: g.title, kpis: g.kpis })) } : null;
  return { generatedAt: now.toISOString(), paused, configured: !!process.env.ANTHROPIC_API_KEY, departments: deptHealth, agents, tasks: taskRows, approvals: approvalItems, alerts, loops: loops.map((l) => ({ ...l, runs: runs.filter((r) => r.loopKey === l.key).slice(0, 5), stats: loopStats(runs.filter((r) => r.loopKey === l.key)) })), today, decisions, counts, kpi, events: events.slice(0, 25), states: { task: TASK_STATES, agent: AGENT_STATES } };
}

function primaryRoleOf(agentKey: string) {
  return ROLES.find((r) => r.agent === agentKey)?.key ?? '';
}

function loopStats(runs: { status: string; stats: unknown; tasks: { status: string; role: string | null }[] }[]) {
  const total = runs.length;
  const completed = runs.filter((r) => r.status === 'completed').length;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const ms = runs.flatMap((r) => ((r.stats as { stepMs?: number[] } | null)?.stepMs ?? []));
  const bottleneck = (() => {
    const byRole = new Map<string, number>();
    for (const r of runs) for (const t of r.tasks) if (['failed', 'rejected', 'awaiting_approval'].includes(t.status) && t.role) byRole.set(t.role, (byRole.get(t.role) ?? 0) + 1);
    return [...byRole.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  })();
  return { total, completed, failed, successRate: total ? Math.round((completed / total) * 100) : null, failureRate: total ? Math.round((failed / total) * 100) : null, avgStepMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0, bottleneck };
}

export async function taskDetail(id: string) {
  const t = await prisma.companyTask.findUnique({ where: { id }, include: { actions: { orderBy: { createdAt: 'asc' } }, runs: { orderBy: { startedAt: 'asc' } }, approvals: { orderBy: { createdAt: 'asc' } } } });
  if (!t) return null;
  const children = await prisma.companyTask.findMany({ where: { parentId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, title: true, status: true, role: true, assignee: true } });
  const events = await prisma.companyEvent.findMany({ where: { taskId: id }, orderBy: { createdAt: 'asc' }, take: 100 });
  return { ...t, state: taskState(t), children, events, role: t.role ? ROLE_BY_KEY.get(t.role) ?? null : null };
}

export { AGENTS, isAgentKey, runTask };
