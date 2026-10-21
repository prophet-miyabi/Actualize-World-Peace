#!/usr/bin/env node
// 案件の取り込み: input/<案件ID>/ を作り、job_post.txt（本文）と meta.json を置く。
//   node auto-sales-agent/scripts/new.js <案件ID> [URL | テキストファイルのパス]
//   例: node auto-sales-agent/scripts/new.js 20261021-cw-reform https://crowdworks.jp/public/jobs/XXXX
//       node auto-sales-agent/scripts/new.js 20261021-ln-seitai ./job.txt
//   引数なしで本文を標準入力から受け取ることもできる（貼り付けて Ctrl+Z / Ctrl+D）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const [id, src] = process.argv.slice(2);
if (!id || !/^[a-z0-9-]+$/.test(id)) { console.error('案件IDを半角英小文字・数字・ハイフンで指定してください。例: 20261021-cw-reform'); process.exit(1); }
const dir = path.join(ROOT, 'input', id);
fs.mkdirSync(dir, { recursive: true });

async function readSource() {
  if (!src) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return { text: Buffer.concat(chunks).toString('utf8'), url: '' };
  }
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0 (AWP Auto-Sales-Agent; manual review)' } });
    const html = await res.text();
    // 本文らしい部分だけ残す（script/style を除き、タグを落とす）。構造は媒体ごとに違うので、後で人が確認する前提
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<\/(p|div|li|h\d|tr|br)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
    return { text, url: src, status: res.status };
  }
  return { text: fs.readFileSync(path.resolve(src), 'utf8'), url: '' };
}

readSource().then(({ text, url, status }) => {
  if (!text.trim()) { console.error('本文が空です'); process.exit(1); }
  fs.writeFileSync(path.join(dir, 'job_post.txt'), text, 'utf8');
  if (url) fs.writeFileSync(path.join(dir, 'job_url.txt'), url, 'utf8');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ id, url, fetchedAt: new Date().toISOString(), httpStatus: status ?? null, chars: text.length }, null, 2), 'utf8');
  console.log(`取り込みました: ${path.relative(process.cwd(), dir)} （${text.length} 文字${status ? `, HTTP ${status}` : ''}）`);
  console.log('次: brief.json を書く（Claude Code の /pitch か、node auto-sales-agent/scripts/analyze.js ' + id + '）');
}).catch((e) => { console.error('取り込みに失敗:', e.message); process.exit(1); });
