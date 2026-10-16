import prisma from '../prisma';
import { emitEvent } from './tools';

// オーナー（Miyabi）のタスク。AWP企業のタスク一覧で、エージェントのタスクと同じ場所で管理する。
// - 担当キーは 'owner'。エージェントの実行ループは拾わない（人がやる仕事）
// - ローンチ・クルーの作業板（CrewTask の owner='user'）を取り込み、状態を双方向に合わせる
//   crew: todo/waiting/blocked/review → queued（未着手）, doing → running（進行中）, done/skipped → done
//   company 側でオーナーが「完了」にしたら crew 側も done にする
export const OWNER_KEY = 'owner';
export const OWNER_NAME = 'Miyabi（オーナー）';

const CREW_PREFIX = /^\[([A-Z]\d{2})\]\s/;

function crewToCompanyStatus(s: string): 'queued' | 'running' | 'done' {
  if (s === 'done' || s === 'skipped') return 'done';
  if (s === 'doing') return 'running';
  return 'queued';
}

export async function syncOwnerTasksFromCrew() {
  const crew = await prisma.crewTask.findMany({ where: { owner: 'user' }, orderBy: [{ priority: 'asc' }, { planDay: 'asc' }] });
  if (crew.length === 0) return;
  const existing = await prisma.companyTask.findMany({ where: { assignee: OWNER_KEY, createdBy: 'crew' }, select: { id: true, title: true, status: true, updatedAt: true } });
  const byKey = new Map(existing.map((t) => [CREW_PREFIX.exec(t.title)?.[1] ?? '', t]));
  for (const c of crew) {
    const title = `[${c.key}] ${c.title}`.slice(0, 120);
    const status = crewToCompanyStatus(c.status);
    const instructions = [
      `目標日: ${c.planDay}${c.dueDay ? `（期限 ${c.dueDay}）` : ''} / 見込み ${c.estimateMin}分 / 区分 ${c.area}`,
      c.steps ? `\n【手順】\n${c.steps}` : '',
      `\n【完了の条件】\n${c.acceptance}`,
      c.dependsOn.length ? `\n前提: ${c.dependsOn.join(', ')}` : '',
      c.notes ? `\n【メモ】\n${c.notes}` : ''
    ].filter(Boolean).join('\n');
    const found = byKey.get(c.key);
    if (!found) {
      await prisma.companyTask.create({ data: { assignee: OWNER_KEY, createdBy: 'crew', title, instructions, status, risk: 'low', runAt: new Date(`${c.planDay}T00:00:00+09:00`), finishedAt: status === 'done' ? (c.doneAt ?? new Date()) : null } });
      continue;
    }
    // 取り消し済みはそのまま。状態が違えば crew 側に合わせる（crew が作業板の正）
    if (found.status !== 'canceled' && found.status !== status) {
      await prisma.companyTask.update({ where: { id: found.id }, data: { status, title, instructions, finishedAt: status === 'done' ? new Date() : null } });
    } else if (found.title !== title) {
      await prisma.companyTask.update({ where: { id: found.id }, data: { title, instructions } });
    }
  }
}

// オーナーが一覧から状態を変える（未着手 / 進行中 / 完了 / 取り消し）。crew 由来なら作業板にも反映する
export async function setOwnerTaskStatus(id: string, status: 'queued' | 'running' | 'done' | 'canceled', note?: string) {
  const t = await prisma.companyTask.findUnique({ where: { id } });
  if (!t || t.assignee !== OWNER_KEY) return null;
  const result = note ? { ...((t.result as object) ?? {}), summary: note } : t.result;
  const updated = await prisma.companyTask.update({
    where: { id },
    data: { status, result: result as any, finishedAt: status === 'done' ? new Date() : null, startedAt: status === 'running' ? (t.startedAt ?? new Date()) : t.startedAt }
  });
  const crewKey = CREW_PREFIX.exec(t.title)?.[1];
  if (crewKey && t.createdBy === 'crew') {
    const crewStatus = status === 'done' ? 'done' : status === 'running' ? 'doing' : status === 'canceled' ? 'skipped' : 'todo';
    await prisma.crewTask.update({ where: { key: crewKey }, data: { status: crewStatus, ...(status === 'done' ? { doneAt: new Date() } : {}), ...(note ? { notes: note.slice(0, 2000) } : {}) } }).catch(() => {});
  }
  await emitEvent(status === 'done' ? 'owner_task.done' : 'owner_task.status', OWNER_KEY, { id, status, title: t.title });
  return updated;
}
