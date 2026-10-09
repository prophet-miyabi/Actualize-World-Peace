import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { getFlag, SETTING_KEYS } from '../lib/systemSettings';
import { captureError } from '../lib/errors';
import { emitEvent } from './tools';
import { runTask } from './runtime';
import { seedCompany } from './seed';
import { getCompanySettings } from './settings';

// AI企業の運営サイクル:
// - 1分ごと: 実行待ちのタスクを（同時 CONCURRENCY 件まで）実行する。検証待ちのタスクには監査役のタスクを作る
// - 毎日 08:00 JST: CEO の日次見直し（KPI・前日の成果・詰まり → 今日の重点を COO に委任）
// - 毎週 月曜: ファイナンスとデータの週次報告、監査役による経営判断の監査

function jst(now = new Date()) {
  const d = new Date(now.getTime() + 9 * 3600_000);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours(), weekday: d.getUTCDay() };
}

async function state(key: string) {
  return (await prisma.crewState.findUnique({ where: { key } }))?.value ?? null;
}
async function setState(key: string, value: string) {
  await prisma.crewState.upsert({ where: { key }, update: { value }, create: { key, value } });
}

async function createIfAbsent(data: { assignee: string; title: string; instructions: string; createdBy: string; risk?: string; goalId?: string | null; parentId?: string | null }) {
  const dup = await prisma.companyTask.findFirst({ where: { assignee: data.assignee, title: data.title, status: { in: ['queued', 'running', 'awaiting_approval', 'verifying'] } } });
  if (dup) return dup;
  const t = await prisma.companyTask.create({ data: { ...data, risk: data.risk ?? 'low' } });
  await emitEvent('task.created', data.createdBy, { id: t.id, assignee: data.assignee, title: data.title });
  return t;
}

// 検証待ちのタスクに、監査役の検証タスクを付ける（作った本人は検証しない）
async function queueAudits() {
  const waiting = await prisma.companyTask.findMany({ where: { status: 'verifying' }, take: 10 });
  for (const t of waiting) {
    const existing = await prisma.companyTask.findFirst({ where: { assignee: 'auditor', parentId: t.id, status: { in: ['queued', 'running'] } } });
    if (existing) continue;
    await prisma.companyTask.create({
      data: {
        goalId: t.goalId, parentId: t.id, assignee: 'auditor', createdBy: 'system', risk: 'low',
        title: `検証: ${t.title}`.slice(0, 120),
        instructions: `タスク ${t.id}（担当: ${t.assignee}）の報告を検証してください。get_task で報告の全文を読み、artifacts に書かれた成果物（メモリのキー・実装タスクのキー・作成したタスク）が実際に存在するか、facts の数字が道具で取り直した値と一致するかを確認します。\n最後に finish_task の summary の1行目を必ず「判定: 合格」または「判定: 不合格」で始め、根拠を書いてください。`
      }
    });
  }
}

// 監査役の判定を元のタスクに反映する
async function applyAuditVerdicts() {
  const audits = await prisma.companyTask.findMany({ where: { assignee: 'auditor', status: 'done', parentId: { not: null }, verification: { equals: Prisma.DbNull } }, take: 20 });
  for (const a of audits) {
    const summary = String((a.result as any)?.summary ?? '');
    const passed = /判定[:：]\s*合格/.test(summary);
    const failed = /判定[:：]\s*不合格/.test(summary);
    if (!passed && !failed) continue;
    const parent = await prisma.companyTask.findUnique({ where: { id: a.parentId! } });
    if (parent && parent.status === 'verifying') {
      await prisma.companyTask.update({ where: { id: parent.id }, data: { status: passed ? 'done' : 'failed', verification: { passed, findings: summary, checkedAt: new Date().toISOString(), auditTaskId: a.id } as any } });
      await emitEvent(passed ? 'task.verified' : 'task.rejected_by_audit', 'auditor', { title: parent.title, findings: summary.slice(0, 300) }, parent.id);
      if (!passed) {
        const { say, discordConfigured } = await import('../crew/discord');
        if (discordConfigured()) await say('kei', 'company', `🔍 監査で不合格: **${parent.title}**（担当 ${parent.assignee}）\n${summary.slice(0, 600)}`).catch(() => {});
      }
    }
    // 監査タスク自身にも印を付けて、二度処理しない
    await prisma.companyTask.update({ where: { id: a.id }, data: { verification: { passed, applied: true } as any } });
  }
}

