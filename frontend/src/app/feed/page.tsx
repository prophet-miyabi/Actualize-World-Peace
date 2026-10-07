'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import PostCard, { type PostView } from '@/components/community/PostCard';
import { resizeImageToDataUrl } from '@/lib/image';

function token() {
  try { return localStorage.getItem('token') || ''; } catch { return ''; }
}

// タイムライン: みんな／フォロー中の投稿。ログインしていれば上から投稿できる
export default function FeedPage() {
  const [tab, setTab] = useState<'all' | 'following'>('all');
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const auth = (): Record<string, string> => (token() ? { Authorization: `Bearer ${token()}` } : {});

  const load = useCallback(async (before?: string) => {
    const params = new URLSearchParams({ tab, ...(before ? { before } : {}) });
    const r = await fetch(`/api/posts/feed?${params}`, { headers: auth() });
    const d = await r.json();
    setNeedsLogin(!!d.needsLogin);
    setHasMore(!!d.hasMore);
    setPosts((prev) => (before && prev ? [...prev, ...d.posts] : d.posts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => { setSignedIn(!!token()); }, []);
  useEffect(() => { setPosts(null); load().catch(() => setPosts([])); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ body, imageDataUrl: image }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || '投稿できませんでした');
      setBody('');
      setImage(null);
      setPosts((prev) => [d.post, ...(prev ?? [])]);
    } catch (err: any) {
      setError(err?.message || '投稿できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('この投稿を削除しますか？')) return;
    const r = await fetch(`/api/posts/${id}`, { method: 'DELETE', headers: auth() });
    if (r.ok) setPosts((prev) => (prev ?? []).filter((p) => p.id !== id));
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-sky-50 text-gray-900 pb-10">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-xl mx-auto px-4 pt-3">
          <div className="flex items-center justify-between">
            <Link href="/" aria-label="AWP トップ"><Logo size={28} /></Link>
            <Link href="/discover" className="text-xs font-bold text-violet-700">ページを探す →</Link>
          </div>
          <h1 className="text-2xl font-black mt-2">タイムライン</h1>
          <div className="mt-1 flex">
            {(['all', 'following'] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-2 text-sm font-bold border-b-2 ${tab === t ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500'}`}>
                {t === 'all' ? 'みんな' : 'フォロー中'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-xl mx-auto px-4 py-4 space-y-3">
        {signedIn ? (
          <form onSubmit={submit} className="bg-white border rounded-2xl p-3">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={3} placeholder="いま、どんなことしてる？（新作・お知らせ・日々のこと）"
              className="w-full resize-none text-base outline-none" />
            {image && (
              <div className="relative mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" className="w-full rounded-xl max-h-60 object-cover" />
                <button type="button" onClick={() => setImage(null)} className="absolute top-2 right-2 rounded-full bg-black/60 text-white text-xs px-2 py-1">外す</button>
              </div>
            )}
            <div className="flex items-center justify-between mt-2">
              <label className="text-sm text-violet-700 font-bold cursor-pointer">
                📷 写真
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setImage(await resizeImageToDataUrl(f).catch(() => null));
                }} />
              </label>
              <span className="text-[11px] text-gray-400 ml-auto mr-3">{body.length}/500</span>
              <button disabled={busy || !body.trim()} className="rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white text-sm font-bold px-5 py-2 disabled:opacity-40">投稿</button>
            </div>
            {error && (
              <p className="text-xs text-red-600 mt-2">{error}{error.includes('ユーザー名') && <> <Link href="/profile" className="underline font-bold">プロフィールへ</Link></>}</p>
            )}
          </form>
        ) : (
          <div className="bg-white border rounded-2xl p-4 text-center text-sm">
            <Link href="/login" className="font-bold text-violet-700 underline">ログイン</Link>すると投稿できるよ
          </div>
        )}

        {posts === null ? <p className="text-center text-sm text-gray-400 py-10">読み込み中…</p>
          : needsLogin ? <p className="text-center text-sm text-gray-500 py-10">フォロー中の投稿を見るにはログインしてね</p>
          : posts.length === 0 ? <p className="text-center text-sm text-gray-500 py-10">{tab === 'following' ? 'フォロー中の人の投稿はまだないよ' : 'まだ投稿はありません'}</p>
          : posts.map((p) => <PostCard key={p.id} post={p} onDelete={remove} />)}

        {hasMore && posts && posts.length > 0 && (
          <button onClick={() => load(posts[posts.length - 1].createdAt)} className="w-full rounded-full border bg-white py-3 text-sm font-bold text-gray-600">もっと見る</button>
        )}
        <p className="text-[11px] text-gray-400 text-center">投稿は誰でも見られます。<Link href="/terms" className="underline">利用規約</Link>に反する投稿は通報してね。</p>
      </div>
    </main>
  );
}
