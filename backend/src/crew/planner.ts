import prisma from '../prisma';
import { SEED } from './seed';
import { addDays, fromHHMM, toHHMM } from './time';

// 1日の予定を15分刻みで組む（AIを使わず、決まったルールで毎回同じ結果になるようにする）。
// 作業時間は 10:00〜19:00、13:00〜14:00 は昼休み。決まった時間に朝会・PRレビュー・休憩・振り返りを入れ、
// 残りの枠に「あなたのタスク」を、目標日→優先度→計画の順で、見込み時間ぶん並べる
export type Block = { start: string; end: string; kind: 'task' | 'routine' | 'break'; taskKey?: string; title: string; part?: string };

export const DAY_START = fromHHMM(process.env.CREW_DAY_START || '10:00');
export const DAY_END = fromHHMM(process.env.CREW_DAY_END || '19:00');
const LUNCH = [fromHHMM('13:00'), fromHHMM('14:00')];
const ROUTINES: Record<string, { kind: Block['kind']; title: string }> = {
  '10:00': { kind: 'routine', title: '☀️ 朝会: 今日の予定とマージ待ちのPRを確認' },
  '12:45': { kind: 'routine', title: '✅ PRレビュー: #✅-マージ待ち を確認してマージ' },
  '15:45': { kind: 'break', title: '☕ 休憩（目と肩を休めよう）' },
  '16:45': { kind: 'routine', title: '✅ PRレビュー: #✅-マージ待ち を確認してマージ' },
  '18:45': { kind: 'routine', title: '🌙 振り返り: 終わったタスクを「完了」に、明日の予定を確認' }
};

const ORDER = new Map(SEED.map((t, i) => [t.key, i]));
const LOOKAHEAD_DAYS = 2;

type PlanTask = { key: string; title: string; remainingMin: number; planDay: string; priority: number; dependsOn: string[] };

export async function plannableUserTasks(day: string): Promise<PlanTask[]> {
  const [tasks, done] = await Promise.all([
    prisma.crewTask.findMany({
      where: { owner: 'user', status: { in: ['todo', 'doing'] }, planDay: { lte: addDays(day, LOOKAHEAD_DAYS) } },
      select: { key: true, title: true, remainingMin: true, planDay: true, priority: true, dependsOn: true }
    }),
    prisma.crewTask.findMany({ where: { status: { in: ['done', 'skipped'] } }, select: { key: true } })
  ]);
  const doneSet = new Set(done.map((d) => d.key));
  return tasks
    .filter((t) => t.dependsOn.every((d) => doneSet.has(d)))
    .sort((a, b) => a.planDay.localeCompare(b.planDay) || a.priority - b.priority || (ORDER.get(a.key) ?? 999) - (ORDER.get(b.key) ?? 999) || a.key.localeCompare(b.key));
}

// fromMin を渡すと、その時刻より前の枠は今の予定のまま残し、以降だけを組み直す
export async function buildDayPlan(day: string, fromMin = DAY_START): Promise<Block[]> {
  const existing = await prisma.crewDayPlan.findUnique({ where: { day } });
  const kept = ((existing?.blocks as Block[] | undefined) ?? []).filter((b) => fromHHMM(b.start) < fromMin);
  const tasks = await plannableUserTasks(day);
  // すでに残した枠で使った分は、残り時間から差し引かない（残り時間は枠の終了ごとに減らしている）
  const queue = tasks.map((t) => ({ ...t, blocksLeft: Math.max(1, Math.ceil(t.remainingMin / 15)), total: Math.max(1, Math.ceil(t.remainingMin / 15)) }));
  const blocks: Block[] = [...kept];
  for (let m = Math.max(DAY_START, Math.floor(fromMin / 15) * 15); m < DAY_END; m += 15) {
    if (blocks.some((b) => b.start === toHHMM(m))) continue;
    const start = toHHMM(m);
    const end = toHHMM(m + 15);
    if (m >= LUNCH[0] && m < LUNCH[1]) {
      if (m === LUNCH[0]) blocks.push({ start, end: toHHMM(LUNCH[1]), kind: 'break', title: '🍙 昼休み' });
      continue;
    }
    const routine = ROUTINES[start];
    if (routine) {
      blocks.push({ start, end, ...routine });
      continue;
    }
    const next = queue.find((q) => q.blocksLeft > 0);
    if (!next) {
      blocks.push({ start, end, kind: 'routine', title: '🧹 予備: 遅れの取り戻し・PR確認・/bug の報告' });
      continue;
    }
    const index = next.total - next.blocksLeft + 1;
    next.blocksLeft--;
    blocks.push({ start, end, kind: 'task', taskKey: next.key, title: next.title, part: `${index}/${next.total}` });
  }
  blocks.sort((a, b) => fromHHMM(a.start) - fromHHMM(b.start));
  await prisma.crewDayPlan.upsert({ where: { day }, update: { blocks: blocks as any }, create: { day, blocks: blocks as any } });
  return blocks;
}

export async function getPlan(day: string) {
  const p = await prisma.crewDayPlan.findUnique({ where: { day } });
  return p ? { ...p, blocks: p.blocks as Block[] } : null;
}

export function currentBlock(blocks: Block[], minutes: number) {
  return blocks.find((b) => fromHHMM(b.start) <= minutes && minutes < fromHHMM(b.end)) ?? null;
}

// Discordに載せる予定表（同じタスクが続く枠はまとめる）
export function formatPlan(blocks: Block[]) {
  const rows: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    let j = i;
    while (j + 1 < blocks.length && blocks[j + 1].taskKey && blocks[j + 1].taskKey === b.taskKey && blocks[j + 1].start === blocks[j].end) j++;
    const label = b.taskKey ? `**${b.taskKey}** ${b.title}` : b.title;
    rows.push(`\`${b.start}-${blocks[j].end}\` ${label}`);
    i = j;
  }
  return rows.join('\n');
}