export async function ceoDailyCycle(day: string) {
  const goal = await prisma.companyGoal.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });
  if (!goal) return;
  await createIfAbsent({
    assignee: 'ceo', createdBy: 'system', goalId: goal.id, title: `日次の経営見直し ${day}`,
    instructions: [
      '毎日の経営見直しです。次の順に進めてください。',
      '1. get_goals と get_metrics(30) と get_costs で、KPIの実績・推移・AI費用を確認する',
      '2. list_tasks(status=done) と list_tasks(status=failed) と list_actions(status=pending) で、前日の成果・失敗・承認待ちを確認する',
      '3. read_memory(company, strategy) の計画と比べ、差とその理由を短く整理する',
      '4. 今日の重点を最大3つ決め、create_task で coo に委任する（1つの重点につき1タスク。目的・期待する成果物・期限を書く）。すでに同じ内容の未完了タスクがあれば作らない',
      '5. write_memory(dept:executive, daily-' + day + ') に、見直しの内容（KPI・差・判断・委任したこと）を残す',
      '6. オーナーの判断が必要なこと（お金・法律・大きな方針）があれば report_to_owner（needsDecision=true）。なければ、週に1回（月曜）だけ要約を report_to_owner する',
      '7. finish_task で報告する'
    ].join('\n')
  });
}

export async function weeklyCycle(day: string) {
  const goal = await prisma.companyGoal.findFirst({ where: { status: 'active' }, orderBy: { createdAt: 'desc' } });
  await createIfAbsent({
    assignee: 'finance', createdBy: 'system', goalId: goal?.id ?? null, title: `週次の財務報告 ${day}`,
    instructions: 'get_ledger・get_costs・get_metrics(30)・get_plan_config を使い、今週の収入（プラン・確定報酬のAWP分）、AI費用（会社・利用者向け）、利用者1人あたりの費用、各プランの採算（AI利用枠が実際にどれだけ使われているか）を計算し、write_memory(dept:finance, weekly-' + day + ') に残して finish_task で報告してください。計算の根拠（取得した数字）を必ず書くこと。'
  });
  await createIfAbsent({
    assignee: 'data', createdBy: 'system', goalId: goal?.id ?? null, title: `週次の指標レポート ${day}`,
    instructions: 'get_metrics(30) と get_goals を使い、KPIの実績と計画（read_memory(company, strategy) の四半期目標）の差、伸びている導線・伸びていない導線、来週注目すべき指標を、write_memory(dept:data, weekly-' + day + ') に残して finish_task で報告してください。推定は推定と書くこと。'
  });
  await createIfAbsent({
    assignee: 'auditor', createdBy: 'system', goalId: goal?.id ?? null, title: `週次監査 ${day}`,
    instructions: 'list_events(limit=100)・list_actions・list_tasks を使い、今週の経営判断（CEOの委任）と各エージェントの報告に、根拠のない数字・自己申告だけの完了・権限を超える操作の試みがないかを監査し、write_memory(agent:auditor, weekly-' + day + ') に残して finish_task で報告してください。summary の1行目は「判定: 合格」または「判定: 不合格」。'
  });
}

let running = false;
export async function companyTick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    if (!process.env.ANTHROPIC_API_KEY) return;
    if (await getFlag(SETTING_KEYS.pauseCompany)) return;
    const { day, hour, weekday } = jst(now);
    const settings = await getCompanySettings();
    await setState('company:lastTick', new Date().toISOString());

    if (hour >= settings.ceoHour && (await state('company:ceoDay')) !== day) {
      await setState('company:ceoDay', day);
      await ceoDailyCycle(day);
      if (weekday === 1) await weeklyCycle(day);
    }

    // 再起動などで途中のまま残った実行を戻す（20分を超えて running のもの）
    await recoverStaleRuns(20 * 60_000);
    await applyAuditVerdicts();
    await queueAudits();

    const active = await prisma.companyTask.count({ where: { status: 'running' } });
    const slots = settings.concurrency - active;
    if (slots > 0) {
      const due = await prisma.companyTask.findMany({ where: { status: 'queued', runAt: { lte: now } }, orderBy: [{ createdAt: 'asc' }], take: slots });
      await Promise.all(due.map((t) => runTask(t.id).catch((e) => console.error('company task failed', t.id, e?.message))));
    }
  } catch (e: any) {
    console.error('company tick failed', e?.message);
    void captureError('company_tick', e);
  } finally {
    running = false;
  }
}

// 実行中のまま止まったタスクを待機に戻す（起動時は全部、通常は一定時間を超えたもの）
export async function recoverStaleRuns(olderThanMs: number) {
  const stale = await prisma.companyTask.findMany({ where: { status: 'running', startedAt: { lt: new Date(Date.now() - olderThanMs) } }, select: { id: true, attempts: true } });
  for (const t of stale) {
    await prisma.companyTask.update({ where: { id: t.id }, data: t.attempts >= 3 ? { status: 'failed', error: '実行が途中で止まりました（再試行の上限）' } : { status: 'queued', runAt: new Date() } });
    await prisma.agentRun.updateMany({ where: { taskId: t.id, finishedAt: null }, data: { status: 'error', error: '中断', finishedAt: new Date() } });
    await emitEvent('task.recovered', 'system', { attempts: t.attempts }, t.id);
  }
}

export function startCompany() {
  void seedCompany().catch((e) => console.error('company seed failed', e?.message));
  void recoverStaleRuns(0).catch(() => {});
  setInterval(() => void companyTick(), 60_000);
}
