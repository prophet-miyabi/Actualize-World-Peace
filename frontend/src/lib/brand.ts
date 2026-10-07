// ブランドの共通定義（ロゴ・アプリアイコン・ファビコンで同じものを使う）。
// 色は「無料ではじめる」ボタンと同じ3色グラデーション。形は黄金比 φ で決める。
export const PHI = (1 + Math.sqrt(5)) / 2;

export const BRAND_GRADIENT = ['#d946ef', '#8b5cf6', '#0ea5e9'] as const;
export const BRAND_GRADIENT_CSS = `linear-gradient(135deg, ${BRAND_GRADIENT[0]} 0%, ${BRAND_GRADIENT[1]} 50%, ${BRAND_GRADIENT[2]} 100%)`;

// 黄金らせん: 黄金長方形（φ:1）を正方形で割っていき、各正方形に四分円を描いてつなげたもの。
// 半径は 1, 1/φ, 1/φ², 1/φ³ と φ ずつ小さくなる。
// 中心の点は、らせんが収束する点（大小の黄金長方形の対角線の交点）＝「あなたの『やりたい』」。
// size×size の正方形の中央に収める
export function goldenSpiral(size: number) {
  const w = size * 0.7;
  const s = w / PHI; // 長方形の高さ（=最初の正方形の一辺）
  const ox = (size - w) / 2;
  const oy = (size - s) / 2 + s * 0.04;
  const p = (x: number, y: number) => `${(ox + x * s).toFixed(2)} ${(oy + y * s).toFixed(2)}`;
  const r = (k: number) => (s / PHI ** k).toFixed(2);
  const a = 1 / PHI; // 0.618
  const b = 1 / PHI ** 2; // 0.382
  const c = 1 / PHI ** 3; // 0.236
  const path = [
    `M ${p(0, 1)}`,
    `A ${r(0)} ${r(0)} 0 0 1 ${p(1, 0)}`,
    `A ${r(1)} ${r(1)} 0 0 1 ${p(1 + a, a)}`,
    `A ${r(2)} ${r(2)} 0 0 1 ${p(1 + a - b, 1)}`,
    `A ${r(3)} ${r(3)} 0 0 1 ${p(1, 1 - c)}`
  ].join(' ');
  // 収束点: x = φ²/(φ+1/φ), y = x/φ
  const ex = PHI ** 2 / (PHI + 1 / PHI);
  const eye = { cx: ox + ex * s, cy: oy + (ex / PHI) * s, r: size * 0.036 };
  return { path, eye, strokeWidth: size * 0.05 };
}
