#!/usr/bin/env node
// 受託開発（LP・HP・Webアプリ・業務システム）の契約・提案ドキュメント一式を、案件JSONから生成する。
//   使い方: node contracts/generate.js contracts/projects/sample_client.json
//   出力:   contracts/output/{顧客名}_{YYYYMMDD}/ に Markdown と印刷用HTML（CSS埋め込み・改ページ対応）
// 依存パッケージなし（Node 18 以上）。テンプレートは contracts/templates/*.md、変数は {{name}} の形。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const TEMPLATE_DIR = path.join(ROOT, 'templates');

function die(msg) { console.error(`エラー: ${msg}`); process.exit(1); }

const file = process.argv[2];
if (!file) die('案件のJSONファイルを指定してください。例: node contracts/generate.js contracts/projects/sample_client.json');
const raw = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));

// ---------- 既定値と派生値 ----------
const TYPE_LABEL = { LP: 'ランディングページ（LP）制作', HP: 'ホームページ（HP）制作', WebApp: 'Webアプリケーション開発', System: '業務システム開発' };
const DEFAULT_WARRANTY = { LP: 1, HP: 2, WebApp: 3, System: 3 };
const PLAN_LABEL = { light: 'ライト', standard: 'スタンダード', premium: 'プレミアム' };

const yen = (n) => `${Math.round(Number(n) || 0).toLocaleString('ja-JP')}円`;
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
const parseDate = (s) => { const d = s ? new Date(s) : new Date(); if (Number.isNaN(d.getTime())) die(`日付の形式が正しくありません: ${s}`); return d; };
const addMonths = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const firstOfNextMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 1);
const list = (arr, prefix = '- ') => (Array.isArray(arr) && arr.length ? arr.map((x) => `${prefix}${x}`).join('\n') : `${prefix}（別紙のとおり）`);
const numbered = (arr) => (Array.isArray(arr) && arr.length ? arr.map((x, i) => `${i + 1}. ${x}`).join('\n') : '1. （別紙のとおり）');

const type = TYPE_LABEL[raw.project_type] ? raw.project_type : die(`project_type は LP / HP / WebApp / System のいずれかにしてください（現在: ${raw.project_type}）`);
const taxRate = raw.tax_rate ?? 0.1;
const contractDate = parseDate(raw.contract_date);
const deliveryDate = parseDate(raw.delivery_date);
const maintenanceStart = raw.maintenance_start ? parseDate(raw.maintenance_start) : firstOfNextMonth(deliveryDate);
const devFee = Number(raw.dev_fee) || 0;
const maintenancePlan = PLAN_LABEL[raw.maintenance_plan] ? raw.maintenance_plan : 'standard';
const plans = Object.assign({
  light: { fee: 11000, response: '翌営業日中', hours: '平日 10:00〜18:00', included: '死活監視・月次バックアップ・SSL更新管理・セキュリティパッチ（四半期）・軽微な文言修正（月1回まで）' },
  standard: { fee: 33000, response: '4営業時間以内（緊急）／翌営業日（通常）', hours: '平日 10:00〜18:00', included: 'ライトの全項目・週次バックアップ・セキュリティパッチ（月次）・軽微な修正（月3時間まで）・月次レポート' },
  premium: { fee: 77000, response: '2営業時間以内（緊急）／当日中（通常）', hours: '平日 9:00〜20:00（緊急連絡は休日も受付）', included: 'スタンダードの全項目・日次バックアップ・改善相談（月1回の定例）・修正作業（月8時間まで）・障害時の優先対応' }
}, raw.plans || {});
const maintenanceFee = Number(raw.maintenance_fee ?? plans[maintenancePlan].fee) || 0;
const warrantyMonths = Number(raw.warranty_months ?? DEFAULT_WARRANTY[type]);
const inspectionDays = Number(raw.inspection_days ?? 10);
const liabilityCapMonths = Number(raw.liability_cap_months ?? 6);

const payment = Array.isArray(raw.payment_terms) && raw.payment_terms.length
  ? raw.payment_terms
  : [`契約締結時に委託料の50%（${yen(devFee * 0.5)}（税別））を着手金として、乙の請求書受領後7日以内に支払う。`, `検収完了後、残額（${yen(devFee * 0.5)}（税別））を乙の請求書受領月の翌月末日までに支払う。`];

