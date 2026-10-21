#!/usr/bin/env node
// AWP（個人事業・法人化準備中）の財務諸表を、仕訳帳（journal.csv）と資金計画（plan.json）から作る。
//   使い方: node finance/statements.js            → 今日までの集計
//           node finance/statements.js 2026-10     → 指定月まで
//   出力:   finance/output/財務諸表_YYYY-MM-DD.md / .html
// 単式の仕訳（kind: 売上 / 経費 / 資産 / 負債 / 資本 / 入金 / 出金）から、損益計算書・貸借対照表（簡易）・
// 月次キャッシュフロー・資金計画（300万円の目標との差）を作る。概算・要確認の行は明示する（数字を作らない）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const asOf = process.argv[2] ? new Date(`${process.argv[2]}-01`) : new Date();
if (Number.isNaN(asOf.getTime())) { console.error('日付は YYYY-MM の形式で指定してください'); process.exit(1); }
const cutoff = process.argv[2] ? new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0, 23, 59, 59) : asOf;

// ---------- CSV ----------
function parseCsv(text) {
  const rows = [];
  let cur = [''], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; } else inQ = false; } else cur[cur.length - 1] += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') cur.push('');
    else if (c === '\n') { rows.push(cur); cur = ['']; }
    else if (c !== '\r') cur[cur.length - 1] += c;
  }
  if (cur.length > 1 || cur[0]) rows.push(cur);
  const [head, ...body] = rows;
  return body.filter((r) => r.some((x) => x.trim())).map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const journal = parseCsv(fs.readFileSync(path.join(ROOT, 'journal.csv'), 'utf8'))
  .map((r) => ({ ...r, amount: Number(r.amount_jpy) || 0, d: new Date(r.date) }))
  .filter((r) => !Number.isNaN(r.d.getTime()) && r.d <= cutoff)
  .sort((a, b) => a.d - b.d);
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'plan.json'), 'utf8'));

const yen = (n) => `${Math.round(n).toLocaleString('ja-JP')} 円`;
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const fy = plan.entity.fiscal_year_start ? new Date(plan.entity.fiscal_year_start) : new Date(cutoff.getFullYear(), 0, 1);
const inFy = journal.filter((r) => r.d >= fy);

// ---------- 損益計算書 ----------
const sumBy = (rows, key) => { const m = new Map(); for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + r.amount); return [...m.entries()]; };
const sales = inFy.filter((r) => r.kind === '売上');
const expenses = inFy.filter((r) => r.kind === '経費');
const totalSales = sales.reduce((a, r) => a + r.amount, 0);
const totalExp = expenses.reduce((a, r) => a + r.amount, 0);
const profit = totalSales - totalExp;

// ---------- 貸借対照表（簡易） ----------
// 現金 = 資本 + 入金 + 売上(入金済み扱い) − 経費 − 出金 − 資産購入。売掛・買掛は kind=資産/負債 で登録
const cash = journal.reduce((a, r) => {
  if (r.kind === '資本' || r.kind === '入金' || r.kind === '売上') return a + r.amount;
  if (r.kind === '経費' || r.kind === '出金' || r.kind === '資産') return a - r.amount;
  return a;
}, 0);
const assets = sumBy(journal.filter((r) => r.kind === '資産'), 'account');
const liabilities = sumBy(journal.filter((r) => r.kind === '負債'), 'account');
const capital = journal.filter((r) => r.kind === '資本').reduce((a, r) => a + r.amount, 0);
const totalAssets = cash + assets.reduce((a, [, v]) => a + v, 0);
const totalLiab = liabilities.reduce((a, [, v]) => a + v, 0);
const equity = totalAssets - totalLiab;

// ---------- 月次キャッシュフロー ----------
const months = new Map();
for (const r of journal) {
  const k = ym(r.d);
  const m = months.get(k) ?? { in: 0, out: 0 };
  if (r.kind === '売上' || r.kind === '入金' || r.kind === '資本') m.in += r.amount;
  if (r.kind === '経費' || r.kind === '出金' || r.kind === '資産') m.out += r.amount;
  months.set(k, m);
}

// ---------- 資金計画 ----------
const goal = plan.goal.amount_jpy;
const goalDate = new Date(plan.goal.by);
const monthsLeft = Math.max(0, (goalDate.getFullYear() - cutoff.getFullYear()) * 12 + goalDate.getMonth() - cutoff.getMonth() + 1);
const fixedMonthly = plan.monthly_costs.reduce((a, c) => a + (Number(c.amount_jpy) || 0), 0);
const pipelineExpected = plan.pipeline.reduce((a, p) => a + (Number(p.dev_fee) || 0) * (Number(p.probability) || 0), 0);
const pipelineMax = plan.pipeline.reduce((a, p) => a + (Number(p.dev_fee) || 0), 0);
const need = goal - cash + fixedMonthly * monthsLeft;
const flag = (s) => (s && s !== '確認済' ? `（${s}）` : '');

