import prisma from '../prisma';
import { COUNCIL_SEED } from './councilSeed';
import { emitEvent } from './tools';
import { listActivity } from './activity';

// AWP 会議室: オーナーの大きな問いを、議長と5人の博士（心理学・社会学・経済学・地政学・天文学）で議論し、
// 合意／未決／次の一手にまとめて会社メモリ council/* に残す。管理画面からいつでも開ける。
// 実行は AI企業のタスク（担当: chair）。Claude Platform では chair がコーディネータで博士がロスター（並列）。
export const COUNCIL_SCOPE = 'council';
export const CHAIR_KEY = 'chair';
export const SCHOLAR_KEYS = ['psychology', 'sociology', 'economics', 'geopolitics', 'astronomy'];

export async function seedCouncil() {
  for (const s of COUNCIL_SEED) {
    const row = await prisma.companyMemory.findUnique({ where: { scope_key: { scope: COUNCIL_SCOPE, key: s.key } } });
    if (row) continue; // 一度入れたら上書きしない（会議で更新されるため）
    await prisma.companyMemory.create({ data: { scope: COUNCIL_SCOPE, key: s.key, content: s.content, updatedBy: 'system' } });
  }
}

function slugify(topic: string) {
  const ascii = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return ascii.length >= 3 ? ascii : `topic-${Date.now().toString(36)}`;
}

export function councilInstructions(topic: string, day: string, key: string) {
  return [
    `【AWP 会議室】議題: ${topic}`,
    '',
    'あなたは議長です。次の順に進めてください。',
    '1. read_memory(company, vision) と read_memory(council, open-questions) と、直近の council/* を read_memory で読み、議題を「決めること／決めないこと」の1〜2文に整える。',
    '2. 5人の博士（心理学・社会学・経済学・地政学・天文学）に同じ議題を渡し、それぞれ「結論 → 根拠（学説・事例の名前と確信度）→ AWPへの要件（3つまで、測れる形）→ 反対意見への応答 → 指標」で答えさせる。チーム（send_to_agent）が使えるときは並列に任せ、使えないときは自分が5人を順に演じて書く。本番の数字が要るなら get_metrics / get_overview で取る。',
    '3. 対立点を表にする（誰と誰が・何について・なぜ）。重要な対立は、当事者2人に相手の主張を渡して反論を求める。',
    '4. 「合意した要件（番号付き）」「未決（オーナーが決めること。選択肢つき）」「次の一手（誰が・いつまでに・成果物）」の3つにまとめる。',
    `5. 議事録を Markdown で write_memory(${COUNCIL_SCOPE}, ${key}) に保存する（見出し: 議題 / 出席 / 各博士の見解（要約） / 対立点 / 合意した要件 / 未決 / 次の一手。A4で2〜4枚）。`,
    `6. 未決が増減したら write_memory(${COUNCIL_SCOPE}, open-questions) を更新する（優先順の番号付きリスト）。`,
    '7. finish_task の summary は「結論 → 合意の要点 → オーナーに決めてほしいこと」を5行以内で。artifacts に保存したメモリのキーを書く。次の一手は create_task で勝手に作らず、nextActions に「誰が・何を」を書く（オーナーが承認してから登録する）。',
    '',
    '決まり: 博士の見解は事実・学説・推測を分ける。統計や研究を捏造しない。知らないことは「知らない」と書く。オーナーの構想を否定せず、不可能・違法・危険な部分は率直に言い、代替案を添える。',
    `今日は ${day}。`
  ].join('\n');
}

// 会議を開く（タスクを作る）。すぐに実行キューへ
export async function openCouncil(topic: string, openedBy: string) {
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const key = `${day}-${slugify(topic)}`;
  const task = await prisma.companyTask.create({
    data: {
      assignee: CHAIR_KEY, createdBy: openedBy, risk: 'low',
      title: `会議: ${topic}`.slice(0, 120),
      instructions: councilInstructions(topic, day, key),
      runAt: new Date()
    }
  });
  await emitEvent('council.opened', 'owner', { taskId: task.id, topic, key }, task.id);
  return { task, key };
}

export async function councilOverview() {
  const [vision, memories, tasks] = await Promise.all([
    prisma.companyMemory.findUnique({ where: { scope_key: { scope: 'company', key: 'vision' } } }),
    prisma.companyMemory.findMany({ where: { scope: COUNCIL_SCOPE }, orderBy: { updatedAt: 'desc' } }),
    prisma.companyTask.findMany({ where: { assignee: CHAIR_KEY }, orderBy: { createdAt: 'desc' }, take: 20, include: { runs: { select: { id: true, status: true, engine: true, sessionId: true, costUsd: true } } } })
  ]);
  const activity = listActivity().filter((a) => a.agent === CHAIR_KEY || SCHOLAR_KEYS.includes(a.agent));
  return {
    vision: vision?.content ?? null,
    openQuestions: memories.find((m) => m.key === 'open-questions')?.content ?? null,
    sessions: memories.filter((m) => m.key !== 'open-questions').map((m) => ({ key: m.key, updatedAt: m.updatedAt, updatedBy: m.updatedBy, title: (m.content.match(/^#\s*(.+)$/m)?.[1] ?? m.key).slice(0, 120), content: m.content })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, createdAt: t.createdAt, finishedAt: t.finishedAt, error: t.error, costUsd: t.costUsd, summary: (t.result as any)?.summary ?? null, nextActions: (t.result as any)?.nextActions ?? [], artifacts: (t.result as any)?.artifacts ?? [], runs: t.runs })),
    activity
  };
}
