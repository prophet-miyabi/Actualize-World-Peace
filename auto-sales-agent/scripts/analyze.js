#!/usr/bin/env node
// 要件の分析: input/<案件ID>/job_post.txt → input/<案件ID>/brief.json（schema/brief.schema.json の形）。
// Claude API（backend の SDK とキーを流用）で抽出する。キーが無い・無効なときは、Claude Code の /pitch で
// 直接 brief.json を書く手順を案内して終了する（結果は同じ形）。
//   node auto-sales-agent/scripts/analyze.js <案件ID>
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const id = process.argv[2];
if (!id) { console.error('案件IDを指定してください'); process.exit(1); }
const dir = path.join(ROOT, 'input', id);
const post = fs.readFileSync(path.join(dir, 'job_post.txt'), 'utf8');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'brief.schema.json'), 'utf8'));

// backend/.env から ANTHROPIC_API_KEY を読む（環境変数が優先）
function loadKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const env = fs.readFileSync(path.join(REPO, 'backend', '.env'), 'utf8');
    const m = /^ANTHROPIC_API_KEY=(.+)$/m.exec(env);
    return m ? m[1].trim().replace(/^"|"$/g, '') : '';
  } catch { return ''; }
}

const SYSTEM = `あなたは受託開発の営業アシスタントです。クラウドソーシングの案件文から、見込み客専用の動くプロトタイプと提案文を作るための「案件ブリーフ」を JSON で抽出します。
守ること:
- 案件文に書かれていることだけを facts に、推測は assumptions に分ける。数字・実績を作らない。
- client.brand が不明なら「（御社名）」。業種・サービス・業界用語は、その業界で実際に使う言葉で。
- screen.template は lp（集客ページ） / crm（案件・顧客・架電・スタッフの業務管理） / booking（予約・マッチング・顧客管理）から1つ。
- demo_data は画面に流し込むダミーデータ。業界用語で 8〜15 件。実在の人名・電話番号は使わない（氏名は「田中 様」「佐藤 様」程度、電話は 090-****-1234 のように伏せる）。
- palette は業種の信頼感に合う落ち着いた2色（#RRGGBB）。
- 個人情報（案件文中の連絡先など）は出力に含めない。`;

async function main() {
  const key = loadKey();
  if (!key) return fallback('ANTHROPIC_API_KEY が見つかりません');
  let Anthropic;
  try { Anthropic = require(path.join(REPO, 'backend', 'node_modules', '@anthropic-ai', 'sdk')); } catch { return fallback('backend/node_modules に @anthropic-ai/sdk がありません（cd backend && npm install）'); }
  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model: process.env.CLAUDE_MODEL || 'claude-opus-5',
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: `案件ID: ${id}\n\n＜案件文＞\n${post.slice(0, 12000)}\n＜/案件文＞\n\n次の JSON Schema に従う JSON だけを出力してください（前置き・コードブロック不要）。\n${JSON.stringify(schema)}` }]
  }).catch((e) => ({ error: e }));
  if (res.error) return fallback(`API 呼び出しに失敗: ${res.error?.status ?? ''} ${res.error?.message ?? res.error}`);
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let brief;
  try { brief = JSON.parse(json); } catch { return fallback('JSON として読めない出力でした。出力を input/<id>/analyze_raw.txt に保存しました', text); }
  brief.id = id;
  fs.writeFileSync(path.join(dir, 'brief.json'), JSON.stringify(brief, null, 2), 'utf8');
  console.log(`brief.json を書きました: ${path.relative(process.cwd(), path.join(dir, 'brief.json'))}`);
  console.log(`業種: ${brief.client?.industry} / 画面: ${brief.screen?.template} / 課題: ${(brief.pain || []).length}件 / 推測: ${(brief.assumptions || []).length}件`);
  console.log(`次: node auto-sales-agent/scripts/generate.js ${id}`);
}

function fallback(reason, raw) {
  if (raw) fs.writeFileSync(path.join(dir, 'analyze_raw.txt'), raw, 'utf8');
  console.error(`API での分析は行いません（${reason}）。`);
  console.error(`代わりに Claude Code で: /pitch ${id} を実行するか、次の形で input/${id}/brief.json を書いてください。`);
  console.error(`スキーマ: auto-sales-agent/schema/brief.schema.json`);
  process.exitCode = 3;
}

main();
