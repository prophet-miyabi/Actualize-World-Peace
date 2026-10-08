import crypto from 'crypto';
import prisma from '../prisma';
import { seal, open } from '../lib/secretBox';
import { PERSONAS, type PersonaKey } from './personas';

// Discord との通信（公式ドキュメントで確認した仕様）:
// - 送信: Bot トークンで REST API v10（Authorization: Bot <token>）
// - 受信: Interactions Endpoint（X-Signature-Ed25519 / X-Signature-Timestamp を Ed25519 で検証）
// - 役割ごとの名前での発言: チャンネルの Webhook（username を上書き）。スレッドへは ?thread_id=
const API = 'https://discord.com/api/v10';

export function discordConfigured() {
  return !!(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_APPLICATION_ID && process.env.DISCORD_PUBLIC_KEY && process.env.DISCORD_GUILD_ID);
}

export async function discordApi(method: string, path: string, body?: unknown) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    // レート制限: 指示された秒数だけ待って再送する
    if (res.status === 429) {
      const j: any = await res.json().catch(() => ({}));
      await new Promise((r) => setTimeout(r, Math.min(10_000, Math.ceil((j.retry_after ?? 1) * 1000))));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`Discord API ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  throw new Error('Discord API: レート制限が続いています');
}

// ---- 受信した Interaction の署名検証（Ed25519） ----
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export function verifyDiscordSignature(rawBody: Buffer, signature: string | undefined, timestamp: string | undefined) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey || !signature || !timestamp) return false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, 'hex')]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(timestamp), rawBody]), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

// ---- 状態（チャンネルID・Webhook）の保存 ----
export async function getState(key: string) {
  return (await prisma.crewState.findUnique({ where: { key } }))?.value ?? null;
}
export async function setState(key: string, value: string) {
  await prisma.crewState.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export const CHANNELS = {
  plan: { name: '📅-今日の予定', topic: 'ミナが毎朝、15分刻みの予定を出します' },
  now: { name: '⏱-いまやること', topic: '15分ごとに、いまやることをお知らせ。終わったら「完了」を押してね' },
  team: { name: '🛠-開発チーム', topic: 'エージェントのスクワッド（スレッド）。仕様・実装・レビューのやり取り' },
  review: { name: '✅-マージ待ち', topic: 'レビューに合格したPR。あなたが確認してマージすると本番に反映されます' },
  progress: { name: '📈-進捗', topic: '1日の振り返りと、公開日までの見通し' },
  alerts: { name: '🚨-アラート', topic: '本番のエラーや、遅れの警告' },
  ask: { name: '💬-相談', topic: '/ask で質問、/bug で不具合、/add でタスク追加' },
  company: { name: '🏢-AI企業', topic: 'CEOの日次報告・承認待ちの操作・監査の結果' }
} as const;
export type ChannelKey = keyof typeof CHANNELS;

export async function channelId(ch: ChannelKey) {
  return getState(`channel:${ch}`);
}

async function webhookFor(ch: ChannelKey): Promise<{ id: string; token: string } | null> {
  const raw = await getState(`webhook:${ch}`);
  if (!raw) return null;
  try {
    return JSON.parse(open(raw));
  } catch {
    return null;
  }
}

// Discordは1メッセージ2000文字まで。長い文章は分けて送る
function chunks(text: string, size = 1900) {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

// 役割の名前で発言する（Webhook）。threadId を渡すとスクワッドのスレッドに書き込む
export async function say(persona: PersonaKey, ch: ChannelKey, content: string, opts: { threadId?: string } = {}) {
  if (!discordConfigured()) return;
  const hook = await webhookFor(ch);
  if (!hook) return;
  for (const part of chunks(content)) {
    const q = new URLSearchParams({ wait: 'true', ...(opts.threadId ? { thread_id: opts.threadId } : {}) });
    const res = await fetch(`${API}/webhooks/${hook.id}/${hook.token}?${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: PERSONAS[persona].name, content: part, allowed_mentions: { parse: [] } })
    });
    if (!res.ok) throw new Error(`Discord webhook → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// ボタン付きのメッセージ（Botとして送る。ボタンの操作は Interactions Endpoint に届く）
export async function postWithButtons(ch: ChannelKey, content: string, buttons: { id: string; label: string; style?: 1 | 2 | 3 | 4 }[]) {
  if (!discordConfigured()) return null;
  const id = await channelId(ch);
  if (!id) return null;
  return discordApi('POST', `/channels/${id}/messages`, {
    content: content.slice(0, 1990),
    allowed_mentions: { parse: [] },
    components: buttons.length ? [{ type: 1, components: buttons.slice(0, 5).map((b) => ({ type: 2, style: b.style ?? 2, label: b.label, custom_id: b.id })) }] : []
  });
}

// スクワッド（エピックごとのスレッド）を用意する。なければ作り、メンバーを紹介する
export async function squadThread(epic: string, members: PersonaKey[]): Promise<string | null> {
  if (!discordConfigured()) return null;
  const saved = await getState(`squad:${epic}`);
  if (saved) return saved;
  const team = await channelId('team');
  if (!team) return null;
  const thread = await discordApi('POST', `/channels/${team}/threads`, { name: `スクワッド｜${epic}`.slice(0, 95), type: 11, auto_archive_duration: 10080 });
  await setState(`squad:${epic}`, thread.id);
  const roster = members.map((m) => `・${PERSONAS[m].name} — ${PERSONAS[m].role}`).join('\n');
  await say('sora', 'team', `スクワッド「${epic}」を結成したよ！\n${roster}`, { threadId: thread.id });
  return thread.id;
}

// 初期設定: カテゴリ・チャンネル・Webhook・スラッシュコマンドを作る（何度実行しても重複しない）
export async function setupDiscord() {
  const guild = process.env.DISCORD_GUILD_ID!;
  let category = await getState('channel:category');
  const existing: any[] = await discordApi('GET', `/guilds/${guild}/channels`);
  if (!category || !existing.some((c) => c.id === category)) {
    const cat = await discordApi('POST', `/guilds/${guild}/channels`, { name: '🚀 AWP ローンチ', type: 4 });
    category = cat.id as string;
    await setState('channel:category', category);
  }
  for (const [key, ch] of Object.entries(CHANNELS) as [ChannelKey, (typeof CHANNELS)[ChannelKey]][]) {
    let id = await channelId(key);
    if (!id || !existing.some((c) => c.id === id)) {
      const created = await discordApi('POST', `/guilds/${guild}/channels`, { name: ch.name, type: 0, parent_id: category, topic: ch.topic });
      id = created.id as string;
      await setState(`channel:${key}`, id);
      await prisma.crewState.deleteMany({ where: { key: `webhook:${key}` } });
    }
    if (!(await webhookFor(key))) {
      const hook = await discordApi('POST', `/channels/${id}/webhooks`, { name: 'AWP Crew' });
      await setState(`webhook:${key}`, seal(JSON.stringify({ id: hook.id, token: hook.token })));
    }
  }
  await registerCommands();
}

export async function registerCommands() {
  const task = { type: 3, name: 'task', description: 'タスクの番号（例: T05）', required: true };
  const commands = [
    { name: 'today', description: '今日の予定（15分刻み）を表示' },
    { name: 'now', description: 'いまやることを表示' },
    { name: 'done', description: 'タスクを完了にする', options: [task, { type: 3, name: 'memo', description: '後続のタスクに引き継ぐメモ（例: 決めた運営者情報）', required: false }] },
    { name: 'block', description: 'タスクで詰まったことを知らせる', options: [task, { type: 3, name: 'reason', description: '何で止まっている？', required: true }] },
    { name: 'add', description: 'あなたのタスクを追加', options: [{ type: 3, name: 'title', description: 'やること', required: true }, { type: 4, name: 'minutes', description: '見込み時間（分）', required: false }] },
    { name: 'bug', description: '不具合を報告（修正タスクになり、エージェントが対応します）', options: [{ type: 3, name: 'detail', description: 'どの画面で・何をしたら・どうなった？', required: true }] },
    { name: 'status', description: '公開日までの進み具合' },
    { name: 'replan', description: '今日の残りの予定を組み直す' },
    { name: 'ask', description: 'クルーに質問する', options: [{ type: 3, name: 'question', description: '質問', required: true }] }
  ];
  await discordApi('PUT', `/applications/${process.env.DISCORD_APPLICATION_ID}/guilds/${process.env.DISCORD_GUILD_ID}/commands`, commands);
}
