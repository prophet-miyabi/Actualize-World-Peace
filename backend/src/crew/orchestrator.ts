import prisma from '../prisma';
import { githubConfigured, createClaudeIssue } from '../lib/github';
import { getFlag, SETTING_KEYS } from '../lib/systemSettings';
import { captureError } from '../lib/errors';
import { discordConfigured, getState, setState, say, postWithButtons, squadThread } from './discord';
import * as gh from './github';
import { buildDayPlan, currentBlock, formatPlan, getPlan, DAY_END, DAY_START, type Block } from './planner';
import { LAUNCH_DAY, seedCrewTasks } from './seed';
import { addDays, dayLabel, daysBetween, fromHHMM, jstNow, toHHMM } from './time';
import { isPersona, type PersonaKey } from './personas';

// ローンチ・クルーの進行役。1分ごとに呼ばれ、次のことを行う:
// - 09:30 以降に、その日の予定（15分刻み）を作って #📅-今日の予定 に出す
// - 15分ごとに #⏱-いまやること に、いまやることをボタン付きで出す（前の枠のタスクは残り時間を15分減らす）
// - 5分ごとに GitHub を確認し、エージェントのタスクを進める（課題作成 → 実装完了でPR → レビュー依頼 → 合否 → マージで完了）
// - 19:05 以降に、1日の振り返りと公開日までの見通しを #📈-進捗 に出す
const WIP_LIMIT = Number(process.env.CREW_WIP_LIMIT || 2);
const PLAN_POST_AT = fromHHMM('09:30');
const REPORT_AT = DAY_END + 5;
const IMPLEMENT_TIMEOUT_MS = 2 * 3600_000;

export async function log(agent: string, kind: string, message: string, taskKey?: string) {
  await prisma.crewLog.create({ data: { agent, kind, message: message.slice(0, 2000), taskKey } }).catch(() => {});
}

function members(agents: string[]): PersonaKey[] {
  const list = agents.filter(isPersona);
  return list.length ? list : ['sora', 'kei'];
}

// ---- 予定 ----

export async function postDayPlan(day: string) {
  const blocks = (await getPlan(day))?.blocks ?? (await buildDayPlan(day));
  const agentTasks = await prisma.crewTask.findMany({
    where: { owner: 'agent', status: { notIn: ['done', 'skipped'] }, planDay: { lte: day } },
    orderBy: [{ planDay: 'asc' }, { priority: 'asc' }]
  });
  const left = daysBetween(day, LAUNCH_DAY);
  const text = [
    `おはよう！**${dayLabel(day)} の予定**だよ。公開（${dayLabel(LAUNCH_DAY)}）まであと **${left}日**。`,
    '',
    formatPlan(blocks),
    '',
    agentTasks.length ? `🤖 **エージェントの担当**\n${agentTasks.map((t) => `・${t.key} ${t.title}（${statusLabel(t.status, t.reviewState)}）`).join('\n')}` : '',
    '',
    '15分ごとに #⏱-いまやること でお知らせするね。終わったら「完了」、時間が足りなければ「+15分」を押してね。'
  ].join('\n');
  await say('mina', 'plan', text);
  await prisma.crewDayPlan.update({ where: { day }, data: { postedAt: new Date() } });
}

export function statusLabel(status: string, review?: string | null) {
  if (status === 'review') return review === 'passed' ? 'マージ待ち' : review === 'attention' ? '要確認' : 'レビュー中';
  return ({ todo: '未着手', doing: '実装中', waiting: '返事待ち', blocked: '詰まっている', done: '完了', skipped: 'スキップ' } as Record<string, string>)[status] ?? status;
}