const vars = {
  // 当事者
  client_name: raw.client_name, client_representative: raw.client_representative || '', client_address: raw.client_address || '',
  contractor_name: raw.contractor_name, contractor_person: raw.contractor_person || '', contractor_address: raw.contractor_address || '', contractor_email: raw.contractor_email || '', contractor_phone: raw.contractor_phone || '',
  contractor_invoice_number: raw.contractor_invoice_number || '（登録番号は請求書に記載）',
  jurisdiction_court: raw.jurisdiction_court || '乙の所在地を管轄する地方裁判所（又は簡易裁判所）',
  // 案件
  project_name: raw.project_name, project_type: type, project_type_label: TYPE_LABEL[type],
  scope_list: list(raw.scope), deliverables_list: numbered(raw.deliverables), exclusions_list: list(raw.exclusions || ['上記に明記のない機能・ページ・デザイン案の追加', '写真撮影・原稿執筆・翻訳（甲が素材を支給する）', '第三者サービスの利用料（ドメイン・サーバー・決済・外部API等）']),
  client_provides_list: list(raw.client_provides || ['会社・サービスの基本情報、ロゴ、写真、掲載する文章（原稿）', 'サーバー・ドメイン・外部サービスのアカウント（甲名義）と作業権限', '確認・承認の担当者と、質問への回答（原則3営業日以内）']),
  environment: raw.environment || '甲名義で契約するクラウド基盤（例: Render / Vercel / AWS 等）およびドメイン',
  // 金額・期日
  dev_fee: yen(devFee), dev_fee_tax: yen(devFee * taxRate), dev_fee_total: yen(devFee * (1 + taxRate)), tax_rate_percent: String(Math.round(taxRate * 100)),
  maintenance_plan: maintenancePlan, maintenance_plan_label: PLAN_LABEL[maintenancePlan],
  maintenance_fee: yen(maintenanceFee), maintenance_fee_total: yen(maintenanceFee * (1 + taxRate)),
  liability_cap_maintenance: yen(maintenanceFee * liabilityCapMonths),
  payment_terms_list: numbered(payment),
  contract_date: fmtDate(contractDate), delivery_date: fmtDate(deliveryDate), maintenance_start: fmtDate(maintenanceStart),
  warranty_end: fmtDate(addMonths(deliveryDate, warrantyMonths)),
  inspection_days: String(inspectionDays), warranty_months: String(warrantyMonths), liability_cap_months: String(liabilityCapMonths),
  minimum_term_months: String(raw.minimum_term_months ?? 6), notice_months: String(raw.notice_months ?? 1),
  // プラン表
  plan_light_fee: yen(plans.light.fee), plan_standard_fee: yen(plans.standard.fee), plan_premium_fee: yen(plans.premium.fee),
  plan_light_response: plans.light.response, plan_standard_response: plans.standard.response, plan_premium_response: plans.premium.response,
  plan_light_hours: plans.light.hours, plan_standard_hours: plans.standard.hours, plan_premium_hours: plans.premium.hours,
  plan_light_included: plans.light.included, plan_standard_included: plans.standard.included, plan_premium_included: plans.premium.included,
  uptime_target: raw.uptime_target || '99.9%（利用するクラウド基盤の公表するSLAに準拠。乙が独自に保証する稼働率ではない）',
  generated_on: fmtDate(new Date()),
  today: fmtDate(new Date())
};
for (const k of ['client_name', 'contractor_name', 'project_name']) if (!vars[k]) die(`${k} が未設定です`);

// ---------- 置換 ----------
function render(template) {
  const missing = new Set();
  const out = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (vars[key] === undefined) { missing.add(key); return `{{${key}}}`; }
    return String(vars[key]);
  });
  return { out, missing: [...missing] };
}

