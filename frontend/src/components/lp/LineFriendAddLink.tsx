'use client';
import type { CSSProperties, ReactNode } from 'react';

// A/Bテスト（見出しのバリエーション）のコンバージョン計測用。
// LINE友だち追加ボタンのクリックを、選ばれたバリエーションの成果として記録してから遷移する。
// sendBeaconはページ遷移中でも確実に送信されるため、クリックのハンドリングだけで完結できる。
export function LineFriendAddLink({
  href, slug, variantId, style, className, children
}: { href: string; slug: string; variantId: string | null; style?: CSSProperties; className?: string; children: ReactNode }) {
  function handleClick() {
    if (!variantId) return;
    try {
      const body = new Blob([JSON.stringify({ variantId })], { type: 'application/json' });
      navigator.sendBeacon(`/api/lp/${encodeURIComponent(slug)}/convert`, body);
    } catch {
      // 計測の失敗でLINEへの遷移を止めない
    }
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={handleClick} style={style} className={className}>
      {children}
    </a>
  );
}
