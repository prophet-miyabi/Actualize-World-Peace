import { BRAND_GRADIENT_CSS, goldenSpiral } from '@/lib/brand';

// アプリアイコン・ファビコンの絵柄（ImageResponse用。Tailwindは使えないためインラインスタイルのみ）。
// ロゴマークと同じ、ブランドのグラデーション＋黄金らせん。角丸はホーム画面側で付くため全面を塗る
export function AppIconArt({ size }: { size: number }) {
  const spiral = goldenSpiral(size);
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: BRAND_GRADIENT_CSS }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
        <path d={spiral.path} stroke="#ffffff" strokeWidth={spiral.strokeWidth} strokeLinecap="round" fill="none" />
        <circle cx={spiral.eye.cx} cy={spiral.eye.cy} r={spiral.eye.r} fill="#ffffff" />
      </svg>
    </div>
  );
}