async function announceBlock(day: string, block: Block) {
  if (block.kind !== 'task' || !block.taskKey) {
    await postWithButtons('now', `⏱ **${block.start}-${block.end}** ${block.title}`, []);
    return;
  }
  const task = await prisma.crewTask.findUnique({ where: { key: block.taskKey } });
  if (!task) return;
  if (task.status === 'todo') await prisma.crewTask.update({ where: { key: task.key }, data: { status: 'doing' } });
  const first = block.part?.startsWith('1/');
  const lines = [
    `⏱ **${block.start}-${block.end}**　**${task.key}** ${task.title}（${block.part}）`,
    first && task.steps ? `\n${task.steps}` : '続きをやろう！',
    first ? `\n🎯 完了の条件: ${task.acceptance}` : ''
  ];
  await postWithButtons('now', lines.join('\n'), [
    { id: `done:${task.key}`, label: '✅ 完了', style: 3 },
    { id: `more:${task.key}`, label: '⏩ +15分', style: 2 },
    { id: `stuck:${task.key}`, label: '🆘 つまずいた', style: 4 }
  ]);
}

// 前の枠のタスクが「完了」になっていなければ、残り時間を15分減らす（最低15分は残す）
async function consumePreviousBlock(blocks: Block[], minutes: number) {
  const prev = currentBlock(blocks, minutes - 15);
  if (!prev?.taskKey) return;
  const task = await prisma.crewTask.findUnique({ where: { key: prev.taskKey } });
  if (task && task.status !== 'done' && task.remainingMin > 15) {
    await prisma.crewTask.update({ where: { key: task.key }, data: { remainingMin: task.remainingMin - 15 } });
  }
}

// ---- エージェントのタスク（GitHub） ----

function issueBody(task: { key: string; title: string; acceptance: string; agents: string[] }, depNotes: { key: string; notes: string | null }[]) {
  return [
    `AWPローンチ・クルーからの実装依頼（${task.key}）です。担当: ${members(task.agents).join(' / ')}`,
    '',
    '## やること',
    task.title,
    '',
    '## 完了の条件',
    task.acceptance,
    depNotes.filter((d) => d.notes).length ? `\n## 前のタスクからの引き継ぎ\n${depNotes.filter((d) => d.notes).map((d) => `- ${d.key}: ${d.notes}`).join('\n')}` : '',
    '',
    '## 進め方',
    '1. まず関係するコードを読み、変更方針をこの課題に短くコメントする',
    '2. 実装する（CLAUDE.md のルールに従う。秘密情報はコミットしない）',
    '3. 型チェック（backend/frontend で `npx tsc --noEmit`）が通ることを確認する',
    '4. 完了の条件を1つずつ確認し、結果（○/×と根拠）を最後の報告に表で書く',
    '',
    '※ 本番への反映は、運営者がPRを確認してマージしたときだけです。'
  ].join('\n');
}

function reviewRequest(task: { key: string; acceptance: string }) {
  return [
    '@claude 【ケイ（レビュー担当）からのレビュー依頼】',
    `このPR（${task.key}）を、次の観点でレビューしてください。`,
    '1. 完了の条件をすべて満たしているか（下に再掲）',
    '2. 既存の機能を壊していないか（変更したファイルを使う画面・APIを確認）',
    '3. 認可（他人のデータを操作できないか）・入力の上限・個人情報の扱い',
    '4. スマホ幅（375px）での表示崩れの可能性',
    '5. 事実でない表示・誇張がないか、CLAUDE.md のルールに反していないか',
    '6. 型チェック（backend/frontend で `npx tsc --noEmit`）',
    '',
    '問題が見つかったら、このPRのブランチに修正をコミットしてください（大きな設計変更が必要な場合は修正せず理由を書く）。',
    '最後の報告の**1行目に必ず**「判定: 合格」または「判定: 要確認」と書き、続けて観点ごとの結果を表にしてください。',
    '',
    '### 完了の条件',
    task.acceptance
  ].join('\n');
}

