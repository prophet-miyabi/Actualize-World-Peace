import { BRAND_GRADIENT_CSS, goldenRosette } from '@/lib/brand';

// アプリアイコン・ファビコンの絵柄（ImageResponse用。Tailwindは使えないためインラインスタイルのみ）。
// ロゴマークと同じ、ブランドのグラデーション＋黄金らせん6つの円環。角丸はホーム画面側で付くため全面を塗る
export function AppIconArt({ size }: { size: number }) {
  const rosette = goldenRosette(size);
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', background: BRAND_GRADIENT_CSS }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
        <circle cx={rosette.center} cy={rosette.center} r={rosette.ringR} stroke="#ffffff" strokeOpacity={0.35} strokeWidth={rosette.ringStrokeWidth} fill="none" />
        {rosette.spirals.map((sp, i) => (
          <g key={i}>
            <path d={sp.path} stroke="#ffffff" strokeWidth={rosette.strokeWidth} strokeLinecap="round" fill="none" />
            <circle cx={sp.eye.cx} cy={sp.eye.cy} r={rosette.eyeR} fill="#ffffff" />
          </g>
        ))}
      </svg>
    </div>
  );
}
