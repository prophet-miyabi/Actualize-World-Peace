'use client';
import { useState } from 'react';

// ページ・プロフィールの通報。理由を選んで匿名で送る（ログイン中なら運営側で通報者を確認できる）
const REASONS: { id: string; label: string }[] = [
  { id: 'scam', label: '詐欺・誇大な表現' },
  { id: 'illegal', label: '違法な内容' },
  { id: 'adult', label: 'わいせつ・暴力的な内容' },
  { id: 'harassment', label: '誹謗中傷・嫌がらせ' },
  { id: 'copyright', label: '著作権・肖像権の侵害' },
  { id: 'other', label: 'その他' }
];

export default function ReportButton({ targetType, targetId }: { targetType: 'page' | 'profile' | 'post'; targetId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setError('');
    let token = '';
    try { token = localStorage.getItem('token') || ''; } catch { /* 無視 */ }
    try {
      const r = await fetch('/api/community/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ targetType, targetId, reason, detail })
      });
      if (r.ok) setDone(true);
      else setError((await r.json().catch(() => ({}))).error || '送信できませんでした');
    } catch {
      setError('送信できませんでした');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-xs text-gray-400 underline shrink-0">通報</button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center text-gray-800" onClick={() => setOpen(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5" onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))', fontFamily: 'var(--font-sans-jp)' }}>
            {done ? (
              <>
                <p className="font-bold">通報を受け付けました</p>
                <p className="text-sm text-gray-600 mt-1">運営が内容を確認し、利用規約に反する場合は公開を停止します。ご協力ありがとうございます。</p>
                <button onClick={() => setOpen(false)} className="mt-4 w-full rounded-full bg-gray-900 text-white font-bold py-3">閉じる</button>
              </>
            ) : (
              <>
                <p className="font-bold">{targetType === 'page' ? 'このページ' : targetType === 'post' ? 'この投稿' : 'このプロフィール'}を通報する</p>
                <p className="text-xs text-gray-500 mt-1">理由を選んでください</p>
                <div className="mt-3 grid gap-2">
                  {REASONS.map((r) => (
                    <button key={r.id} onClick={() => setReason(r.id)}
                      className={`text-left rounded-xl border px-4 py-3 text-sm ${reason === r.id ? 'border-violet-500 bg-violet-50 font-bold' : 'border-gray-200'}`}>
                      {r.label}
                    </button>
                  ))}
                </div>
                <textarea value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={1000} rows={2}
                  placeholder="詳しい内容（任意）" className="mt-3 w-full border rounded-xl px-3 py-2 text-base" />
                {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setOpen(false)} className="flex-1 rounded-full border py-3 text-sm">やめる</button>
                  <button onClick={send} disabled={!reason || busy} className="flex-1 rounded-full bg-gray-900 text-white font-bold py-3 text-sm disabled:opacity-40">送信する</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