// ---------- Markdown → HTML（依存なしの最小実装: 見出し・段落・箇条書き・番号・表・強調・区切り・引用） ----------
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
}
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  const flushPara = (buf) => { if (buf.length) { html.push(`<p>${buf.map(inline).join('<br>')}</p>`); buf.length = 0; } };
  const para = [];
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { flushPara(para); i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flushPara(para); html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^---+\s*$/.test(line)) { flushPara(para); html.push('<hr>'); i++; continue; }
    if (/^<!--\s*pagebreak\s*-->/.test(line)) { flushPara(para); html.push('<div class="pagebreak"></div>'); i++; continue; }
    if (/^\|/.test(line)) {
      flushPara(para);
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = (r) => r.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
      const header = cells(rows[0]);
      const body = rows.slice(1).filter((r) => !/^\|\s*:?-+/.test(r));
      html.push('<table><thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara(para);
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      html.push('<ul>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ul>');
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara(para);
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      html.push('<ol>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ol>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushPara(para);
      const items = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { items.push(lines[i].replace(/^>\s?/, '')); i++; }
      html.push(`<blockquote>${items.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    para.push(line);
    i++;
  }
  flushPara(para);
  return html.join('\n');
}

const CSS = `
@page { size: A4; margin: 18mm 16mm; }
:root { color-scheme: light; }
body { font-family: "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif; color: #111; line-height: 1.8; font-size: 10.5pt; margin: 0; background: #fff; }
.sheet { max-width: 180mm; margin: 0 auto; padding: 24px 16px; }
h1 { font-size: 17pt; text-align: center; letter-spacing: .12em; margin: 0 0 18px; font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif; }
h2 { font-size: 12pt; margin: 22px 0 8px; padding-left: 8px; border-left: 4px solid #333; font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif; break-after: avoid; }
h3 { font-size: 11pt; margin: 14px 0 6px; font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif; break-after: avoid; }
h4 { font-size: 10.5pt; margin: 10px 0 4px; }
p { margin: 6px 0; text-align: justify; }
ul, ol { margin: 6px 0 6px 1.4em; padding: 0; }
li { margin: 3px 0; }
table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 1px solid #555; padding: 5px 7px; vertical-align: top; text-align: left; }
th { background: #f0f0f0; font-weight: 700; }
hr { border: 0; border-top: 1px solid #999; margin: 18px 0; }
blockquote { margin: 8px 0; padding: 8px 12px; background: #f7f7f7; border-left: 3px solid #bbb; font-size: 9.5pt; }
code { font-family: Consolas, "Courier New", monospace; font-size: 9.5pt; background: #f3f3f3; padding: 0 3px; }
.pagebreak { break-before: page; page-break-before: always; height: 0; }
.doc { break-before: page; page-break-before: always; }
.doc:first-child { break-before: auto; page-break-before: auto; }
.meta { color: #666; font-size: 8.5pt; text-align: right; margin-bottom: 10px; }
@media print { .sheet { max-width: none; padding: 0; } .noprint { display: none; } }
.toolbar { position: sticky; top: 0; background: #fffbe6; border-bottom: 1px solid #e6d98a; padding: 8px 16px; font-family: sans-serif; font-size: 12px; }
.toolbar button { font-size: 12px; padding: 4px 10px; }
`;

function htmlDoc(title, bodies) {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="toolbar noprint">印刷（Ctrl+P / ⌘P）→「PDFに保存」で顧客送付用のPDFになります。 <button onclick="window.print()">印刷 / PDF保存</button></div>
<div class="sheet">${bodies.map((b) => `<article class="doc">${b}</article>`).join('\n')}</div></body></html>`;
}

// ---------- 実行 ----------
const templates = fs.readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith('.md')).sort();
if (templates.length === 0) die('templates/ に Markdown テンプレートがありません');
const today = new Date();
const stamp = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
const safeClient = String(raw.client_name).replace(/[\\/:*?"<>|\s]+/g, '_');
const outDir = path.join(ROOT, 'output', `${safeClient}_${stamp}`);
fs.mkdirSync(outDir, { recursive: true });

const combined = [];
const allMissing = new Set();
for (const t of templates) {
  const { out, missing } = render(fs.readFileSync(path.join(TEMPLATE_DIR, t), 'utf8'));
  missing.forEach((m) => allMissing.add(`${t}: {{${m}}}`));
  const base = t.replace(/\.md$/, '');
  fs.writeFileSync(path.join(outDir, `${base}.md`), out, 'utf8');
  const body = `<p class="meta">${esc(vars.client_name)} 様 / ${esc(vars.contractor_name)} / 作成日 ${esc(vars.generated_on)}</p>` + mdToHtml(out);
  fs.writeFileSync(path.join(outDir, `${base}.html`), htmlDoc(`${base}（${vars.client_name} 様）`, [body]), 'utf8');
  combined.push(body);
  console.log(`  ✓ ${base}.md / .html`);
}
fs.writeFileSync(path.join(outDir, '00_全書類まとめ.html'), htmlDoc(`契約・提案書類一式（${vars.client_name} 様）`, combined), 'utf8');
fs.writeFileSync(path.join(outDir, '_variables.json'), JSON.stringify(vars, null, 2), 'utf8');
console.log(`\n出力先: ${outDir}`);
console.log('まとめて印刷: 00_全書類まとめ.html をブラウザで開いて「PDFに保存」');
if (allMissing.size) { console.warn('\n未置換の変数があります（JSONに追加してください）:'); allMissing.forEach((m) => console.warn('  - ' + m)); process.exitCode = 2; }
