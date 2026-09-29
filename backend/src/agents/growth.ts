// 成長分析担当エージェント：AIは使わず、機械的なルールでページの手薄な点を指摘する。
// AIを使わないのは、コストをかけずに常時実行できるようにするため、かつ
// 「事実に基づかない改善提案」を作ってしまうリスクをそもそもなくすため。

export type LpHealthInput = {
  pageViews: number;
  sections: unknown;
  customDomain: string | null;
  designSource: string | null;
  hasImage: boolean;
  // A/Bテスト（backend/src/routes/lp.ts の variants）の集計。未実施ならnull
  variants: { label: string; isControl: boolean; impressions: number; conversions: number }[];
};

export type LpHealthResult = { pageViews: number; issues: string[] };

// 統計的な優劣を判定するのに十分と見なす、バリエーションあたりの最低表示回数
const MIN_IMPRESSIONS_FOR_VERDICT = 30;

export function checkLpHealth(lp: LpHealthInput): LpHealthResult {
  const issues: string[] = [];
  const sectionCount = Array.isArray(lp.sections) ? lp.sections.length : 0;

  if (sectionCount === 0) issues.push('機能（メニュー・よくある質問など）がまだ追加されていません。');
  if (!lp.customDomain) issues.push('独自ドメインが未設定です。');
  if (lp.designSource !== 'ai') issues.push('AIによるデザイン作成がまだ行われていません（業種プリセットのままです）。');
  if (!lp.hasImage) issues.push('メイン画像がまだありません。');

  if (lp.variants.length === 0) {
    if (lp.pageViews >= 50) {
      issues.push('アクセス数が増えてきました。見出しのA/Bテストを始めると、反応の良いコピーを見つけやすくなります。');
    }
  } else {
    const ready = lp.variants.every((v) => v.impressions >= MIN_IMPRESSIONS_FOR_VERDICT);
    if (ready) {
      const withRate = lp.variants.map((v) => ({ ...v, rate: v.impressions ? v.conversions / v.impressions : 0 }));
      const best = withRate.reduce((a, b) => (b.rate > a.rate ? b : a));
      const control = withRate.find((v) => v.isControl);
      if (!best.isControl && control && best.rate > control.rate * 1.2) {
        issues.push(
          `A/Bテストの結果、「${best.label}」が既定の見出しよりCVRが高い傾向です` +
          `（${(best.rate * 100).toFixed(1)}% 対 ${(control.rate * 100).toFixed(1)}%）。採用を検討してください。`
        );
      }
    }
  }

  return { pageViews: lp.pageViews, issues };
}
