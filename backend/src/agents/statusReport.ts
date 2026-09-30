import fs from 'fs';
import path from 'path';
import prisma from '../prisma';
import { FEATURE_CHECKLIST, STATUS_LABEL, type FeatureItem, type FeatureStatus } from './statusData';

// 進捗報告担当エージェント：システムの実装状況を文章とグラフにまとめてファイル化する。
// 「進捗の判定」はAIに推測させず、backend/src/agents/statusData.ts で手動管理する
// チェックリスト（開発者が実際のコードを把握した上で記録）を正とする。エージェントの役割は
// それを集計・可視化することと、DBから取得できる実際の稼働状況を添えることに限定する
// （事実に基づかない「進捗の誇張」を防ぐため。marketing.ts/growth.tsと同じ設計方針）。
// ループへの定期組み込みは別対応（現時点では手動実行のみ）。

const STATUS_COLOR: Record<FeatureStatus, string> = {
  done: '#16a34a',
  partial: '#d97706',
  blocked: '#dc2626',
  not_started: '#9ca3af'
};
const STATUS_ORDER: FeatureStatus[] = ['done', 'partial', 'blocked', 'not_started'];

function buildChartSvg(counts: Record<FeatureStatus, number>, total: number): string {
  const width = 640;
  const barHeight = 36;
  const gap = 14;
  const labelWidth = 160;
  const maxBarWidth = width - labelWidth - 80;
  const height = STATUS_ORDER.length * (barHeight + gap) + gap;

  const bars = STATUS_ORDER.map((status, i) => {
    const count = counts[status] || 0;
    const barWidth = total > 0 ? Math.max((count / total) * maxBarWidth, count > 0 ? 4 : 0) : 0;
    const y = gap + i * (barHeight + gap);
    return `
      <text x="0" y="${y + barHeight / 2 + 5}" font-size="15" fill="#374151">${STATUS_LABEL[status]}</text>
      <rect x="${labelWidth}" y="${y}" width="${barWidth}" height="${barHeight}" rx="6" fill="${STATUS_COLOR[status]}" />
      <text x="${labelWidth + barWidth + 10}" y="${y + barHeight / 2 + 5}" font-size="15" fill="#111827">${count}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif">${bars}</svg>`;
}

function migrationCount(): number {
  const dir = path.join(__dirname, '../../prisma/migrations');
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((d) => d !== 'migration_lock.toml').length;
}

export async function generateStatusReport(): Promise<{ filePath: string; html: string }> {
  const counts: Record<FeatureStatus, number> = { done: 0, partial: 0, blocked: 0, not_started: 0 };
  for (const item of FEATURE_CHECKLIST) counts[item.status]++;
  const total = FEATURE_CHECKLIST.length;

  const [userCount, lpCount, socialAccountCount] = await Promise.all([
    prisma.user.count(),
    prisma.landingPage.count(),
    prisma.socialAccount.count()
  ]);

  const byCategory = new Map<string, FeatureItem[]>();
  for (const item of FEATURE_CHECKLIST) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  const categorySections = Array.from(byCategory.entries()).map(([category, items]) => `
    <h3>${category}</h3>
    <ul>
      ${items.map((item) => `
        <li>
          <span class="badge" style="background:${STATUS_COLOR[item.status]}22;color:${STATUS_COLOR[item.status]}">${STATUS_LABEL[item.status]}</span>
          ${item.name}
          ${item.note ? `<div class="note">${item.note}</div>` : ''}
        </li>`).join('')}
    </ul>`).join('');

  const generatedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>AWP 実装進捗レポート</title>
<style>
  body { font-family: -apple-system, "Hiragino Sans", sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #111827; }
  h1 { font-size: 24px; }
  h3 { margin-top: 28px; border-bottom: 2px solid #e5e7eb; padding-bottom: 6px; }
  ul { list-style: none; padding: 0; }
  li { padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
  .badge { display: inline-block; font-size: 12px; font-weight: bold; padding: 2px 10px; border-radius: 9999px; margin-right: 8px; }
  .note { font-size: 13px; color: #6b7280; margin-top: 4px; margin-left: 4px; }
  .stats { display: flex; gap: 24px; margin: 20px 0; flex-wrap: wrap; }
  .stat { background: #f9fafb; border-radius: 12px; padding: 12px 20px; }
  .stat b { display: block; font-size: 22px; }
  .meta { color: #6b7280; font-size: 13px; }
</style>
</head>
<body>
  <h1>AWP 実装進捗レポート</h1>
  <p class="meta">作成日時: ${generatedAt}（進捗報告担当エージェント・自動生成）</p>

  <div class="stats">
    <div class="stat"><b>${total}</b>登録済み機能項目</div>
    <div class="stat"><b>${counts.done}</b>完了</div>
    <div class="stat"><b>${migrationCount()}</b>DBマイグレーション適用数</div>
    <div class="stat"><b>${userCount}</b>登録ユーザー数</div>
    <div class="stat"><b>${lpCount}</b>作成済みLP/HP数</div>
    <div class="stat"><b>${socialAccountCount}</b>SNS連携済みアカウント数</div>
  </div>

  ${buildChartSvg(counts, total)}

  ${categorySections}
</body>
</html>`;

  const outDir = path.join(__dirname, '../../reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, 'status-report.html');
  fs.writeFileSync(filePath, html, 'utf-8');

  return { filePath, html };
}
