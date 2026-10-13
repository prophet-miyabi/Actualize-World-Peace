'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PostView } from './PostCard';

// 公開ページに埋め込む「最新の投稿」。持ち主が投稿するたびに自動で更新される（ページ側は常に最新を取りに行く）。
// 投稿を見た人は、ここから持ち主のプロフィール（投稿のまとめ）へ行ける
export default function OwnerPostsSection({ username, primary, onPrimary, siteUrl }: { username: string; primary: string; onPrimary: string; siteUrl: string }) {
  const [posts, setPosts] = useState<PostView[] | null>(null);
  useEffect(() => {
    fetch(`/api/posts/user/${encodeURIComponent(username)}?limit=6`).then((r) => r.json()).then((d) => setPosts(d.posts || [])).catch(() => setPosts([]));
  }, [username]);
  if (!posts || posts.length === 0) return null;
  const media = posts.filter((p) => p.video || p.image);
  return (
    <section className="px-6 py-10 max-w-3xl mx-auto" data-awp-posts>
      <div className="flex items-end justify-between mb-4">
        <h2 className="text-xl font-black">最新の投稿</h2>
        <a href={`${siteUrl}/${username}`} className="text-xs font-bold underline">すべて見る →</a>
      </div>
      {media.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mb-4">
          {media.slice(0, 6).map((p) => (
            <a key={p.id} href={`${siteUrl}/p/${p.id}`} className="relative aspect-square rounded-lg overflow-hidden bg-black/5">
              {p.video ? (
                <video src={p.video} muted playsInline preload="metadata" className="w-full h-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image!} alt="" loading="lazy" className="w-full h-full object-cover" />
              )}
              {p.video && <span className="absolute top-1 right-1 text-[10px] bg-black/60 text-white rounded px-1">▶</span>}
            </a>
          ))}
        </div>
      )}
      <ul className="space-y-2">
        {posts.filter((p) => p.body).slice(0, 3).map((p) => (
          <li key={p.id}>
            <a href={`${siteUrl}/p/${p.id}`} className="block rounded-xl px-4 py-3 text-sm" style={{ background: `${primary}14` }}>
              <span className="line-clamp-2 whitespace-pre-wrap">{p.body}</span>
              <span className="block text-[11px] opacity-60 mt-1">{new Date(p.createdAt).toLocaleDateString('ja-JP')}</span>
            </a>
          </li>
        ))}
      </ul>
      <Link href={`/${username}`} className="mt-4 inline-block rounded-full px-5 py-2 text-sm font-bold" style={{ background: primary, color: onPrimary }}>フォローして最新を受け取る</Link>
    </section>
  );
}
