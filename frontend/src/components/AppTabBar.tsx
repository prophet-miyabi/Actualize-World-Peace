'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

// ログイン後の画面だけに出す、スマホアプリ風の下部タブバー（PCでは非表示）。
// 公開ページ（/{slug}）やトップページには出さない
const APP_PREFIXES = ['/discover', '/feed', '/profile', '/wallet', '/analytics', '/bookings', '/products', '/dashboard', '/features', '/tools', '/harness', '/preview', '/domain', '/growth', '/photos', '/social', '/agents', '/automation'];

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden>
    <path d={d} />
  </svg>
);

const TABS: { href: string; label: string; icon: ReactNode; match: string[] }[] = [
  { href: '/dashboard', label: 'ホーム', icon: <Icon d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />, match: ['/dashboard'] },
  { href: '/discover', label: '発見', icon: <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm3.5-12.5-2 5-5 2 2-5z" />, match: ['/discover', '/feed'] },
  { href: '/features', label: '機能', icon: <Icon d="M12 5v14M5 12h14" />, match: ['/features'] },
  { href: '/tools', label: 'ツール', icon: <Icon d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" />, match: ['/tools'] },
  { href: '/preview', label: '見てみる', icon: <Icon d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />, match: ['/preview'] }
];

export default function AppTabBar() {
  const pathname = usePathname() || '/';
  const lp = useSearchParams()?.get('lp');
  if (!APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;
  const qs = lp ? `?lp=${encodeURIComponent(lp)}` : '';

  return (
    <>
      {/* 固定バーの下にページの最後が隠れないよう、同じ高さの余白を置く */}
      <div aria-hidden className="h-24 md:hidden" />
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ul className="grid grid-cols-5">
          {TABS.map((t) => {
            const active = t.match.some((m) => pathname.startsWith(m));
            return (
              <li key={t.href}>
                <Link href={`${t.href}${qs}`} aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold ${active ? 'text-violet-600' : 'text-gray-500'}`}>
                  {t.icon}
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
