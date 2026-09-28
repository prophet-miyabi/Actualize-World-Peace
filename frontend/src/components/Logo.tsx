// ブランドロゴ（AWP）。
// AI画像生成は文字の描画が崩れやすいため、ロゴは手書きのSVGで作成し、
// 常にくっきり読める状態を保証する。
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="awp-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#awp-grad)" />
      <text x="20" y="25.5" textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontWeight="800" fontSize="13" letterSpacing="0.5" fill="#ffffff">
        AWP
      </text>
    </svg>
  );
}

export default function Logo({ withWordmark = true, size = 36, className = '' }: { withWordmark?: boolean; size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark size={size} />
      {withWordmark && <span className="font-black tracking-tight text-blue-700">AWP</span>}
    </span>
  );
}
