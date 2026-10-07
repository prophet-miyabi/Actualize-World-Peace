'use client';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import api from '@/lib/api';
import Logo from '@/components/Logo';

// 運営者（管理者）画面の共通の枠。L Harness の管理画面にならい、メニューを目的ごとにまとめる。
// PCは左のサイドバー、スマホは上部の横スクロールメニュー
const SECTIONS: { label: string | null; items: { href: string; label: string; danger?: boolean }[] }[] = [
  { label: null, items: [{ href: '/admin', label: 'ダッシュボード' }, { href: '/admin/ops', label: 'AIオペレーター' }] },
  { label: '対応', items: [{ href: '/admin/harness', label: 'Harness 申し込み・料金' }, { href: '/admin/reports', label: '通報' }, { href: '/admin/monitoring', label: 'エラー監視' }] },
  { label: '収益', items: [{ href: '/admin/revenue', label: '収益と分配' }, { href: '/admin/tools', label: '提携ツール' }] },
  { label: 'サイト', items: [{ href: '/admin/assets', label: '外装画像' }] },
  { label: '設定', items: [{ href: '/admin/emergency', label: '緊急コントロール', danger: true }] }
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/admin';
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    api.get('/auth/me').then(({ data }) => setAllowed(!!data.isAdmin)).catch(() => setAllowed(false));
  }, []);

  if (allowed === null) return <div className="min-h-screen" />;
  if (!allowed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-lg font-bold">運営者専用の画面です</p>
        <Link href="/dashboard" className="text-violet-600 underline">ダッシュボードへ戻る</Link>
      </div>
    );
  }

  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));
  const all = SECTIONS.flatMap((s) => s.items);

  return (
    <div className="min-h-screen bg-gray-50 md:flex">
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 bg-white border-r min-h-screen sticky top-0">
        <div className="px-5 py-5 border-b"><Link href="/admin"><Logo size={28} /></Link><p className="text-[11px] text-gray-500 mt-1">運営者画面</p></div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {SECTIONS.map((s, i) => (
            <div key={i}>
              {s.label && <p className="px-3 mb-1 text-[11px] font-semibold text-gray-400 tracking-wider">{s.label}</p>}
              <ul className="space-y-0.5">
                {s.items.map((it) => (
                  <li key={it.href}>
                    <Link href={it.href}
                      className={`block rounded-lg px-3 py-2 text-sm font-bold ${isActive(it.href) ? 'bg-violet-600 text-white' : it.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'}`}>
                      {it.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <Link href="/dashboard" className="px-5 py-4 border-t text-sm text-gray-500">← 自分のページへ</Link>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="md:hidden sticky top-0 z-30 bg-white/95 backdrop-blur border-b">
          <div className="flex items-center justify-between px-4 pt-3">
            <Link href="/admin"><Logo size={24} /></Link>
            <Link href="/dashboard" className="text-xs text-gray-500">自分のページへ</Link>
          </div>
          <nav className="flex gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none]">
            {all.map((it) => (
              <Link key={it.href} href={it.href}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${isActive(it.href) ? 'bg-violet-600 text-white' : it.danger ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-700'}`}>
                {it.label}
              </Link>
            ))}
          </nav>
        </div>
        {children}
      </div>
    </div>
  );
}
