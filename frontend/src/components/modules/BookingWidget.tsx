'use client';
import { useState } from 'react';

type Config = { menus: { name: string; note: string }[]; note: string; leadDays: number; maxDays: number };
type Props = { slug: string; businessName: string; config: Config; primary: string; onPrimary: string; siteUrl: string };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 予約リクエスト: 希望日時と連絡先を送る。予約が確定するのは、お店からの連絡（状況確認ページ）で
export default function BookingWidget({ slug, businessName, config, primary, onPrimary, siteUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [agree, setAgree] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');

  const min = ymd(new Date(Date.now() + config.leadDays * 86_400_000));
  const max = ymd(new Date(Date.now() + config.maxDays * 86_400_000));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const requestedAt = new Date(`${date}T${time || '00:00'}:00`).toISOString();
      const r = await fetch(`/api/bookings/${slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu, requestedAt, name, contact, message, agree, website })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || '送信できませんでした');
      setCode(d.code);
    } catch (err: any) {
      setError(err?.message || '送信できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const input = 'mt-1 w-full border border-gray-300 rounded-xl px-3 py-2.5 text-base bg-white';

  return (
    <div className="bg-white text-gray-800 px-4 py-8 text-center" style={{ fontFamily: 'var(--font-sans-jp)' }}>
      <button onClick={() => setOpen(true)} className="w-full max-w-sm rounded-full font-bold py-4 shadow-lg" style={{ background: primary, color: onPrimary }}>
        📅 予約をリクエストする
      </button>
      <p className="text-[11px] text-gray-500 mt-2">希望日時を送ると、お店から確定の連絡が届きます</p>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
          <div className="bg-white w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 text-left" onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
            {code ? (
              <div className="text-center py-4">
                <p className="text-4xl" aria-hidden>📨</p>
                <p className="font-black text-lg mt-2">リクエストを送りました</p>
                <p className="text-sm text-gray-600 mt-2">まだ予約は確定していません。{businessName}からの返事は、下のページで確認できます。</p>
                <a href={`${siteUrl}/reserve/${code}`} className="mt-4 block rounded-full font-bold py-3" style={{ background: primary, color: onPrimary }}>状況を確認するページ</a>
                <p className="text-[11px] text-gray-500 mt-2">このページのURLをブックマークしておいてね</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-black">予約リクエスト</p>
                  <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500">閉じる</button>
                </div>
                {config.note && <p className="text-xs text-gray-600 bg-gray-50 rounded-xl p-3 whitespace-pre-wrap">{config.note}</p>}
                {config.menus.length > 0 && (
                  <label className="block text-sm font-bold">メニュー
                    <select className={input} value={menu} onChange={(e) => setMenu(e.target.value)} required>
                      <option value="">選んでください</option>
                      {config.menus.map((m) => <option key={m.name} value={m.name}>{m.name}{m.note ? `（${m.note}）` : ''}</option>)}
                    </select>
                  </label>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-sm font-bold">希望日<input type="date" className={input} min={min} max={max} value={date} onChange={(e) => setDate(e.target.value)} required /></label>
                  <label className="block text-sm font-bold">時間<input type="time" className={input} value={time} onChange={(e) => setTime(e.target.value)} required /></label>
                </div>
                <label className="block text-sm font-bold">お名前<input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" required /></label>
                <label className="block text-sm font-bold">連絡先（メールまたは電話番号）<input className={input} value={contact} onChange={(e) => setContact(e.target.value)} maxLength={100} autoComplete="email" required /></label>
                <label className="block text-sm font-bold">メッセージ（任意）<textarea className={input} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} /></label>
                {/* ボットよけ（画面には表示しない） */}
                <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden />
                <label className="flex items-start gap-2 text-xs text-gray-600">
                  <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
                  <span>入力した内容は、予約のやり取りのために{businessName}に届きます。AWPは予約のやり取りの記録として保存し、希望日から1年後に削除します（<a href={`${siteUrl}/privacy`} className="underline" target="_blank" rel="noopener noreferrer">プライバシーポリシー</a>）。</span>
                </label>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button disabled={busy} className="w-full rounded-full font-bold py-3.5 disabled:opacity-50" style={{ background: primary, color: onPrimary }}>
                  {busy ? '送信中…' : 'リクエストを送る'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
