import type Anthropic from '@anthropic-ai/sdk';
import prisma from '../prisma';
import { buildOverview } from '../lib/opsOverview';
import { ACCOUNTS, accountBalance } from '../lib/ledger';
import { getPlanConfig, planPrices, setPlanConfig, PLAN_KEYS, type PlanConfig } from '../lib/plans';
import { ALL_SETTING_KEYS, SETTING_LABEL, setFlag, type SettingKey } from '../lib/systemSettings';
import { AGENT_BY_KEY, isAgentKey, type AgentDef, type Risk } from './registry';

// エージェントの「手」（Hands）。エージェントがシステムに触れる唯一の方法。
// 読む道具は low、記録や依頼を作る道具は medium、設定・お金・公開に触る道具は high（人間の承認後に execute が走る）
export type ToolCtx = { agent: AgentDef; taskId: string; goalId: string | null };
export type ToolDef = {
  name: string;
  description: string;
  input_schema: Anthropic.Tool['input_schema'];
  risk: Risk;
  run: (input: any, ctx: ToolCtx) => Promise<unknown>;
};

const DAY = 86_400_000;
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export async function emitEvent(type: string, actor: string, payload?: Record<string, unknown>, taskId?: string) {
  await prisma.companyEvent.create({ data: { type, actor, taskId, payload: payload as any } }).catch(() => {});
}