const md = [];
md.push(`# 財務諸表（${plan.entity.name}）`);
md.push(`作成日: ${cutoff.toISOString().slice(0, 10)}　会計期間: ${fy.toISOString().slice(0, 10)} 〜 ${cutoff.toISOString().slice(0, 10)}　単位: 円（税込・概算を含む）`);
md.push('');
md.push('> 事業用口座の開設前のため、数字は「カード明細・Console の利用額・運営者画面の月次費用」から集めた概算と、未確認（要確認）の項目を含みます。口座開設後に `finance/journal.csv` を実残高・実明細で置き換えると、この書類はそのまま確定版になります。推定の数字を実績として外部に提示しないでください。');
md.push('');
md.push('## 1. 損益計算書（P/L）');
md.push('| 区分 | 科目 | 金額 | 状態 |');
md.push('|---|---|---:|---|');
for (const [acc, v] of sumBy(sales, 'account')) md.push(`| 売上高 | ${acc} | ${yen(v)} | ${sales.filter((r) => r.account === acc).map((r) => r.status).filter(Boolean).join('・')} |`);
md.push(`| **売上高 合計** | | **${yen(totalSales)}** | |`);
for (const [acc, v] of sumBy(expenses, 'account')) md.push(`| 販売費及び一般管理費 | ${acc} | ${yen(v)} | ${[...new Set(expenses.filter((r) => r.account === acc).map((r) => r.status).filter(Boolean))].join('・')} |`);
md.push(`| **費用 合計** | | **${yen(totalExp)}** | |`);
md.push(`| **当期純利益（損失）** | | **${yen(profit)}** | ${profit < 0 ? '損失' : ''} |`);
md.push('');
md.push('## 2. 貸借対照表（B/S・簡易）');
md.push('| 資産の部 | 金額 | 負債・純資産の部 | 金額 |');
md.push('|---|---:|---|---:|');
const left = [['現金・預金（事業用）', cash], ...assets.map(([a, v]) => [a, v])];
const right = [...liabilities.map(([a, v]) => [a, v]), ['元入金・資本', capital], ['当期純利益（損失）', profit], ['純資産 合計', equity]];
for (let i = 0; i < Math.max(left.length, right.length); i++) md.push(`| ${left[i]?.[0] ?? ''} | ${left[i] ? yen(left[i][1]) : ''} | ${right[i]?.[0] ?? ''} | ${right[i] ? yen(right[i][1]) : ''} |`);
md.push(`| **資産 合計** | **${yen(totalAssets)}** | **負債・純資産 合計** | **${yen(totalLiab + equity)}** |`);
md.push('');
md.push('## 3. 月次キャッシュフロー');
md.push('| 月 | 入金 | 出金 | 差引 | 累計残高 |');
md.push('|---|---:|---:|---:|---:|');
let run = 0;
for (const [k, m] of [...months.entries()].sort()) { run += m.in - m.out; md.push(`| ${k} | ${yen(m.in)} | ${yen(m.out)} | ${yen(m.in - m.out)} | ${yen(run)} |`); }
md.push('');
md.push('## 4. 資金計画（法人設立の原資 300 万円）');
md.push('| 項目 | 金額・内容 |');
md.push('|---|---|');
md.push(`| 目標 | ${yen(goal)} を ${plan.goal.by} までに確保（${plan.goal.purpose}） |`);
md.push(`| 現在の事業用現金 | ${yen(cash)} |`);
md.push(`| 残り月数 | ${monthsLeft} ヶ月 |`);
md.push(`| 固定費の見込み（月） | ${yen(fixedMonthly)}（${plan.monthly_costs.map((c) => `${c.name} ${yen(c.amount_jpy)} ${flag(c.status)}`).join(' / ')}） |`);
md.push(`| 目標までに必要な入金 | ${yen(need)}（目標 − 現金 ＋ 固定費 × 残り月数） |`);
md.push(`| 見込み案件の期待値 | ${yen(pipelineExpected)}（受注確度を掛けた値。全件受注なら ${yen(pipelineMax)}） |`);
md.push(`| 差（追加で必要な受注額） | **${yen(Math.max(0, need - pipelineExpected))}** |`);
md.push('');
md.push('### 必要受注の目安（開発費のみ・税別）');
md.push('| 種別 | 標準価格 | 300万円に必要な件数 | 保守（月額） |');
md.push('|---|---:|---:|---:|');
for (const [t, p] of Object.entries(plan.prices)) md.push(`| ${t} | ${yen(p.typical)} | 約 ${Math.ceil(goal / p.typical)} 件 | ${yen(p.maintenance)} |`);
md.push('');
md.push('### 見込み案件（pipeline）');
md.push('| 案件 | 種別 | 開発費 | 保守/月 | 確度 | 受注予定 | メモ |');
md.push('|---|---|---:|---:|---:|---|---|');
for (const p of plan.pipeline) md.push(`| ${p.name} | ${p.type} | ${yen(p.dev_fee)} | ${yen(p.maintenance || 0)} | ${Math.round((p.probability || 0) * 100)}% | ${p.expected_close || ''} | ${p.note || ''} |`);
md.push('');
md.push('### 月別の受注目標');
md.push('| 月 | 受注件数の目標 |');
md.push('|---|---:|');
for (const [k, v] of Object.entries(plan.scenarios)) if (typeof v === 'object' && v.target_deals != null) md.push(`| ${k} | ${v.target_deals} 件 |`);
md.push('');
md.push(`> ${plan.scenarios['必要受注の目安'] ?? ''}`);
md.push('');
md.push('## 5. 仕訳帳（根拠）');
md.push('| 日付 | 区分 | 科目 | 金額 | 相手先 | 状態 | 根拠 | メモ |');
md.push('|---|---|---|---:|---|---|---|---|');
for (const r of journal) md.push(`| ${r.date} | ${r.kind} | ${r.account} | ${yen(r.amount)} | ${r.counterparty} | ${r.status} | ${r.evidence} | ${r.memo} |`);
md.push('');
md.push('## 6. 口座開設後にやること');
md.push('1. 事業用口座の開設日の残高を `資本` 行に入れる（元入金）。');
md.push('2. カード明細・Console・Render の請求額で「概算」「要確認」の行を実額に置き換え、`status` を `確認済` にする。');
md.push('3. 受注したら `売上`（請求日）と `入金`（入金日）を分けて記録する。未入金は `資産`（売掛金）として残す。');
md.push('4. 月初に `node finance/statements.js` を実行し、`finance/output/` の最新版を保管する（確定申告・法人設立の資料になる）。');
md.push('5. 法人設立時は、この個人事業の資産・負債を引き継ぐか（事業譲渡）を税理士に相談する。');

