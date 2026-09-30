import 'dotenv/config';
import { generateStatusReport } from '../src/agents/statusReport';

// 使い方: npm run report:generate
// backend/reports/status-report.html を生成する。
// エージェントループへの定期組み込みはまだ行っていない（手動実行のみ。次のステップ）。
generateStatusReport()
  .then(({ filePath }) => { console.log('レポートを生成しました:', filePath); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
