'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';

type Config = { menus: { name: string; note: string }[]; note: string; leadDays: number; maxDays: number };
type Booking = {
  id: string; menu: string | null; requestedAt: string; name: string; contact: string; message: string | null;
  status: 'requested' | 'confirmed' | 'declined' | 'canceled'; ownerNote: string | null; createdAt: string;
};

const STATUS_LABEL: Record<Booking['status'], string> = { requested: '返事待ち', confirmed: '確定', declined: 'お断り', canceled: '取り消し' };
const STATUS_CLS: Record<Booking['status'], string> = {
  requested: 'bg-amber-100 text-amber-700', confirmed: 'bg-green-100 text-green-700', declined: 'bg-gray-100 text-gray-500', canceled: 'bg-gray-100 text-gray-500'
};

export default function BookingsPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-gray-400">読み込み中…</main>}>
      <Bookings />
    </Suspense>
  );
}

// 予約リクエストの受付設定と、届いたリクエストへの返事
function Bookings() {
  const lpId = useSearchParams()?.get('lp') || '';
  const [page, setPage] = useState<{ id: string; slug: string; bookingEnabled: boolean; bookingConfig: Config } | null | undefined>(undefined);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [config, setConfig] = useState<Config>({ menus: [], note: '', leadDays: 1, maxDays: 60 });
  const [enabled, setEnabled] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get('/bookings/mine/list', { params: lpId ? { lpId } : {} });
    setPage(data.page);
    setBookings(data.bookings);
    if (data.page) {
      setConfig(data.page.bookingConfig);
      setEnabled(data.page.bookingEnabled);
    }
  }, [lpId]);
  useEffect(() => { load().catch(() => setError('読み込めませんでした。')); }, [load]);

  const saveSettings = async () => {
    setMsg('');
    setError('');
    try {
      await api.put('/bookings/mine/settings', { lpId: page!.id, enabled, config });
      setMsg(enabled ? '保存しました！ページに「予約をリクエストする」ボタンが出ています。' : '保存しました（受付は停止中）。');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || '保存できませんでした。');
    }
  };

  const update = async (b: Booking, status: Booking['status']) => {
    try {
      await api.put(`/bookings/mine/${b.id}`, { status, ownerNote: notes[b.id] ?? b.ownerNote ?? '' });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || '更新できませんでした。');
    }
  };

  if (page === undefined) return <main className="p-6 text-sm text-gray-400">{error || '読み込み中…'}</main>;
  if (page === null) return <main className="p-6 text-sm text-gray-600">まだページがありません。<Link href="/builder" className="text-violet-700 underline">ページをつくる</Link></main>;

  const now = Date.now();
  const upcoming = bookings.filter((b) => new Date(b.requestedAt).getTime() >= now - 86_400_000);
  const past = bookings.filter((b) => new Date(b.requestedAt).getTime() < now - 86_400_000).reverse();
  const waiting = upcoming.filter((b) => b.status === 'requested').length;
  const input = 'mt-1 w-full border rounded-xl px-3 py-2 text-base bg-white';

  const card = (b: Booking) => (
    <li key={b.id} className="bg-white border rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-black">{new Date(b.requestedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}</p>
          <p className="text-sm">{b.name}さん{b.menu ? `・${b.menu}` : ''}</p>
          <a href={b.contact.includes('@') ? `mailto:${b.contact}` : `tel:${b.contact.replace(/[^0-9+]/g, '')}`} className="text-sm text-violet-700 underline break-all">{b.contact}</a>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLS[b.status]}`}>{STATUS_LABEL[b.status]}</span>
      </div>
      {b.message && <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3 mt-2 whitespace-pre-wrap">{b.message}</p>}
      {(b.status === 'requested' || b.status === 'confirmed') && (
        <>
          <input className={`${input} mt-3 text-sm`} placeholder="お客様へのひとこと（状況確認ページに表示）" maxLength={300}
            value={notes[b.id] ?? b.ownerNote ?? ''} onChange={(e) => setNotes({ ...notes, [b.id]: e.target.value })} />
          <div className="flex gap-2 mt-2">
            {b.status === 'requested' && <button onClick={() => update(b, 'confirmed')} className="flex-1 rounded-full bg-green-600 text-white text-sm font-bold py-2">確定する</button>}
            {b.status === 'confirmed' && <button onClick={() => update(b, 'confirmed')} className="flex-1 rounded-full border text-sm py-2">ひとことを更新</button>}
            <button onClick={() => update(b, 'declined')} className="flex-1 rounded-full border text-sm text-gray-600 py-2">お断りする</button>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">確定・お断りは、お客様の状況確認ページに表示されます。念のため連絡先にも一言伝えると安心です。</p>
        </>
      )}
    </li>
  );

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <Link href={`/dashboard${lpId ? `?lp=${encodeURIComponent(lpId)}` : ''}`} className="text-sm text-violet-700 font-bold">← ホーム</Link>
        <h1 className="text-2xl font-black">予約リクエスト {waiting > 0 && <span className="text-sm align-middle rounded-full bg-amber-400 text-white px-2 py-0.5">{waiting}件 返事待ち</span>}</h1>

        <section>
          <h2 className="font-bold text-sm mb-2">これからの予約</h2>
          {upcoming.length === 0 ? <p className="text-sm text-gray-500 bg-white border rounded-2xl p-4">まだリクエストはありません</p> : <ul className="space-y-3">{upcoming.map(card)}</ul>}
          {past.length > 0 && (
            <button onClick={() => setShowPast(!showPast)} className="mt-3 text-xs text-gray-500 underline">{showPast ? '過去の予約を閉じる' : `過去の予約（${past.length}）を見る`}</button>
          )}
          {showPast && <ul className="space-y-3 mt-3 opacity-70">{past.map(card)}</ul>}
        </section>

        <section className="bg-white border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-black">受付の設定</h2>
            <button onClick={() => setEnabled(!enabled)} role="switch" aria-checked={enabled} aria-label="予約リクエストの受付"
              className={`relative w-12 h-7 rounded-full transition ${enabled ? 'bg-violet-600' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          <p className="text-xs text-gray-500">オンにすると、ページに「予約をリクエストする」ボタンが出ます。予約が確定するのは、あなたが「確定する」を押したときだけです。</p>
          <div>
            <p className="text-sm font-bold">メニュー（任意・最大20）</p>
            {config.menus.map((m, i) => (
              <div key={i} className="flex gap-2 mt-2">
                <input className="flex-1 min-w-0 border rounded-xl px-3 py-2 text-base" placeholder="例: カット" value={m.name} maxLength={40}
                  onChange={(e) => setConfig({ ...config, menus: config.menus.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <input className="w-20 shrink-0 border rounded-xl px-3 py-2 text-base" placeholder="60分" value={m.note} maxLength={80}
                  onChange={(e) => setConfig({ ...config, menus: config.menus.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} />
                <button onClick={() => setConfig({ ...config, menus: config.menus.filter((_, j) => j !== i) })} className="shrink-0 w-6 text-xs text-gray-500" aria-label="削除">✕</button>
              </div>
            ))}
            {config.menus.length < 20 && (
              <button onClick={() => setConfig({ ...config, menus: [...config.menus, { name: '', note: '' }] })} className="mt-2 text-sm text-violet-700 font-bold">＋ メニューを追加</button>
            )}
          </div>
          <label className="block text-sm font-bold">お客様へのお知らせ（任意）
            <textarea className={input} rows={2} maxLength={300} value={config.note} onChange={(e) => setConfig({ ...config, note: e.target.value })} placeholder="例: 定休日は火曜です。確定のご連絡は営業時間内にします。" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-bold">何日後から受付
              <input type="number" min={0} max={30} className={input} value={config.leadDays} onChange={(e) => setConfig({ ...config, leadDays: Number(e.target.value) })} />
            </label>
            <label className="block text-sm font-bold">何日先まで受付
              <input type="number" min={1} max={180} className={input} value={config.maxDays} onChange={(e) => setConfig({ ...config, maxDays: Number(e.target.value) })} />
            </label>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {msg && <p className="text-sm text-green-700">{msg}</p>}
          <button onClick={saveSettings} className="w-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold py-3">保存する</button>
          <p className="text-[11px] text-gray-500">お客様の名前・連絡先は、予約のやり取りにだけ使ってください。希望日から1年たったリクエストは自動で削除されます。</p>
        </section>
      </div>
    </main>
  );
}
