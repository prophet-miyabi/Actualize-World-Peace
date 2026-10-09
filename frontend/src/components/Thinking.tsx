'use client';
import { useEffect, useState } from 'react';

// 「考え中」の表示。何も起きていないように見えないよう、少しずつ言葉を変え、点を動かす。
// text を渡すとその文（エージェントの口調の進行状況）をそのまま出す
const DEFAULT_PHASES = ['考え中', '整理しています', 'まとめています', 'もう少しお待ちください'];

export default function Thinking({ text, name, phases = DEFAULT_PHASES, className = '' }: { text?: string; name?: string; phases?: string[]; className?: string }) {
  const [i, setI] = useState(0);
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const a = setInterval(() => setDots((d) => (d % 3) + 1), 500);
    const b = setInterval(() => setI((x) => Math.min(x + 1, phases.length - 1)), 4000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [phases.length]);
  const body = text || phases[i];
  return (
    <p className={`text-xs text-gray-500 flex items-center gap-1.5 ${className}`} aria-live="polite">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
      {name ? <span className="font-bold text-gray-600">{name}</span> : null}
      <span>{body}{'.'.repeat(dots)}</span>
    </p>
  );
}
