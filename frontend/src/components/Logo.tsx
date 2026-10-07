import { useId } from 'react';
import { Outfit } from 'next/font/google';
import { BRAND_GRADIENT, PHI, goldenRosette } from '@/lib/brand';

// ブランドロゴ（AWP）。AI画像生成は文字や形が崩れやすいため、SVGで描いて常にくっきり表示する。
// マークは、黄金らせん（らせん＋収束点）6つを円周上に60°ずつ並べた円環（lib/brand.ts）。
// 黄金比: マークの高さ : 文字の大きさ = φ : 1、マークと文字の間隔 = マーク × 1/φ²、角丸 = マーク × 1/φ³
const brandFont = Outfit({ subsets: ['latin'], weight: ['600', '700'], display: 'swap' });

const VIEW = 40;
const rosette = goldenRosette(VIEW);

export function LogoMark({ size = 36 }: { size?: number }) {
  const gid = `awp-grad-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2={VIEW} y2={VIEW} gradientUnits="userSpaceOnUse">
          <stop stopColor={BRAND_GRADIENT[0]} />
          <stop offset="0.5" stopColor={BRAND_GRADIENT[1]} />
          <stop offset="1" stopColor={BRAND_GRADIENT[2]} />
        </linearGradient>
      </defs>
      <rect width={VIEW} height={VIEW} rx={VIEW / PHI ** 3} fill={`url(#${gid})`} />
      <circle cx={rosette.center} cy={rosette.center} r={rosette.ringR} stroke="#ffffff" strokeOpacity={0.35} strokeWidth={rosette.ringStrokeWidth} fill="none" />
      {rosette.spirals.map((sp, i) => (
        <g key={i}>
          <path d={sp.path} stroke="#ffffff" strokeWidth={rosette.strokeWidth} strokeLinecap="round" fill="none" />
          <circle cx={sp.eye.cx} cy={sp.eye.cy} r={rosette.eyeR} fill="#ffffff" />
        </g>
      ))}
    </svg>
  );
}

export default function Logo({ withWordmark = true, size = 36, className = '' }: { withWordmark?: boolean; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center ${className}`} style={{ gap: size / PHI ** 2 }}>
      <LogoMark size={size} />
      {withWordmark && (
        <span className={`${brandFont.className} font-bold leading-none bg-clip-text text-transparent`}
          style={{ fontSize: size / PHI, letterSpacing: '0.06em', backgroundImage: `linear-gradient(90deg, ${BRAND_GRADIENT.join(', ')})` }}>
          AWP
        </span>
      )}
    </span>
  );
}
