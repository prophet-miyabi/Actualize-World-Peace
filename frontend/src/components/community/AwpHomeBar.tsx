'use client';
import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';

// AWPで公開された全ページに必ず入る、AWPの主軸（ホーム）へワンタップで戻る小さなボタン。
// 持ち主の設定では外せない（AWPのネットワークとしての約束）。独自ドメインでも AWP 本体へ戻る
export default function AwpHomeBar({ siteUrl }: { siteUrl: string }) {
  const [href, setHref] = useState(`${siteUrl}/discover`);
  useEffect(() => {
    try { if (localStorage.getItem('token')) setHref(`${siteUrl}/feed`); } catch { /* 無視 */ }
  }, [siteUrl]);
  return (
    <a href={href} data-awp-bar aria-label="AWPのホームへ"
      className="fixed left-3 bottom-3 z-40 flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur shadow-lg border border-gray-200 pl-1.5 pr-3 py-1.5 text-[11px] font-bold text-gray-800"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
      <Logo size={20} />
      <span>AWP</span>
    </a>
  );
}
