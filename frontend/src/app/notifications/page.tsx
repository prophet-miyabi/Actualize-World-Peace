'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { ago } from '@/components/community/PostCard';

type N = { id: string; type: string; title: string; body: string; href: string | null; readAt: string | null; createdAt: string };
const ICON: Record<string, string> = { follow: '🙌', post_like: '♥', comment: '💬', page_like: '✨', booking: '🗓️', order: '🛍️', plan: '⚡', system: '🔔' };

// 通知: フォロー・いいね・返信・予約・注文・プランなど。開いたら既読にする
export default function NotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<N[] | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = async (before?: string) => {
    const r = await api.get('/notifications', { params: before ? { before } : {} });
    setItems((prev) => (before && prev ? [...prev, ...r.data.notifications] : r.data.notifications));
    setHasMore(!!r.data.hasMore);
    if (!before && r.data.unread > 0) api.post('/notifications/read', {}).catch(() => {});
  };
  useEffect(() => { load().catch((e) => { if (e?.response?.status === 401) router.replace('/login?next=/notifications'); else setItems([]); }); }, [router]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-sky-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 pt-5 pb-10">
        <h1 className="text-2xl font-black">通知</h1>
        {items === null ? <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>
          : items.length === 0 ? (
            <div className="bg-white rounded-2xl p-6 text-center text-sm text-gray-500 mt-4">
              まだ通知はありません。<br />投稿やページにいいね・返信・フォローがあると、ここに届きます。
              <Link href="/discover" className="block mt-3 text-violet-700 font-bold underline">みんなのページを見てみる →</Link>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {items.map((n) => {
                const inner = (
                  <div className={`flex gap-3 rounded-2xl border p-3 ${n.readAt ? 'bg-white' : 'bg-violet-50 border-violet-200'}`}>
                    <span className="text-xl w-8 text-center" aria-hidden>{ICON[n.type] ?? '🔔'}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{n.title}</p>
                      {n.body && <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{n.body}</p>}
                      <p className="text-[11px] text-gray-400 mt-1">{ago(n.createdAt)}</p>
                    </div>
                  </div>
                );
                return <li key={n.id}>{n.href ? <Link href={n.href}>{inner}</Link> : inner}</li>;
              })}
            </ul>
          )}
        {hasMore && items && items.length > 0 && (
          <button onClick={() => load(items[items.length - 1].createdAt)} className="mt-3 w-full rounded-full border bg-white py-3 text-sm font-bold text-gray-600">もっと見る</button>
        )}
      </div>
    </main>
  );
}
