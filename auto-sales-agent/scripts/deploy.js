#!/usr/bin/env node
// デプロイ: dist/<案件ID>/ を公開して、クライアントがスマホ・PCで今すぐ見られるURLを得る。
//   node auto-sales-agent/scripts/deploy.js <案件ID> [awp|cloudflare|vercel]
//   awp（既定）     : frontend/public/demos/<案件ID>/ にコピーして git commit & push。Render の自動デプロイで
//                     3〜5分後に https://awp-frontend-bf17.onrender.com/demos/<案件ID>/ で公開される
//   cloudflare      : npx wrangler pages deploy（CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID が必要）
//   vercel          : npx vercel --prod（vercel login 済みが必要）
// 結果は input/<案件ID>/deploy.json に保存し、提案文（propose.js）が読む。
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const [id, providerArg] = process.argv.slice(2);
if (!id) { console.error('案件IDを指定してください'); process.exit(1); }
const dist = path.join(ROOT, 'dist', id);
if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error(`dist/${id}/index.html がありません。先に generate.js を実行してください`); process.exit(1); }
const provider = providerArg || process.env.ASA_DEPLOY || 'awp';
const SITE = (process.env.ASA_SITE_URL || 'https://awp-frontend-bf17.onrender.com').replace(/\/$/, '');

function sh(cmd, opts = {}) { return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', ...opts }).trim(); }
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f), d = path.join(dst, f);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else if (f !== 'brief.json') fs.copyFileSync(s, d); // brief.json は顧客情報を含むので公開しない
  }
}

let url = '';
let note = '';
if (provider === 'awp') {
  const target = path.join(REPO, 'frontend', 'public', 'demos', id);
  copyDir(dist, target);
  // robots: デモは検索に載せない
  fs.writeFileSync(path.join(REPO, 'frontend', 'public', 'demos', 'robots.txt'), 'User-agent: *\nDisallow: /demos/\n', 'utf8');
  const rel = path.relative(REPO, target).replace(/\\/g, '/');
  sh(`git -C "${REPO}" add "${rel}" frontend/public/demos/robots.txt`);
  const changed = sh(`git -C "${REPO}" status --porcelain -- "${rel}"`);
  if (changed) {
    sh(`git -C "${REPO}" commit -q -m "demo: ${id} のプロトタイプを公開" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`);
    sh(`git -C "${REPO}" push -q origin main`);
    note = 'git push 済み。Render の自動デプロイで 3〜5 分後に公開されます（それまでは 404）';
  } else {
    note = '変更なし（前回と同じ内容）';
  }
  url = `${SITE}/demos/${id}/`;
} else if (provider === 'cloudflare') {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) { console.error('CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID を環境変数に設定してください'); process.exit(1); }
  const project = process.env.ASA_CF_PROJECT || 'awp-demos';
  const out = sh(`npx --yes wrangler pages deploy "${dist}" --project-name ${project} --branch ${id} --commit-dirty=true`, { cwd: ROOT });
  const m = /https?:\/\/[^\s]+pages\.dev[^\s]*/.exec(out);
  url = m ? m[0] : '';
  note = url ? '' : `URL を検出できませんでした。出力: ${out.slice(-400)}`;
} else if (provider === 'vercel') {
  const out = sh(`npx --yes vercel "${dist}" --prod --yes --name asa-${id}`, { cwd: ROOT });
  const m = /https?:\/\/[^\s]+vercel\.app[^\s]*/.exec(out);
  url = m ? m[0] : '';
  note = url ? '' : `URL を検出できませんでした。出力: ${out.slice(-400)}`;
} else {
  console.error(`未対応のデプロイ先: ${provider}（awp / cloudflare / vercel）`); process.exit(1);
}

const info = { id, provider, url, note, deployedAt: new Date().toISOString() };
fs.writeFileSync(path.join(ROOT, 'input', id, 'deploy.json'), JSON.stringify(info, null, 2), 'utf8');
console.log(`公開URL: ${url || '（取得できず）'}`);
if (note) console.log(note);
console.log(`次: node auto-sales-agent/scripts/propose.js ${id}`);
