'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type ShowcaseItem = { key: string; label: string; lp: { businessName: string }; imageUrl: string | null };

// トップページのスマホ見本。9パターンの架空のページを、実際のページ部品（型・色・書体）で描き、
// 数秒ごとに自動で切り替える。ホバー／タッチ中は止まり、点で任意のページへ移動できる。
// 中身は /showcase/[key] を幅390pxの iframe で読み込み、スマホ用のスタイルのまま縮小して見せる
const RENDER_WIDTH = 390;
const INTERVAL_MS = 4500;

export default function PhoneShowcase({ items }: { items: ShowcaseItem[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (paused || items.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % items.length), INTERVAL_MS);
    return () => clearInterval(t);
  }, [paused, items.length]);

  if (items.length === 0) return null;
  const current = items[i];
  const scale = box.w ? box.w / RENDER_WIDTH : 0;

  return (
    <div className="flex flex-col items-center gap-3" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onTouchStart={() => setPaused(true)} onTouchEnd={() => setPaused(false)}>
      <div className="relative w-[17rem] sm:w-72 h-[37rem] rounded-[2.75rem] border-[9px] border-[#1c1c1e] bg-white shadow-2xl overflow-hidden">
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-5 rounded-full bg-[#1c1c1e] z-20" />
        <div ref={boxRef} className="absolute inset-0 overflow-hidden bg-white">
          {scale > 0 && items.map((it, idx) => (
            <iframe key={it.key} src={`/showcase/${it.key}`} title={`${it.label}の見本`} tabIndex={-1} aria-hidden={idx !== i} scrolling="no" loading={idx < 2 ? 'eager' : 'lazy'}
              className="absolute top-0 left-0 border-0 transition-opacity duration-700 ease-out"
              style={{ width: RENDER_WIDTH, height: box.h / scale, transform: `scale(${scale})`, transformOrigin: 'top left', opacity: idx === i ? 1 : 0, pointerEvents: 'none' }} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {items.map((it, idx) => (
          <button key={it.key} type="button" aria-label={`${it.label}の見本`} onClick={() => setI(idx)}
            className={`h-2 rounded-full transition-all ${idx === i ? 'w-6 bg-violet-600' : 'w-2 bg-gray-300 hover:bg-gray-400'}`} />
        ))}
      </div>
      <p className="text-xs text-gray-500">{current.label}の見本「{current.lp.businessName}」（架空）・9パターンを自動で切り替え</p>
    </div>
  );
}