async function dispatchAgentTasks(day: string) {
  const active = await prisma.crewTask.count({ where: { owner: 'agent', status: { in: ['doing', 'review'] } } });
  let slots = WIP_LIMIT - active;
  if (slots <= 0) return;
  const [candidates, done] = await Promise.all([
    prisma.crewTask.findMany({ where: { owner: 'agent', status: 'todo', planDay: { lte: addDays(day, 1) } }, orderBy: [{ priority: 'asc' }, { planDay: 'asc' }, { key: 'asc' }] }),
    prisma.crewTask.findMany({ where: { status: { in: ['done', 'skipped'] } }, select: { key: true, notes: true } })
  ]);
  const doneMap = new Map(done.map((d) => [d.key, d.notes]));
  for (const task of candidates) {
    if (slots <= 0) break;
    if (!task.dependsOn.every((d) => doneMap.has(d))) continue;
    const depNotes = task.dependsOn.map((d) => ({ key: d, notes: doneMap.get(d) ?? null }));
    const issue = await createClaudeIssue(`[${task.key}] ${task.title}`, issueBody(task, depNotes));
    await prisma.crewTask.update({ where: { key: task.key }, data: { status: 'doing', issueNumber: issue.number, issueUrl: issue.url, dispatchedAt: new Date() } });
    const thread = await squadThread(task.epic, members(task.agents));
    await say('sora', 'team', `📝 **${task.key} ${task.title}** の仕様（完了の条件つき）をまとめて、Claude Code に実装を頼んだよ → ${issue.url}`, { threadId: thread ?? undefined });
    await log('sora', 'dispatch', `${task.key} → issue #${issue.number}`, task.key);
    slots--;
  }
}