const outDir = path.join(ROOT, 'output');
fs.mkdirSync(outDir, { recursive: true });
const stamp = cutoff.toISOString().slice(0, 10);
const body = md.join('\n');
fs.writeFileSync(path.join(outDir, `財務諸表_${stamp}.md`), body, 'utf8');

// ---------- HTML ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
function mdToHtml(src) {
  const lines = src.split('\n'); const out = []; let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,3})\s+(.*)/.exec(l); if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (l.startsWith('|')) { const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]); const cells = (r) => r.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim()); const head = cells(rows[0]); const body2 = rows.slice(1).filter((r) => !/^\|\s*:?-+/.test(r)); out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' + body2.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>'); continue; }
    if (/^\d+\.\s/.test(l)) { const items = []; while (i < lines.length && /^\d+\.\s/.test(lines[i])) items.push(lines[i++].replace(/^\d+\.\s/, '')); out.push('<ol>' + items.map((x) => `<li>${inline(x)}</li>`).join('') + '</ol>'); continue; }
    if (l.startsWith('>')) { out.push(`<blockquote>${inline(l.replace(/^>\s?/, ''))}</blockquote>`); i++; continue; }
    out.push(`<p>${inline(l)}</p>`); i++;
  }
  return out.join('\n');
}
const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>財務諸表 ${stamp}</title>
<style>@page{size:A4;margin:16mm}body{font-family:"Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP",sans-serif;color:#111;line-height:1.7;font-size:10.5pt;margin:0;background:#fff}.sheet{max-width:190mm;margin:0 auto;padding:24px 16px}h1{font-size:17pt;margin:0 0 6px}h2{font-size:12.5pt;margin:22px 0 8px;border-left:4px solid #333;padding-left:8px}h3{font-size:11pt;margin:14px 0 6px}table{border-collapse:collapse;width:100%;margin:8px 0;font-size:9.5pt}th,td{border:1px solid #555;padding:4px 6px;vertical-align:top}th{background:#f0f0f0}td:nth-child(n){white-space:normal}blockquote{background:#fff8e1;border-left:3px solid #e0b000;padding:8px 12px;margin:8px 0;font-size:9.5pt}code{background:#f3f3f3;padding:0 3px}.noprint{position:sticky;top:0;background:#fffbe6;border-bottom:1px solid #e6d98a;padding:8px 16px;font-size:12px}@media print{.noprint{display:none}.sheet{padding:0;max-width:none}}</style></head>
<body><div class="noprint">印刷（Ctrl+P）→「PDFに保存」 <button onclick="window.print()">印刷 / PDF保存</button></div><div class="sheet">${mdToHtml(body)}</div></body></html>`;
fs.writeFileSync(path.join(outDir, `財務諸表_${stamp}.html`), html, 'utf8');

console.log(`売上 ${yen(totalSales)} / 費用 ${yen(totalExp)} / 損益 ${yen(profit)} / 事業用現金 ${yen(cash)}`);
console.log(`目標 ${yen(goal)} まで: 必要入金 ${yen(need)}、見込み期待値 ${yen(pipelineExpected)}、不足 ${yen(Math.max(0, need - pipelineExpected))}（残り ${monthsLeft} ヶ月）`);
console.log(`出力: ${path.join(outDir, `財務諸表_${stamp}.md`)} / .html`);
