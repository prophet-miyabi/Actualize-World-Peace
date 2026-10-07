// ブランドの共通定義（ロゴ・アプリアイコン・ファビコンで同じものを使う）。
// 色は「無料ではじめる」ボタンと同じ3色グラデーション。形は黄金比 φ で決める。
export const PHI = (1 + Math.sqrt(5)) / 2;

export const BRAND_GRADIENT = ['#d946ef', '#8b5cf6', '#0ea5e9'] as const;
export const BRAND_GRADIENT_CSS = `linear-gradient(135deg, ${BRAND_GRADIENT[0]} 0%, ${BRAND_GRADIENT[1]} 50%, ${BRAND_GRADIENT[2]} 100%)`;

// ロゴマーク（輪）: 黄金らせん（らせん＋収束点）を6つ、円周上に60°ずつ並べた円環。
// ひとりひとりの「やりたい」（収束点）が輪になってつながる様子を表す。
// 描画側で transform を使わずに済むよう、6つ分の座標をここで計算して返す（アプリアイコンの画像生成でも同じ形になる）
export const ROSETTE_COUNT = 6;

export function goldenRosette(size: number) {
  const c = size / 2;
  const ex = PHI ** 2 / (PHI + 1 / PHI); // 単位らせん（黄金長方形 φ×1 上）の収束点
  const ey = ex / PHI;
  const k = size * 0.15; // らせん1つの大きさ
  const ringR = size * 0.28; // 収束点を並べる円の半径
  const a = 1 / PHI;
  const b = 1 / PHI ** 2;
  const d = 1 / PHI ** 3;
  const pts: [number, number][] = [[0, 1], [1, 0], [1 + a, a], [1 + a - b, 1], [1, 1 - d]];
  const radii = [1, 1 / PHI, 1 / PHI ** 2, 1 / PHI ** 3].map((r) => (r * k).toFixed(2));

  const spirals = Array.from({ length: ROSETTE_COUNT }, (_, i) => {
    const th = (i * 2 * Math.PI) / ROSETTE_COUNT - Math.PI / 2;
    const at = { x: c + ringR * Math.cos(th), y: c + ringR * Math.sin(th) };
    const rot = th + Math.PI / 2;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const tf = ([x, y]: [number, number]) => {
      const dx = (x - ex) * k;
      const dy = (y - ey) * k;
      return `${(at.x + dx * cos - dy * sin).toFixed(2)} ${(at.y + dx * sin + dy * cos).toFixed(2)}`;
    };
    const path = [`M ${tf(pts[0])}`, ...radii.map((r, j) => `A ${r} ${r} 0 0 1 ${tf(pts[j + 1])}`)].join(' ');
    return { path, eye: { cx: Number(at.x.toFixed(2)), cy: Number(at.y.toFixed(2)) } };
  });

  return {
    spirals,
    center: c,
    ringR,
    strokeWidth: size * 0.024,
    eyeR: size * 0.022,
    ringStrokeWidth: size * 0.012
  };
}
