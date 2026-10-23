import prisma from '../prisma';
import { OWNER_KEY } from './ownerTasks';

// オーナーの時間予算（オーナー決定 2026-10-23）
// - 年内（〜2026-12-31）は 1 日 180 分、2027-01-01 からは 1 日 720 分
// - 優先順: 1=受託の成約・売上直結 / 2=ドッグフーディング（AWP を自分で使って直す）/ 3=SNS 発信 / 4=その他
// - 未完了のオーナータスクに「推定所要時間（estimateMin）」と「優先度（ownerPriority）」を付け、
//   優先度→期日→短いもの の順に、1 日の合計が予算を超えないよう日付（budgetDay）を割り当てる。
//   予算に入らなかったものは翌日以降へ送る（＝今日の一覧から自動で外れる）。
export const OWNER_MINUTES_UNTIL_2026 = 180;
export const OWNER_MINUTES_FROM_2027 = 720;
export const PRIORITY_LABEL: Record<number, string> = { 1: '受託の成約・売上直結', 2: 'ドッグフーディングの修正', 3: 'SNS発信', 4: 'その他' };

export const jstDay = (d = new Date()) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(new Date(`${day}T00:00:00+09:00`).getTime() + n * 86_400_000 + 9 * 3600_000).toISOString().slice(0, 10);

export function ownerMinutesPerDay(day = jstDay()) {
  return day <= '2026-12-31' ? OWNER_MINUTES_UNTIL_2026 : OWNER_MINUTES_FROM_2027;
}

const P1 = /受託|成約|提案|見積|契約|請求|入金|営業|雅テック|案件|商談|融資|クライアント|顧客|納品|検収|売上/;
const P2 = /ドッグフーディング|不具合|修正|バグ|自社|使い込|検証|改善|動作確認|使ってみ/;
const P3 = /SNS|投稿|Instagram|TikTok|YouTube|発信|動画|リール|ショート|告知|\bX\b/i;

// 題名と指示文から優先度を推定する（エージェントが明示した値があればそれを使う）
export function classifyOwnerPriority(title: string, instructions?: string | null): 1 | 2 | 3 | 4 {
  const s = `${title}\n${instructions ?? ''}`;
  if (P1.test(s)) return 1;
  if (P2.test(s)) return 2;
  if (P3.test(s)) return 3;
  return 4;
}

// 指示文の「見込み N分」や「(N分)」から推定時間を拾う。無ければ 30 分
export function estimateFromText(instructions?: string | null, fallback = 30) {
  const m = /見込み\s*(\d{1,3})\s*分|(\d{1,3})\s*分/.exec(instructions ?? '');
  const n = Number(m?.[1] ?? m?.[2]);
  return Number.isFinite(n) && n >= 5 && n <= 480 ? n : fallback;
}

export type OwnerBudgetRow = { id: string; title: string; status: string; estimateMin: number; ownerPriority: number; priorityLabel: string; budgetDay: string | null; runAt: string };
export type OwnerBudget = { day: string; minutesPerDay: number; plannedMin: number; remainingMin: number; today: OwnerBudgetRow[]; deferred: OwnerBudgetRow[]; deferredCount: number };

// 未完了のオーナータスクに時間予算を割り当てる（毎回計算し直す。完了・取り消しは触らない）
export async function planOwnerBudget(day = jstDay()): Promise<OwnerBudget> {
  const tasks = await prisma.companyTask.findMany({
    where: { assignee: OWNER_KEY, status: { in: ['queued', 'running'] } },
    select: { id: true, title: true, instructions: true, status: true, estimateMin: true, ownerPriority: true, budgetDay: true, runAt: true, createdAt: true }
  });
  // 1) 推定時間・優先度が無いものに付ける
  const rows = tasks.map((t) => ({
    ...t,
    estimateMin: t.estimateMin ?? estimateFromText(t.instructions),
    ownerPriority: t.ownerPriority ?? classifyOwnerPriority(t.title, t.instructions)
  }));
  // 2) 進行中 → 優先度 → 予定日 → 短いもの
  rows.sort((a, b) => (a.status === 'running' ? -1 : 0) - (b.status === 'running' ? -1 : 0) || a.ownerPriority - b.ownerPriority || a.runAt.getTime() - b.runAt.getTime() || a.estimateMin - b.estimateMin);
  // 3) 日ごとに予算内で詰める（今日から順に。期日が先のものは期日以降に置く）
  const used = new Map<string, number>();
  const assigned = new Map<string, string>();
  for (const r of rows) {
    const earliest = jstDay(r.runAt) > day ? jstDay(r.runAt) : day;
    let d = earliest;
    for (let i = 0; i < 60; i++) {
      const cap = ownerMinutesPerDay(d);
      const u = used.get(d) ?? 0;
      // 予算より長い 1 件は、その日がまだ空ならそのまま置く（分割は人が決める）
      if (u + r.estimateMin <= cap || (u === 0 && r.estimateMin > cap)) { used.set(d, u + r.estimateMin); assigned.set(r.id, d); break; }
      d = addDays(d, 1);
    }
    if (!assigned.has(r.id)) assigned.set(r.id, addDays(day, 60));
  }
  // 4) 変わったものだけ保存
  for (const r of rows) {
    const bd = assigned.get(r.id)!;
    if (r.estimateMin !== tasks.find((t) => t.id === r.id)!.estimateMin || r.ownerPriority !== tasks.find((t) => t.id === r.id)!.ownerPriority || bd !== r.budgetDay) {
      await prisma.companyTask.update({ where: { id: r.id }, data: { estimateMin: r.estimateMin, ownerPriority: r.ownerPriority, budgetDay: bd } }).catch(() => {});
    }
  }
  const toRow = (r: (typeof rows)[number]): OwnerBudgetRow => ({ id: r.id, title: r.title, status: r.status, estimateMin: r.estimateMin, ownerPriority: r.ownerPriority, priorityLabel: PRIORITY_LABEL[r.ownerPriority] ?? 'その他', budgetDay: assigned.get(r.id) ?? null, runAt: r.runAt.toISOString() });
  const today = rows.filter((r) => assigned.get(r.id) === day).map(toRow);
  const deferred = rows.filter((r) => assigned.get(r.id) !== day).map(toRow);
  const plannedMin = today.reduce((a, r) => a + r.estimateMin, 0);
  const minutesPerDay = ownerMinutesPerDay(day);
  return { day, minutesPerDay, plannedMin, remainingMin: Math.max(0, minutesPerDay - plannedMin), today, deferred: deferred.slice(0, 20), deferredCount: deferred.length };
}