async function syncAgentTask(task: Awaited<ReturnType<typeof prisma.crewTask.findMany>>[number]) {
  const thread = await squadThread(task.epic, members(task.agents));
  const t = { threadId: thread ?? undefined };

  if (task.status === 'doing' && task.issueNumber) {
    const list = await gh.comments(task.issueNumber);
    const outcome = gh.claudeOutcome(list, task.dispatchedAt ?? task.updatedAt);
    if (outcome === 'error') {
      await prisma.crewTask.update({ where: { key: task.key }, data: { status: 'blocked', notes: 'Claude Code の実行でエラーが起きました' } });
      await say('sora', 'alerts', `⚠ ${task.key} の実装でエラーが起きたよ。課題を確認してね → ${task.issueUrl}`);
      return;
    }
    if (outcome !== 'finished') {
      if (task.dispatchedAt && Date.now() - task.dispatchedAt.getTime() > IMPLEMENT_TIMEOUT_MS && task.reviewState !== 'stale') {
        await prisma.crewTask.update({ where: { key: task.key }, data: { reviewState: 'stale' } });
        await say('mina', 'alerts', `⏳ ${task.key} の実装が2時間たっても終わっていないよ。GitHub Actions の状況を見てね → ${task.issueUrl}`);
      }
      return;
    }
    const branch = await gh.findIssueBranch(task.issueNumber);
    if (!branch) {
      await prisma.crewTask.update({ where: { key: task.key }, data: { status: 'blocked', notes: '実装は終わったがブランチが見つからない（変更なしの可能性）' } });
      await say('sora', 'alerts', `🤔 ${task.key} は実装が終わったけど、変更のブランチが見つからないよ。課題のコメントを確認してね → ${task.issueUrl}`);
      return;
    }
    const pr = await gh.findOrCreatePr(branch, `[${task.key}] ${task.title}`, `Closes #${task.issueNumber}\n\nAWPローンチ・クルーの課題 ${task.key} の実装です。`);
    await gh.comment(pr.number, reviewRequest(task));
    await prisma.crewTask.update({ where: { key: task.key }, data: { status: 'review', branch, prNumber: pr.number, prUrl: pr.url, reviewState: 'requested', reviewRequestedAt: new Date() } });
    await say('sora', 'team', `🧩 実装ができたよ！PRを作ったので、ケイにレビューを頼むね → ${pr.url}`, t);
    await say('kei', 'team', '🔍 受け取ったよ。完了の条件・既存機能・認可・スマホ表示・表示ルールの順に見て、直せるところは直してから判定するね。', t);
    await log('kei', 'review_requested', `${task.key} PR #${pr.number}`, task.key);
    return;
  }

  if (task.status === 'review' && task.prNumber) {
    const state = await gh.prState(task.prNumber);
    if (state.merged) {
      await prisma.crewTask.update({ where: { key: task.key }, data: { status: 'done', doneAt: new Date(), remainingMin: 0 } });
      await say('mina', 'team', `🎉 ${task.key} がマージされて本番に反映されたよ（Renderのデプロイ完了まで数分）。おつかれさま！`, t);
      const unlocked = await prisma.crewTask.findMany({ where: { dependsOn: { has: task.key }, status: 'todo' }, select: { key: true, title: true } });
      if (unlocked.length) await say('mina', 'progress', `🔓 ${task.key} が終わったので、次に進めるようになったよ: ${unlocked.map((u) => `${u.key} ${u.title}`).join(' / ')}`);
      await log('mina', 'merged', `${task.key} PR #${task.prNumber}`, task.key);
      return;
    }
    if (state.closed) {
      await prisma.crewTask.update({ where: { key: task.key }, data: { status: 'blocked', notes: 'PRがマージされずに閉じられました' } });
      await say('mina', 'alerts', `🛑 ${task.key} のPRがマージされずに閉じられたよ。作り直すなら管理画面でタスクを「未着手」に戻してね。`);
      return;
    }
    if (task.reviewState === 'requested' && task.reviewRequestedAt) {
      const verdict = gh.reviewVerdict(await gh.comments(task.prNumber), task.reviewRequestedAt);
      if (!verdict) return;
      await prisma.crewTask.update({ where: { key: task.key }, data: { reviewState: verdict.verdict } });
      if (verdict.verdict === 'passed') {
        await say('kei', 'team', `✅ ${task.key} はレビュー合格！マージ待ちに回すね。`, t);
        await say('tetsu', 'review', [
          `✅ **${task.key} ${task.title}** — レビュー合格、あなたのマージ待ちです`,
          `PR: ${task.prUrl}`,
          '',
          '**マージ前に見てほしいこと**',
          '1. PRの「Files changed」で変更の範囲が想定どおりか',
          '2. ケイのレビュー結果（PRの最後のコメント）',
          '3. 問題なければ「Merge pull request」→ 数分後に本番へ反映',
          '',
          `**マージ後に本番で確認すること（完了の条件）**\n${task.acceptance}`
        ].join('\n'));
      } else {
        await say('kei', 'review', `⚠ **${task.key} ${task.title}** は「要確認」だよ。理由はPRの最後のコメントを見てね → ${task.prUrl}\n方針を決めたら、PRに「@claude 〇〇の方針で直して」とコメントすると続きをやるよ。`);
      }
      await log('kei', `review_${verdict.verdict}`, `${task.key} PR #${task.prNumber}`, task.key);
    }
  }
}

async function syncGithub(day: string) {
  const active = await prisma.crewTask.findMany({ where: { owner: 'agent', status: { in: ['doing', 'review'] } } });
  for (const task of active) {
    try {
      await syncAgentTask(task);
    } catch (e: any) {
      console.error('crew sync failed', task.key, e?.message);
    }
  }
  await dispatchAgentTasks(day);
}

// ---- 振り返り ----

