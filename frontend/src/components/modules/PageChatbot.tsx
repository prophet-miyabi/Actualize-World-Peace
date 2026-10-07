'use client';
import { useEffect, useRef, useState } from 'react';

type Turn = { role: 'user' | 'assistant'; content: string };

// ページのAIチャットボット（右下の丸ボタン）。ページの情報だけで答え、わからないことは問い合わせ方法を案内する
export default function PageChatbot({ slug, businessName, primary, onPrimary }: { slug: string; businessName: string; primary: string; onPrimary: string }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([{ role: 'assistant', content: `こんにちは！${businessName}について、気になることを聞いてね。` }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [turns, open]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setBusy(true);
    try {
      const r = await fetch(`/api/chatbot/${slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(1).slice(-8) })
      });
      const d = await r.json().catch(() => ({}));
      setTurns([...next, { role: 'assistant', content: r.ok ? d.answer : d.error || 'うまく答えられませんでした。' }]);
    } catch {
      setTurns([...next, { role: 'assistant', content: '通信できませんでした。もう一度試してね。' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ fontFamily: 'var(--font-sans-jp)' }}>
      {!open && (
        <button onClick={() => setOpen(true)} aria-label="AIに質問する"
          className="fixed z-40 right-4 bottom-4 rounded-full shadow-xl px-4 py-3 text-sm font-bold flex items-center gap-1.5"
          style={{ background: primary, color: onPrimary, marginBottom: 'env(safe-area-inset-bottom)' }}>
          <span aria-hidden>💬</span> 質問する
        </button>
      )}
      {open && (
        <div className="fixed z-50 inset-x-0 bottom-0 sm:inset-auto sm:right-4 sm:bottom-4 sm:w-96 bg-white text-gray-800 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[80vh] border">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div>
              <p className="font-bold text-sm">{businessName}のAIアシスタント</p>
              <p className="text-[10px] text-gray-500">ページの情報をもとにAIが答えます。予約・注文はここでは受け付けません</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-sm text-gray-500 shrink-0 ml-2">閉じる</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex'}>
                <p className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${t.role === 'user' ? 'rounded-br-sm' : 'bg-gray-100 rounded-bl-sm'}`}
                  style={t.role === 'user' ? { background: primary, color: onPrimary } : undefined}>
                  {t.content}
                </p>
              </div>
            ))}
            {busy && <p className="text-xs text-gray-400">考え中…</p>}
            <div ref={bottom} />
          </div>
          <form onSubmit={send} className="flex gap-2 p-3 border-t" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} placeholder="例: 駐車場はありますか？"
              className="flex-1 border rounded-full px-4 py-2.5 text-base" />
            <button disabled={busy || !input.trim()} className="rounded-full px-4 font-bold text-sm disabled:opacity-40" style={{ background: primary, color: onPrimary }}>送信</button>
          </form>
          <p className="text-[10px] text-gray-400 px-4 pb-2 -mt-1">質問の文章は、お店が「よく聞かれること」を知るために保存されます。個人情報は入力しないでね。</p>
        </div>
      )}
    </div>
  );
}
