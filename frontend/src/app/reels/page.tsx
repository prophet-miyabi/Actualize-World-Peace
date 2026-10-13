'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PostView } from '@/components/community/PostCard';

function authHeaders(): Record<string, string> {
  try { const t = localStorage.getItem('token'); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

// リール: 縦にスワイプして見る動画の投稿。画面に入った動画だけ再生する
function Reel({ post }: { post: PostView }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [liked, setLiked] = useState(!!post.liked);
  const [likes, setLikes] = useState(post.likes ?? 0);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && e.intersectionRatio > 0.6) v.play().catch(() => {}); else v.pause();
    }, { threshold: [0, 0.6, 1] });
    io.observe(v);
    return () => io.disconnect();
  }, []);

  const toggleLike = async () => {
    const h = authHeaders();
    if (!h.Authorization) return;
    const next = !liked;
    setLiked(next); setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    await fetch(`/api/posts/${post.id}/like`, { method: next ? 'POST' : 'DELETE', headers: h }).catch(() => {});
  };

  return (
    <section className="relative h-[100svh] snap-start bg-black flex items-center justify-center">
      <video ref={ref} src={post.video ?? undefined} loop muted={muted} playsInline preload="metadata" className="h-full w-full object-contain" onClick={() => setMuted((m) => !m)} />
      <div className="absolute inset-x-0 bottom-0 p-4 pb-28 md:pb-8 bg-gradient-to-t from-black/70 to-transparent text-white">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            {post.author.username && <Link href={`/${post.author.username}`} className="font-bold text-sm">{post.author.name} <span className="font-normal opacity-80">@{post.author.username}</span></Link>}
            {post.body && <p className="text-sm mt-1 line-clamp-3 whitespace-pre-wrap">{post.body}</p>}
            {post.author.pageSlug && <Link href={`/${post.author.pageSlug}`} className="inline-block mt-2 rounded-full bg-white text-gray-900 text-xs font-bold px-3 py-1.5">ページを見る → {post.author.pageName || post.author.pageSlug}</Link>}
          </div>
          <div className="flex flex-col items-center gap-3 text-xs">
            <button onClick={toggleLike} className="flex flex-col items-center"><span className="text-2xl" aria-hidden>{liked ? '♥' : '♡'}</span>{likes}</button>
            <Link href={`/p/${post.id}`} className="flex flex-col items-center"><span className="text-2xl" aria-hidden>💬</span>{post.comments ?? 0}</Link>
            <button onClick={() => setMuted((m) => !m)} className="flex flex-col items-center"><span className="text-2xl" aria-hidden>{muted ? '🔇' : '🔊'}</span></button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ReelsPage() {
  const [posts, setPosts] = useState<PostView[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const load = useCallback(async (before?: string) => {
    const params = new URLSearchParams({ kind: 'reel', ...(before ? { before } : {}) });
    const r = await fetch(`/api/posts/feed?${params}`, { headers: authHeaders() });
    const d = await r.json();
    setHasMore(!!d.hasMore);
    setPosts((prev) => (before && prev ? [...prev, ...d.posts] : d.posts));
  }, []);
  useEffect(() => { load().catch(() => setPosts([])); }, [load]);

  return (
    <main className="bg-black text-white min-h-[100svh]">
      <div className="fixed top-0 inset-x-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
        <Link href="/feed" className="text-sm font-bold">← ホーム</Link>
        <span className="text-sm font-black">リール</span>
        <Link href="/create" className="text-sm font-bold">＋ 投稿</Link>
      </div>
      {posts === null ? <p className="pt-40 text-center text-sm opacity-70">読み込み中…</p>
        : posts.length === 0 ? (
          <div className="pt-40 px-6 text-center text-sm">
            <p className="font-bold">まだリールはありません</p>
            <p className="opacity-80 mt-2">ホームの投稿欄で「🎬 動画」を選ぶと、ここに流れます（60秒まで・25MBまで）。</p>
            <Link href="/feed" className="inline-block mt-4 rounded-full bg-white text-gray-900 font-bold px-5 py-2">投稿しに行く</Link>
          </div>
        ) : (
          <div className="h-[100svh] overflow-y-auto snap-y snap-mandatory">
            {posts.map((p) => <Reel key={p.id} post={p} />)}
            {hasMore && <button onClick={() => load(posts[posts.length - 1].createdAt)} className="w-full py-6 text-sm font-bold">もっと見る</button>}
          </div>
        )}
    </main>
  );
}
