'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

// ログイン後の画面に出す、SNS の下部タブバー（PCでは非表示）。
// ホーム（タイムライン）／発見／作る／通知／マイページ。公開ページ（/{slug}）とトップには出さない
const APP_PREFIXES = ['/feed', '/reels', '/discover', '/create', '/notifications', '/me', '/p/', '/profile', '/wallet', '/analytics', '/bookings', '/products', '/plans', '/orders', '/shop-settings', '/dashboard', '/features', '/tools', '/harness', '/preview', '/domain', '/growth', '/photos', '/social', '/agents', '/automation', '/builder', '/wizard'];

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6" aria-hidden>
    <path d={d} />
  </svg>
);

const TABS: { href: string; label: string; icon: ReactNode; match: string[]; center?: boolean; badge?: boolean }[] = [
  { href: '/feed', label: 'ホーム', icon: <Icon d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />, match: ['/feed', '/p/', '/reels'] },
  { href: '/discover', label: '発見', icon: <Icon d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.3-4.3" />, match: ['/discover'] },
  { href: '/create', label: '作る', icon: <Icon d="M12 5v14M5 12h14" />, match: ['/create', '/wizard', '/builder'], center: true },
  { href: '/notifications', label: '通知', icon: <Icon d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9zm4 13a2 2 0 0 0 4 0" />, match: ['/notifications'], badge: true },
  { href: '/me', label: 'マイページ', icon: <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />, match: ['/me', '/profile', '/dashboard'] }
];

function token() {
  try { return localStorage.getItem('token') || ''; } catch { return ''; }
}

export default function AppTabBar() {
  const pathname = usePathname() || '/';
  const [unread, setUnread] = useState(0);
  const show = APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`));

  // 未読の通知の数（ログイン中だけ。60秒ごと・通知画面を開いたら消える）
  useEffect(() => {
    if (!show) return;
    let stop = false;
    const tick = async () => {
      const t = token();
      if (!t) { setUnread(0); return; }
      try {
        const r = await fetch('/api/notifications/unread', { headers: { Authorization: `Bearer ${t}` } });
        const d = await r.json();
        if (!stop) setUnread(Number(d.unread) || 0);
      } catch { /* 無視 */ }
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => { stop = true; clearInterval(id); };
  }, [show, pathname]);

  if (!show) return null;

  return (
    <>
      {/* 固定バーの下にページの最後が隠れないよう、同じ高さの余白を置く */}
      <div aria-hidden className="h-24 md:hidden" />
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-gray-200"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ul className="grid grid-cols-5">
          {TABS.map((t) => {
            const active = t.match.some((m) => pathname === m || pathname.startsWith(m.endsWith('/') ? m : `${m}/`) || pathname === m.replace(/\/$/, ''));
            return (
              <li key={t.href} className="relative">
                <Link href={t.href} aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-bold ${active ? 'text-violet-600' : 'text-gray-500'}`}>
                  {t.center ? (
                    <span className="-mt-5 mb-0.5 w-12 h-12 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white flex items-center justify-center shadow-lg">{t.icon}</span>
                  ) : t.icon}
                  {t.label}
                  {t.badge && unread > 0 && <span className="absolute top-1.5 right-[calc(50%-18px)] min-w-[18px] h-[18px] rounded-full bg-pink-500 text-white text-[10px] font-black flex items-center justify-center px-1">{unread > 99 ? '99+' : unread}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
