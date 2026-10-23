#!/usr/bin/env node
// 提案文の生成: brief.json + deploy.json + templates/proposal.md → output/<案件ID>_proposal.md
//   node auto-sales-agent/scripts/propose.js <案件ID>
// 骨組みを機械的に作る。最終的な言い回しは Claude Code が案件文に合わせて整える（CLAUDE.md のルール）。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const id = process.argv[2];
if (!id) { console.error('案件IDを指定してください'); process.exit(1); }
const dir = path.join(ROOT, 'input', id);
const brief = JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8'));
const deploy = fs.existsSync(path.join(dir, 'deploy.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'deploy.json'), 'utf8')) : { url: '（デプロイ後にURLが入ります）' };
let prices = {};
let packages = null;
try { const plan = JSON.parse(fs.readFileSync(path.join(REPO, 'finance', 'plan.json'), 'utf8')); prices = plan.prices; packages = plan.packages; } catch { /* 無ければ既定 */ }
// 雅テックの松竹梅（finance/plan.json の packages が正本）。LP 案件は梅、LINE 付きは竹、HP＋動画＋SNS は松を軸に提案する
const pkgLines = packages ? ['ume', 'take', 'matsu'].filter((k) => packages[k]).map((k) => {
  const pk = packages[k];
  return `- ${pk.label} ${Math.round(pk.price / 10000)}万円〜: ${(pk.includes || []).join(' / ')}`;
}).concat(packages.maintenance ? [`- 公開後の保守: 月額 ${Math.round(packages.maintenance.light / 1000).toLocaleString('ja-JP')},000円〜（監視・バックアップ・更新・障害時の一次対応）`] : []) : [];

const typeOf = { lp: 'LP', lp_drm: 'LP', crm: 'System', booking: 'WebApp' }[brief.screen?.template] || 'HP';
// 価格帯: 松竹梅があれば LP=梅〜竹、HP=竹〜松、システム系は従来の prices
const price = packages && (typeOf === 'LP' || typeOf === 'HP')
  ? (typeOf === 'LP' ? { min: packages.ume.price, max: packages.take.price, maintenance: packages.maintenance.standard } : { min: packages.take.price, max: packages.matsu.price, maintenance: packages.maintenance.standard })
  : (prices[typeOf] || { min: 300000, max: 800000, maintenance: 33000 });
const yen = (n) => `${Math.round(n / 10000)}万円`;
const c = brief.client || {};
const t = brief.screen?.template;

const tryList = {
  lp: ['スマホで開き、画面下の「LINEで相談」→ 友だち追加の導線をご確認ください', '「無料見積もり」フォームで、3ステップの入力が進むことをお試しください', 'メニューの料金タブを切り替えてみてください'],
  crm: ['一覧の「ステータス」を変えると、ダッシュボードの件数が即座に変わります', '検索欄に担当者名や顧客名を入れると絞り込まれます', '行をクリックすると詳細が開き、「架電履歴を追加」で記録が増えます'],
  booking: ['カレンダーの空き枠を押すと、予約モーダルが開きます', '「顧客管理」タブで、要注意（ブラックリスト）の切り替えをお試しください', 'スタッフ（キャスト）の絞り込みで、空き状況が変わります']
}[t] || [];

const painLines = (brief.pain || []).slice(0, 5).map((p) => `- 「${p}」 → プロトタイプの ${{ lp: '該当セクション', crm: '一覧・ダッシュボード', booking: '予約カレンダー・顧客管理' }[t] || '画面'} で、◯◯のように解決します（※ここを案件文に合わせて具体化）`);
const prodLines = {
  lp: ['お問い合わせ・予約フォームの送信先（メール／LINE通知／スプレッドシート）', '公式LINEの友だち追加と自動応答の設定', 'ドメイン・サーバー（御社名義）での公開と、検索エンジン向けの設定'],
  crm: ['ログイン・権限（管理者／スタッフ）', 'データベース（顧客・案件・架電履歴）と、スプレッドシートからの移行', 'CSV書き出し、通知（メール／LINE）、スマホからの入力'],
  booking: ['ログイン・権限、顧客・スタッフの本登録', '予約の重複防止・リマインド通知（LINE／メール）', 'キャンセル規定・事前決済（必要な場合）・売上集計']
}[t] || [];

const template = fs.readFileSync(path.join(ROOT, 'templates', 'proposal.md'), 'utf8');
const vars = {
  brand: c.brand || '（御社名）', industry: c.industry || '', url: deploy.url,
  pain_lines: painLines.join('\n') || '- （案件文の課題を引用して、対応を書く）',
  try_lines: tryList.map((x) => `- ${x}`).join('\n'),
  prod_lines: prodLines.map((x) => `- ${x}`).join('\n'),
  assumptions: (brief.assumptions || []).slice(0, 3).map((x) => `- ${x}（と想定しています。違っていればお知らせください）`).join('\n') || '- （特になし）',
  deadline: brief.deadline || 'ご希望に合わせて調整',
  price_range: `${yen(price.min)}〜${yen(price.max)}（税別）`, maintenance: `月額 ${Math.round(price.maintenance / 1000) * 1000 >= 10000 ? yen(price.maintenance) : `${price.maintenance.toLocaleString('ja-JP')}円`}〜（税別）`,
  packages: pkgLines.join('\n') || '- （finance/plan.json の packages が未設定）',
  type_label: { lp: 'ランディングページ', lp_drm: 'ランディングページ', crm: '業務管理システム', booking: '予約・顧客管理システム' }[t] || 'ホームページ',
  today: new Date().toLocaleDateString('ja-JP')
};
const out = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => vars[k] ?? '');
fs.mkdirSync(path.join(ROOT, 'output'), { recursive: true });
const file = path.join(ROOT, 'output', `${id}_proposal.md`);
fs.writeFileSync(file, out, 'utf8');
console.log(`提案文の骨組み: ${path.relative(process.cwd(), file)}`);
console.log('次: 案件文の言葉に合わせて「→ ◯◯のように解決します」を具体化し、媒体の提案欄に貼る');