function jstDay(d: Date) {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

// 日別の件数（直近 days 日）。モデルを問わず createdAt で数える
async function dailyCounts(model: { findMany: (args: any) => Promise<{ createdAt: Date }[]> }, days: number, where: Record<string, unknown> = {}) {
  const since = new Date(Date.now() - days * DAY);
  const rows = await model.findMany({ where: { ...where, createdAt: { gte: since } }, select: { createdAt: true } });
  const by: Record<string, number> = {};
  for (const r of rows) by[jstDay(r.createdAt)] = (by[jstDay(r.createdAt)] ?? 0) + 1;
  return by;
}

export async function collectMetrics(days = 30) {
  const since = new Date(Date.now() - days * DAY);
  const since7 = new Date(Date.now() - 7 * DAY);
  const [users, pages, posts, bookings, orders, prClicks, revenue, planPayments, views, active7, usersTotal, pagesTotal, hiddenPages, reportsOpen, planUsers] = await Promise.all([
    dailyCounts(prisma.user, days),
    dailyCounts(prisma.landingPage, days),
    dailyCounts(prisma.post, days),
    dailyCounts(prisma.booking, days),
    dailyCounts(prisma.order, days),
    dailyCounts(prisma.affiliateClick, days, { lpId: { not: null } }),
    prisma.revenueEvent.aggregate({ where: { createdAt: { gte: since }, status: 'recorded' }, _sum: { grossYen: true, ownerYen: true, platformYen: true }, _count: { _all: true } }),
    prisma.planPayment.aggregate({ where: { confirmedAt: { gte: since }, status: 'confirmed' }, _sum: { amountYen: true }, _count: { _all: true } }),
    prisma.pageEvent.count({ where: { type: 'view', createdAt: { gte: since } } }),
    // 7日以内に何かを作った・反応した利用者（投稿・いいね・フォロー・ページ・予約の確定）
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT u) AS n FROM (
      SELECT "userId" AS u FROM "Post" WHERE "createdAt" >= ${since7}
      UNION SELECT "userId" FROM "PageLike" WHERE "createdAt" >= ${since7}
      UNION SELECT "followerId" FROM "Follow" WHERE "createdAt" >= ${since7}
      UNION SELECT "userId" FROM "LandingPage" WHERE "createdAt" >= ${since7}
      UNION SELECT "userId" FROM "BuilderSession" WHERE "updatedAt" >= ${since7}) x`,
    prisma.user.count(),
    prisma.landingPage.count({ where: { hidden: false } }),
    prisma.landingPage.count({ where: { hidden: true } }),
    prisma.report.count({ where: { status: 'open' } }),
    prisma.user.groupBy({ by: ['plan'], _count: { _all: true }, where: { planUntil: { gt: new Date() } } })
  ]);
  const sum = (by: Record<string, number>) => Object.values(by).reduce((a, b) => a + b, 0);
  const seriesDays = Array.from({ length: days }, (_, i) => jstDay(new Date(Date.now() - (days - 1 - i) * DAY)));
  const series = seriesDays.map((d) => ({ day: d, signups: users[d] ?? 0, pages: pages[d] ?? 0, posts: posts[d] ?? 0, bookings: bookings[d] ?? 0, orders: orders[d] ?? 0, prClicks: prClicks[d] ?? 0 }));
  return {
    periodDays: days,
    totals: { users: usersTotal, publishedPages: pagesTotal, hiddenPages, openReports: reportsOpen, activeUsers7d: Number(active7[0]?.n ?? 0) },
    period: {
      signups: sum(users), pages: sum(pages), posts: sum(posts), bookings: sum(bookings), orders: sum(orders), prClicks: sum(prClicks), pageViews: views,
      confirmedRewards: { count: revenue._count._all, grossYen: revenue._sum.grossYen ?? 0, toOwnersYen: revenue._sum.ownerYen ?? 0, toPlatformYen: revenue._sum.platformYen ?? 0 },
      planSales: { count: planPayments._count._all, yen: planPayments._sum.amountYen ?? 0 }
    },
    paidPlans: Object.fromEntries(planUsers.map((p) => [p.plan, p._count._all])),
    series,
    note: '登録・ページ・投稿などは作成日ベース。activeUsers7d は7日以内に投稿・いいね・フォロー・ページ作成・ビルダー利用のいずれかをした利用者数（閲覧だけの利用者は含まない）'
  };
}

export async function collectCosts() {
  const since30 = new Date(Date.now() - 30 * DAY);
  const today = new Date(new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10) + 'T00:00:00+09:00');
  const [byAgent30, byAgentToday, userAi30, userAiByFeature] = await Promise.all([
    prisma.agentRun.groupBy({ by: ['agent'], where: { startedAt: { gte: since30 } }, _sum: { costUsd: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    prisma.agentRun.groupBy({ by: ['agent'], where: { startedAt: { gte: today } }, _sum: { costUsd: true } }),
    prisma.aiUsage.aggregate({ where: { createdAt: { gte: since30 } }, _sum: { costUsd: true }, _count: { _all: true } }),
    prisma.aiUsage.groupBy({ by: ['feature'], where: { createdAt: { gte: since30 } }, _sum: { costUsd: true }, _count: { _all: true } })
  ]);
  return {
    companyAgents30d: byAgent30.map((r) => ({ agent: r.agent, runs: r._count._all, costUsd: r._sum.costUsd ?? 0, inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0 })),
    companyAgentsToday: byAgentToday.map((r) => ({ agent: r.agent, costUsd: r._sum.costUsd ?? 0 })),
    userFacingAi30d: { costUsd: userAi30._sum.costUsd ?? 0, calls: userAi30._count._all, byFeature: userAiByFeature.map((f) => ({ feature: f.feature, costUsd: f._sum.costUsd ?? 0, calls: f._count._all })) },
    note: '金額は公開価格からの見積もり（米ドル）。インフラ費用は含まない（Render 3サービスで月額約$20）'
  };
}

async function listMemory(scope: string) {
  return prisma.companyMemory.findMany({ where: { scope }, orderBy: { updatedAt: 'desc' }, select: { key: true, content: true, updatedBy: true, updatedAt: true } });
}

const taskSelect = { id: true, title: true, assignee: true, createdBy: true, status: true, risk: true, result: true, verification: true, error: true, parentId: true, goalId: true, createdAt: true, finishedAt: true } as const;

export const TOOLS: ToolDef[] = [
  {
    name: 'get_overview', risk: 'low',
    description: 'システムの現況（利用者数・ページ数・申し込み・未解決エラー・各種設定の有無・要対応の一覧）。個人情報は含まない',
    input_schema: { type: 'object', properties: {} },
    run: () => buildOverview()
  },
  {
    name: 'get_metrics', risk: 'low',
    description: 'プラットフォームの指標（直近N日の日別: 登録・公開ページ・投稿・予約・注文・PR枠クリック、合計、確定報酬、プラン売上、7日アクティブ）',
    input_schema: { type: 'object', properties: { days: { type: 'integer', minimum: 7, maximum: 90, description: '既定30' } } },
    run: (i) => collectMetrics(Math.min(90, Math.max(7, Number(i?.days) || 30)))
  },
  {
    name: 'get_costs', risk: 'low',
    description: 'AI費用（会社のエージェント別・今日と30日、利用者向けAIの機能別・30日）',
    input_schema: { type: 'object', properties: {} },
    run: () => collectCosts()
  },
  {
    name: 'get_goals', risk: 'low',
    description: '人間のオーナーが設定した目標とKPI',
    input_schema: { type: 'object', properties: {} },
    run: () => prisma.companyGoal.findMany({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } })
  },
  {
    name: 'list_tasks', risk: 'low',
    description: '会社のタスク一覧（状態・担当・結果の要約）。重複を避けるため、タスクを作る前に必ず確認する',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['queued', 'running', 'awaiting_approval', 'verifying', 'done', 'failed', 'rejected'] }, assignee: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    run: async (i) => {
      const rows = await prisma.companyTask.findMany({
        where: { ...(i?.status ? { status: i.status } : {}), ...(i?.assignee ? { assignee: String(i.assignee) } : {}) },
        orderBy: { createdAt: 'desc' }, take: Math.min(50, Number(i?.limit) || 25), select: taskSelect
      });
      return rows.map((r) => ({ ...r, result: (r.result as any)?.summary ?? null, verification: (r.verification as any)?.passed ?? null }));
    }
  },
  {
    name: 'get_task', risk: 'low',
    description: 'タスクの詳細（指示・結果の全文・検証・承認待ちの操作）',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (i) => prisma.companyTask.findUnique({ where: { id: String(i.id) }, include: { actions: true, runs: { select: { agent: true, model: true, costUsd: true, toolCalls: true, status: true, error: true } } } })
  },
  {
    name: 'read_memory', risk: 'low',
    description: 'メモリ（会社の知識）を読む。scope: company / dept:<部門> / agent:<自分のキー> / project:<id>。key を省略するとそのスコープの一覧',
    input_schema: { type: 'object', properties: { scope: { type: 'string' }, key: { type: 'string' } }, required: ['scope'] },
    run: async (i, ctx) => {
      const scope = text(i.scope, 60);
      if (!ctx.agent.memoryRead.includes(scope) && !scope.startsWith('project:')) return { error: `このスコープ（${scope}）は読めません。読めるのは: ${ctx.agent.memoryRead.join(', ')}` };
      if (i.key) return prisma.companyMemory.findUnique({ where: { scope_key: { scope, key: text(i.key, 80) } } });
      return listMemory(scope);
    }
  },
  {
    name: 'write_memory', risk: 'low',
    description: '知識・分析・計画をメモリに保存する（同じ scope+key は上書き）。長期に残す価値のあるものだけ。content は Markdown',
    input_schema: { type: 'object', properties: { scope: { type: 'string' }, key: { type: 'string', description: '英数字とハイフン（例: market-research-2026-10）' }, content: { type: 'string' } }, required: ['scope', 'key', 'content'] },
    run: async (i, ctx) => {
      const scope = text(i.scope, 60);
      if (!ctx.agent.memoryWrite.includes(scope) && !scope.startsWith('project:')) return { error: `このスコープ（${scope}）には書けません。書けるのは: ${ctx.agent.memoryWrite.join(', ')}` };
      const key = text(i.key, 80).toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const content = text(i.content, 20_000);
      if (!key || !content) return { error: 'key と content は必須です' };
      await prisma.companyMemory.upsert({ where: { scope_key: { scope, key } }, update: { content, updatedBy: ctx.agent.key }, create: { scope, key, content, updatedBy: ctx.agent.key } });
      await emitEvent('memory.written', ctx.agent.key, { scope, key, chars: content.length }, ctx.taskId);
      return { ok: true, scope, key };
    }
  },
  {
    name: 'create_task', risk: 'low',
    description: '別のエージェントにタスクを割り当てる。目的・使う入力（メモリのキーなど）・期待する成果物・期限を具体的に書く',
    input_schema: {
      type: 'object',
      properties: {
        assignee: { type: 'string', description: 'エージェントのキー（research/product/engineering/qa/data/marketing/content/growth/cs/finance/partnership/security/legal/coo）' },
        title: { type: 'string' }, instructions: { type: 'string' },
        risk: { type: 'string', enum: ['low', 'medium'], description: '成果が外部に影響するなら medium（監査役が検証する）' },
        runInHours: { type: 'number', description: '何時間後に実行するか（既定: すぐ）' }
      },
      required: ['assignee', 'title', 'instructions']
    },
    run: async (i, ctx) => {
      const assignee = text(i.assignee, 30);
      if (!isAgentKey(assignee) || assignee === 'ceo' || assignee === 'auditor') return { error: `${assignee} には割り当てられません` };
      // 同じ担当に同じ題名の未完了タスクがあれば作らない
      const dup = await prisma.companyTask.findFirst({ where: { assignee, title: text(i.title, 120), status: { in: ['queued', 'running', 'awaiting_approval', 'verifying'] } } });
      if (dup) return { error: '同じ題名の未完了タスクがあります', existingId: dup.id };
      const t = await prisma.companyTask.create({
        data: {
          goalId: ctx.goalId, parentId: ctx.taskId, title: text(i.title, 120), instructions: text(i.instructions, 6000), assignee, createdBy: ctx.agent.key,
          risk: i.risk === 'medium' ? 'medium' : 'low', runAt: new Date(Date.now() + Math.max(0, Math.min(72, Number(i.runInHours) || 0)) * 3600_000)
        }
      });
      await emitEvent('task.created', ctx.agent.key, { id: t.id, assignee, title: t.title }, ctx.taskId);
      return { ok: true, id: t.id };
    }
  },
  {
    name: 'report_to_owner', risk: 'low',
    description: '人間のオーナーへの報告（Discordと管理画面に届く）。判断を仰ぐこと・重要な変化・リスクに限る',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, needsDecision: { type: 'boolean' } }, required: ['title', 'body'] },
    run: async (i, ctx) => {
      const title = text(i.title, 100);
      const body = text(i.body, 3000);
      await prisma.companyMemory.upsert({
        where: { scope_key: { scope: 'dept:executive', key: `report-${jstDay(new Date())}` } },
        update: { content: `# ${title}\n\n${body}`, updatedBy: ctx.agent.key },
        create: { scope: 'dept:executive', key: `report-${jstDay(new Date())}`, content: `# ${title}\n\n${body}`, updatedBy: ctx.agent.key }
      });
      await emitEvent('report.owner', ctx.agent.key, { title, needsDecision: !!i.needsDecision }, ctx.taskId);
      const { say, discordConfigured } = await import('../crew/discord');
      if (discordConfigured()) await say('mina', 'company', `🏢 **CEOからの報告: ${title}**${i.needsDecision ? '（判断をお願いします）' : ''}\n${body}`).catch(() => {});
      return { ok: true };
    }
  },
  {
    name: 'get_launch_plan', risk: 'low',
    description: '開発の進み具合（ローンチ・クルーのタスク: 課題・PR・マージの状態）。実装の完了はここで確認する',
    input_schema: { type: 'object', properties: { status: { type: 'string' } } },
    run: async (i) => prisma.crewTask.findMany({
      where: i?.status ? { status: String(i.status) } : {}, orderBy: [{ planDay: 'asc' }, { key: 'asc' }], take: 80,
      select: { key: true, title: true, owner: true, status: true, planDay: true, issueUrl: true, prUrl: true, reviewState: true, notes: true, doneAt: true }
    })
  },
  {
    name: 'request_implementation', risk: 'medium',
    description: '開発チーム（GitHub上の Claude Code → レビュー → オーナーのマージ）に実装を依頼する。完了の条件を箇条書きで具体的に。本番反映はオーナーのマージ後',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, acceptance: { type: 'string', description: '完了の条件（箇条書き）' }, priority: { type: 'integer', minimum: 0, maximum: 3 }, estimateMin: { type: 'integer', minimum: 30, maximum: 480 } }, required: ['title', 'acceptance'] },
    run: async (i, ctx) => {
      const title = text(i.title, 120);
      const existing = await prisma.crewTask.findFirst({ where: { title, status: { notIn: ['done', 'skipped'] } } });
      if (existing) return { error: '同じ題名の未完了の実装タスクがあります', key: existing.key };
      const keys = await prisma.crewTask.findMany({ where: { key: { startsWith: 'C' } }, select: { key: true } });
      const n = keys.reduce((m, k) => Math.max(m, Number(k.key.slice(1)) || 0), 0) + 1;
      const key = `C${String(n).padStart(2, '0')}`;
      const acceptance = [text(i.acceptance, 6000), '- スマホ幅（375px）で表示が崩れないこと', '- 既存の機能を壊さないこと', '- 秘密情報をコミットしないこと', '- 事実でない表示を作らないこと'].join('\n');
      const est = Math.min(480, Math.max(30, Number(i.estimateMin) || 90));
      await prisma.crewTask.create({
        data: { key, title, area: 'dev', epic: `AI企業: ${ctx.agent.name}`, owner: 'agent', agents: ['sora', 'kei'], estimateMin: est, remainingMin: est, priority: Math.min(3, Math.max(0, Number(i.priority) || 1)), planDay: jstDay(new Date()), acceptance, notes: `依頼元: ${ctx.agent.key} / タスク ${ctx.taskId}` }
      });
      await emitEvent('implementation.requested', ctx.agent.key, { key, title }, ctx.taskId);
      return { ok: true, key, note: 'ローンチ・クルーが順に GitHub の課題にします。進み具合は get_launch_plan で確認できます' };
    }
  },
  {
    name: 'list_open_errors', risk: 'low',
    description: '未解決のシステムエラー（発生箇所・内容・診断）',
    input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30 } } },
    run: (i) => prisma.systemError.findMany({ where: { status: { in: ['open', 'diagnosed'] } }, orderBy: { createdAt: 'desc' }, take: Math.min(30, Number(i?.limit) || 10), select: { id: true, source: true, message: true, diagnosis: true, createdAt: true } })
  },
  {
    name: 'draft_content', risk: 'low',
    description: '文章の成果物（SNS投稿・記事・ヘルプ・告知）を下書きとして保存する。公開はオーナーが確認して行う',
    input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['sns', 'article', 'help', 'announcement', 'email', 'other'] }, title: { type: 'string' }, body: { type: 'string' } }, required: ['kind', 'title', 'body'] },
    run: async (i, ctx) => {
      const key = `draft-${text(i.kind, 20)}-${Date.now().toString(36)}`;
      await prisma.companyMemory.create({ data: { scope: 'dept:marketing', key, content: `# ${text(i.title, 120)}\n\n${text(i.body, 20_000)}`, updatedBy: ctx.agent.key } });
      await emitEvent('content.drafted', ctx.agent.key, { key, kind: i.kind, title: text(i.title, 120) }, ctx.taskId);
      return { ok: true, key };
    }
  },
  {
    name: 'get_support_signals', risk: 'low',
    description: '利用者のつまずきの集計（答えられなかったチャットボットの質問、通報の理由別件数、取り消された予約・注文の件数、エラー）。個人情報なし',
    input_schema: { type: 'object', properties: {} },
    run: async () => {
      const since = new Date(Date.now() - 30 * DAY);
      const [unanswered, reports, canceledBookings, canceledOrders, declinedBookings] = await Promise.all([
        prisma.chatbotQuestion.findMany({ where: { answered: false, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 40, select: { question: true } }),
        prisma.report.groupBy({ by: ['reason', 'status'], _count: { _all: true }, where: { createdAt: { gte: since } } }),
        prisma.booking.count({ where: { status: 'canceled', createdAt: { gte: since } } }),
        prisma.order.count({ where: { status: 'canceled', createdAt: { gte: since } } }),
        prisma.booking.count({ where: { status: 'declined', createdAt: { gte: since } } })
      ]);
      return { unansweredQuestions: unanswered.map((q) => q.question), reports: reports.map((r) => ({ reason: r.reason, status: r.status, count: r._count._all })), canceledBookings, declinedBookings, canceledOrders };
    }
  },
  {
    name: 'get_ledger', risk: 'low',
    description: '台帳の残高（入金待ちの報酬・AWPの収益・売上・口座への入金・利用者のキャッシュ残高合計）',
    input_schema: { type: 'object', properties: {} },
    run: async () => {
      const [rec, rev, sales, bank, cash] = await Promise.all([
        accountBalance(prisma, ACCOUNTS.receivable), accountBalance(prisma, ACCOUNTS.revenue), accountBalance(prisma, ACCOUNTS.sales), accountBalance(prisma, ACCOUNTS.bank),
        prisma.ledgerEntry.aggregate({ where: { account: { startsWith: 'user:' } }, _sum: { credit: true, debit: true } })
      ]);
      return { receivableYen: rec.debit - rec.credit, platformRevenueYen: rev.credit - rev.debit, salesYen: sales.credit - sales.debit, bankYen: bank.debit - bank.credit, userCashOutstandingYen: (cash._sum.credit ?? 0) - (cash._sum.debit ?? 0) };
    }
  },
  {
    name: 'get_plan_config', risk: 'low',
    description: '有料プランの設定（基準額・為替・倍率・無料枠）と、計算された月額',
    input_schema: { type: 'object', properties: {} },
    run: async () => { const c = await getPlanConfig(); return { config: c, prices: planPrices(c) }; }
  },
  {
    name: 'propose_plan_config', risk: 'high',
    description: '有料プランの料金設定の変更を提案する（人間の承認後に反映）。理由と、収益・利用者への影響の見積もりを書く',
    input_schema: { type: 'object', properties: { baseUsd: { type: 'number' }, usdJpy: { type: 'number' }, freeAiUsd: { type: 'number' }, multipliers: { type: 'object', properties: { lite: { type: 'number' }, standard: { type: 'number' }, pro: { type: 'number' } } }, reason: { type: 'string' } }, required: ['reason'] },
    run: async (i, ctx) => {
      const c = await getPlanConfig();
      const next: PlanConfig = {
        baseUsd: Number(i.baseUsd) > 0 ? Number(i.baseUsd) : c.baseUsd, usdJpy: Number(i.usdJpy) > 0 ? Number(i.usdJpy) : c.usdJpy,
        freeAiUsd: Number(i.freeAiUsd) >= 0 ? Number(i.freeAiUsd) : c.freeAiUsd,
        multipliers: Object.fromEntries(PLAN_KEYS.map((k) => [k, Number(i.multipliers?.[k]) > 0 ? Number(i.multipliers[k]) : c.multipliers[k]])) as PlanConfig['multipliers']
      };
      await setPlanConfig(next, `agent:${ctx.agent.key}`);
      return { ok: true, applied: next, prices: planPrices(next) };
    }
  },
  {
    name: 'get_tool_catalog', risk: 'low',
    description: '提携ツールのカタログ（名前・カテゴリ・分配可否・ドメイン登録サービスか・30日のクリック数）',
    input_schema: { type: 'object', properties: {} },
    run: async () => {
      const since = new Date(Date.now() - 30 * DAY);
      const [items, clicks] = await Promise.all([
        prisma.toolCatalogItem.findMany({ select: { key: true, name: true, category: true, enabled: true, revenueShareAllowed: true, isDomainRegistrar: true, affiliateUrl: true } }),
        prisma.affiliateClick.groupBy({ by: ['toolKey'], where: { createdAt: { gte: since } }, _count: { _all: true } })
      ]);
      const by = Object.fromEntries(clicks.map((c) => [c.toolKey, c._count._all]));
      return items.map((it) => ({ ...it, hasAffiliateUrl: !!it.affiliateUrl, affiliateUrl: undefined, clicks30d: by[it.key] ?? 0 }));
    }
  },
  {
    name: 'propose_tool_catalog', risk: 'high',
    description: '提携ツールのカタログへの追加・変更を提案する（人間の承認後に反映）。アフィリエイトURLは人間がASPで発行して入れるため、ここでは公式サイトと説明だけ',
    input_schema: { type: 'object', properties: { key: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' }, description: { type: 'string', description: '公式サイトで確認できる事実だけ' }, officialUrl: { type: 'string' }, allowedHosts: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } }, required: ['key', 'name', 'category', 'description', 'officialUrl', 'allowedHosts', 'reason'] },
    run: async (i) => {
      const key = text(i.key, 40).toLowerCase();
      if (!/^[a-z0-9-]{2,40}$/.test(key)) return { error: 'key が正しくありません' };
      let official: URL;
      try { official = new URL(String(i.officialUrl)); if (official.protocol !== 'https:') throw new Error(); } catch { return { error: 'officialUrl は https のURL' }; }
      const hosts = (Array.isArray(i.allowedHosts) ? i.allowedHosts : []).map((h: unknown) => text(h, 100).toLowerCase()).filter(Boolean).slice(0, 10);
      if (!hosts.length) return { error: 'allowedHosts が必要です' };
      const data = { name: text(i.name, 60), category: text(i.category, 30), description: text(i.description, 300), officialUrl: official.toString(), allowedHosts: hosts, enabled: false };
      await prisma.toolCatalogItem.upsert({ where: { key }, update: data, create: { key, ...data } });
      return { ok: true, key, note: '非表示の状態で登録しました。アフィリエイトURLの登録と表示のオンは運営者が行います' };
    }
  },
  {
    name: 'list_events', risk: 'low',
    description: '会社のイベントログ（誰が・いつ・何をしたか）',
    input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, type: { type: 'string' } } },
    run: (i) => prisma.companyEvent.findMany({ where: i?.type ? { type: String(i.type) } : {}, orderBy: { createdAt: 'desc' }, take: Math.min(100, Number(i?.limit) || 40) })
  },
  {
    name: 'list_actions', risk: 'low',
    description: '人間の承認が必要な操作の一覧と状態',
    input_schema: { type: 'object', properties: { status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'executed', 'failed'] } } },
    run: (i) => prisma.companyAction.findMany({ where: i?.status ? { status: String(i.status) } : {}, orderBy: { createdAt: 'desc' }, take: 50 })
  },
  {
    name: 'propose_flag', risk: 'high',
    description: 'システムの停止・再開フラグの変更を提案する（人間の承認後に反映）。緊急時のみ',
    input_schema: { type: 'object', properties: { key: { type: 'string', enum: ALL_SETTING_KEYS }, value: { type: 'boolean' }, reason: { type: 'string' } }, required: ['key', 'value', 'reason'] },
    run: async (i, ctx) => {
      const key = i.key as SettingKey;
      if (!ALL_SETTING_KEYS.includes(key)) return { error: 'key が正しくありません' };
      await setFlag(key, !!i.value, `agent:${ctx.agent.key}`);
      return { ok: true, label: SETTING_LABEL[key], value: !!i.value };
    }
  }
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function toolsForAgent(agent: AgentDef): ToolDef[] {
  return agent.tools.map((n) => TOOL_BY_NAME.get(n)).filter((t): t is ToolDef => !!t);
}

export function agentForKey(key: string) {
  return AGENT_BY_KEY.get(key) ?? null;
}
