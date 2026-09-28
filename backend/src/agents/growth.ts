// 成長分析担当エージェント：AIは使わず、機械的なルールでページの手薄な点を指摘する。
// AIを使わないのは、コストをかけずに常時実行できるようにするため、かつ
// 「事実に基づかない改善提案」を作ってしまうリスクをそもそもなくすため。

export type LpHealthInput = {
  pageViews: number;
  sections: unknown;
  customDomain: string | null;
  designSource: string | null;
  hasImage: boolean;
};

export type LpHealthResult = { pageViews: number; issues: string[] };

export function checkLpHealth(lp: LpHealthInput): LpHealthResult {
  const issues: string[] = [];
  const sectionCount = Array.isArray(lp.sections) ? lp.sections.length : 0;

  if (sectionCount === 0) issues.push('機能（メニュー・よくある質問など）がまだ追加されていません。');
  if (!lp.customDomain) issues.push('独自ドメインが未設定です。');
  if (lp.designSource !== 'ai') issues.push('AIによるデザイン作成がまだ行われていません（業種プリセットのままです）。');
  if (!lp.hasImage) issues.push('メイン画像がまだありません。');

  return { pageViews: lp.pageViews, issues };
}
