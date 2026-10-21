#!/usr/bin/env node
// モックアップの生成: input/<案件ID>/brief.json + templates/template_<lp|crm|booking>.html → dist/<案件ID>/index.html
//   node auto-sales-agent/scripts/generate.js <案件ID> [lp|crm|booking]
// テンプレートの {{変数}} を置換し、<script id="brief"> にブリーフ全体を埋め込む（画面側の Alpine.js が読む）。
// 生成後は Claude Code が HTML を開き、業界・会社らしさ（文言・ダミーデータ・並び）を仕上げる。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const [id, forced] = process.argv.slice(2);
if (!id) { console.error('案件IDを指定してください'); process.exit(1); }
const dir = path.join(ROOT, 'input', id);
const brief = JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8'));
const template = forced || brief.screen?.template || 'lp';
const tplPath = path.join(ROOT, 'templates', `template_${template}.html`);
if (!fs.existsSync(tplPath)) { console.error(`テンプレートがありません: ${tplPath}`); process.exit(1); }

const c = brief.client || {};
const pal = brief.palette || {};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const vars = {
  id,
  brand: esc(c.brand || '（御社名）'),
  industry: esc(c.industry || ''),
  area: esc(c.area || ''),
  tagline: esc(brief.tagline || (brief.pain?.[0] ? `「${brief.pain[0]}」を、ひとつの画面で。` : `${c.industry || ''}の仕事を、もっとかんたんに。`)),
  target: esc(brief.target || ''),
  primary: /^#[0-9a-fA-F]{6}$/.test(pal.primary || '') ? pal.primary : '#1d4ed8',
  accent: /^#[0-9a-fA-F]{6}$/.test(pal.accent || '') ? pal.accent : '#f59e0b',
  line_url: esc(brief.line_url || 'https://lin.ee/'),
  phone: esc(brief.phone_display || '0120-000-000（見本）'),
  // 予約系の呼び方（スタッフ／キャスト／セラピスト／講師 など。brief.unit_staff で指定）
  unit_staff: esc(brief.unit_staff || 'スタッフ'),
  generated_on: new Date().toISOString().slice(0, 10),
  // Alpine が読む JSON（</script> 対策でエスケープ）
  brief_json: JSON.stringify(brief).replace(/</g, '\\u003c')
};

let html = fs.readFileSync(tplPath, 'utf8');
const missing = new Set();
html = html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => { if (vars[k] === undefined) { missing.add(k); return ''; } return vars[k]; });

const out = path.join(ROOT, 'dist', id);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html, 'utf8');
fs.writeFileSync(path.join(out, 'brief.json'), JSON.stringify(brief, null, 2), 'utf8');
console.log(`生成: ${path.relative(process.cwd(), path.join(out, 'index.html'))}（テンプレート: ${template}）`);
if (missing.size) console.warn('未定義の変数（空文字にしました）: ' + [...missing].join(', '));
console.log('次: ブラウザで開いて動作確認 → 業界・会社らしさを仕上げる → node auto-sales-agent/scripts/deploy.js ' + id);