export async function progressSummary(day: string) {
  const all = await prisma.crewTask.findMany();
  const done = all.filter((t) => t.status === 'done' || t.status === 'skipped');
  const late = all.filter((t) => !['done', 'skipped'].includes(t.status) && t.planDay < day);
  const blocked = all.filter((t) => t.status === 'blocked');
  const merging = all.filter((t) => t.status === 'review' && t.reviewState === 'passed');
  const remainingUser = all.filter((t) => t.owner === 'user' && !['done', 'skipped'].includes(t.status)).reduce((a, t) => a + t.remainingMin, 0);
  const daysLeft = Math.max(0, daysBetween(day, LAUNCH_DAY));
  return {
    text: [
      `📊 **進み具合** ${done.length}/${all.length} タスク完了（${Math.round((done.length / Math.max(1, all.length)) * 100)}%）`,
      `公開（${dayLabel(LAUNCH_DAY)}）まで **${daysLeft}日**。あなたの残り作業 約 **${Math.round(remainingUser / 60)}時間**`,
      late.length ? `⏰ 予定より遅れ: ${late.map((t) => t.key).join(', ')}` : '⏰ 遅れているタスクはないよ',
      blocked.length ? `🆘 詰まっている: ${blocked.map((t) => `${t.key}（${t.notes ?? '理由未記入'}）`).join(' / ')}` : '',
      merging.length ? `✅ マージ待ち: ${merging.map((t) => `${t.key} ${t.prUrl}`).join(' / ')}` : ''
    ].filter(Boolean).join('\n'),
    late, blocked
  };
}

async function postEveningReport(day: string) {
  const doneToday = await prisma.crewTask.findMany({ where: { doneAt: { gte: new Date(`${day}T00:00:00+09:00`) } } });
  const summary = await progressSummary(day);
  const tomorrow = addDays(day, 1);
  const plan = await buildDayPlan(tomorrow);
  await say('mina', 'progress', [
    `🌙 **${dayLabel(day)} の振り返り**`,
    doneToday.length ? `今日完了: ${doneToday.map((t) => `${t.key} ${t.title}`).join(' / ')}` : '今日完了したタスクはなかったよ。明日取り戻そう！',
    '',
    summary.text,
    '',
    `**明日（${dayLabel(tomorrow)}）の予定の見込み**`,
    formatPlan(plan.filter((b) => b.kind === 'task'))
  ].join('\n'));
  await prisma.crewDayPlan.update({ where: { day }, data: { reportedAt: new Date() } });
}

// ---- 1分ごとの処理 ----

let running = false;
export async function crewTick(now = new Date()) {
  if (running) return;
  running = true;
  try {
    if (await getFlag(SETTING_KEYS.pauseCrew)) return;
    const { day, minutes } = jstNow(now);

    if (discordConfigured()) {
      if (minutes >= PLAN_POST_AT && minutes < DAY_END) {
        const plan = await getPlan(day);
        if (!plan?.postedAt) {
          if (!plan) await buildDayPlan(day);
          await postDayPlan(day);
        }
      }
      if (minutes >= DAY_START && minutes < DAY_END) {
        const plan = await getPlan(day);
        const block = plan ? currentBlock(plan.blocks, minutes) : null;
        const stamp = block ? `${day} ${block.start}` : null;
        if (block && stamp !== (await getState('lastBlock'))) {
          await setState('lastBlock', stamp!);
          await consumePreviousBlock(plan!.blocks, minutes);
          await announceBlock(day, block);
        }
      }
      if (minutes >= REPORT_AT) {
        const plan = await getPlan(day);
        if (plan && !plan.reportedAt) await postEveningReport(day);
      }
    }

    if (githubConfigured()) {
      const last = Number((await getState('lastGithubSync')) || 0);
      if (Date.now() - last >= 5 * 60_000) {
        await setState('lastGithubSync', String(Date.now()));
        await syncGithub(day);
      }
    }
  } catch (e: any) {
    console.error('crew tick failed', e?.message);
    void captureError('crew_tick', e);
  } finally {
    running = false;
  }
}

export function startCrew() {
  void seedCrewTasks().then((n) => n && console.log(`crew: ${n} tasks seeded`)).catch((e) => console.error('crew seed failed', e?.message));
  setInterval(() => void crewTick(), 60_000);
}

export { toHHMM };
