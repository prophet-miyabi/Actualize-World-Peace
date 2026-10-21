#!/usr/bin/env node
// バッチ: input/queue/ にある案件を順に「分析 → モックアップ生成 → 公開 → 提案文 → Discord 通知」まで回す。
//   node auto-sales-agent/scripts/batch.js [--max 3] [--no-deploy] [--no-notify]
// 必要な環境変数（環境変数か backend/.env）:
//   ANTHROPIC_API_KEY     分析と提案文の仕上げ（Claude）
//   DISCORD_WEBHOOK_URL   通知先（Discord のチャンネル設定 → 連携サービス → ウェブフック）
//   ASA_DEPLOY            awp（既定）/ cloudflare / vercel
// 1案件あたりの費用の目安: Claude 約 $0.05〜0.10。公開は awp なら無料（git push → Render）。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const QUEUE = path.join(ROOT, 'input', 'queue');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MAX = Number(opt('--max', 3));

// backend/.env を環境変数の補完に使う（秘密はログに出さない）
try {
  const env = fs.readFileSync(path.join(REPO, 'backend', '.env'), 'utf8');
  for (const line of env.split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ''); }
} catch { /* 無ければ環境変数だけ */ }

function run(cmd) { return execSync(cmd, { cwd: REPO, stdio: 'pipe', encoding: 'utf8', env: process.env }).trim(); }
function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

async function claude(system, user, maxTokens = 2500) {
  const Anthropic = require(path.join(REPO, 'backend', 'node_modules', '@anthropic-ai', 'sdk'));
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({ model: process.env.CLAUDE_MODEL || 'claude-opus-5', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

// 提案文の仕上げ（骨組み → 案件文の言葉で具体化）。事実を作らないルールを固定で持たせる
async function polishProposal(skeleton, jobPost, brief) {
  const rules = fs.readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
  const system = `あなたは受託開発の提案文ライターです。下の「ルール」の『提案文のライティングルール』を厳守してください。\n\n${rules}\n\n追加の決まり: 骨組みの構成と公開URLは変えない。「（※ここを案件文に合わせて具体化）」の箇所を案件文の言葉で具体的に書き換える。根拠のない実績・数字・断定を書かない。人工知能の略語（英字2文字）は使わない。本文600〜900字。出力は提案文だけ。`;
  return claude(system, `＜案件文＞\n${jobPost.slice(0, 8000)}\n＜/案件文＞\n\n＜ブリーフ＞\n${JSON.stringify({ client: brief.client, pain: brief.pain, screen: brief.screen, assumptions: brief.assumptions, deadline: brief.deadline, budget: brief.budget }, null, 1).slice(0, 4000)}\n＜/ブリーフ＞\n\n＜提案文の骨組み＞\n${skeleton}\n＜/提案文の骨組み＞`);
}

async function notifyDiscord(parts) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) { log('DISCORD_WEBHOOK_URL が未設定のため通知を飛ばしません'); return false; }
  for (const content of parts) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
    if (!res.ok) { log(`Discord 通知に失敗 (${res.status})`); return false; }
    await new Promise((r) => setTimeout(r, 800));
  }
  return true;
}
// Discord は1メッセージ 2000 文字まで。提案文は段落で分けて送る
function chunk(text, limit = 1900) {
  const out = []; let cur = '';
  for (const para of text.split('\n')) { if ((cur + '\n' + para).length > limit) { out.push(cur); cur = para; } else cur = cur ? `${cur}\n${para}` : para; }
  if (cur) out.push(cur);
  return out;
}

async function processOne(id) {
  const qdir = path.join(QUEUE, id);
  const idir = path.join(ROOT, 'input', id);
  const meta = JSON.parse(fs.readFileSync(path.join(qdir, 'meta.json'), 'utf8'));
  log(`▶ ${id}  ${meta.title}`);
  // 1. queue → input（パイプラインの作業場所）
  fs.mkdirSync(idir, { recursive: true });
  for (const f of ['job_post.txt', 'job_url.txt', 'meta.json']) fs.copyFileSync(path.join(qdir, f), path.join(idir, f));
  // 2. 分析
  run(`node auto-sales-agent/scripts/analyze.js ${id}`);
  const brief = JSON.parse(fs.readFileSync(path.join(idir, 'brief.json'), 'utf8'));
  log(`  分析: ${brief.client?.industry} / ${brief.screen?.template}`);
  // 3. 生成
  run(`node auto-sales-agent/scripts/generate.js ${id}`);
  // 4. 公開
  let url = '（未公開）';
  if (!flag('--no-deploy')) {
    const out = run(`node auto-sales-agent/scripts/deploy.js ${id} ${process.env.ASA_DEPLOY || 'awp'}`);
    const dep = JSON.parse(fs.readFileSync(path.join(idir, 'deploy.json'), 'utf8'));
    url = dep.url || url;
    log(`  公開: ${url}`);
  }
  // 5. 提案文（骨組み → 仕上げ）
  run(`node auto-sales-agent/scripts/propose.js ${id}`);
  const skeletonPath = path.join(ROOT, 'output', `${id}_proposal.md`);
  const skeleton = fs.readFileSync(skeletonPath, 'utf8');
  const jobPost = fs.readFileSync(path.join(idir, 'job_post.txt'), 'utf8');
  let proposal = skeleton;
  try { proposal = await polishProposal(skeleton, jobPost, brief); fs.writeFileSync(skeletonPath, proposal, 'utf8'); log('  提案文: 仕上げ済み'); }
  catch (e) { log(`  提案文の仕上げに失敗（骨組みのまま）: ${e.message}`); }
  // 6. 通知
  const head = `**新しい案件のプロトタイプができました**\n① 案件: ${meta.url}\n　${meta.title}（${meta.budgetMax ? `予算 〜${Number(meta.budgetMax).toLocaleString()}円` : '予算 相談可'}${meta.proposals != null ? `・提案 ${meta.proposals}` : ''}）\n② デモ: ${url}${url.includes('onrender.com') ? '（公開まで3〜5分）' : ''}\n③ 提案文: 下に続く（コピーしてそのまま応募欄へ）`;
  const notified = flag('--no-notify') ? false : await notifyDiscord([head, ...chunk(proposal).map((c) => '```\n' + c.replace(/```/g, "'''") + '\n```')]);
  fs.writeFileSync(path.join(qdir, 'done.json'), JSON.stringify({ id, url, notified, at: new Date().toISOString(), proposalFile: path.relative(REPO, skeletonPath) }, null, 2), 'utf8');
  log(`✔ ${id} 完了${notified ? '（Discord に通知）' : ''}`);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY が未設定です（環境変数か backend/.env）'); process.exit(1); }
  const ids = fs.existsSync(QUEUE) ? fs.readdirSync(QUEUE).filter((d) => fs.existsSync(path.join(QUEUE, d, 'meta.json')) && !fs.existsSync(path.join(QUEUE, d, 'done.json'))).sort() : [];
  if (ids.length === 0) { log('処理する案件はありません（先に scout.js を実行）'); return; }
  log(`${ids.length} 件のうち最大 ${MAX} 件を処理します`);
  let n = 0;
  for (const id of ids.slice(0, MAX)) {
    try { await processOne(id); n++; }
    catch (e) {
      log(`✖ ${id} 失敗: ${e.message.split('\n')[0]}`);
      fs.writeFileSync(path.join(QUEUE, id, 'error.json'), JSON.stringify({ at: new Date().toISOString(), error: e.message.slice(0, 1000) }, null, 2), 'utf8');
    }
  }
  log(`終了: ${n} 件を処理`);
}

main().catch((e) => { console.error(e); process.exit(1); });
