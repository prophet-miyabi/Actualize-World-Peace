'use client';
import Link from 'next/link';
import { useState } from 'react';
import ReportButton from './ReportButton';

export type PostView = {
  id: string; body: string; createdAt: string; mine: boolean; image: string | null;
  author: { username: string | null; name: string };
  likes?: number; comments?: number; liked?: boolean;
};

export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}日前`;
  return new Date(iso).toLocaleDateString('ja-JP');
}

function authHeaders(): Record<string, string> {
  try { const t = localStorage.getItem('token'); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

// 投稿1件の表示。本文はテキストとして表示する（HTMLとしては解釈しない）。
// いいね・返信・共有は、SNSの基本動作として全画面で同じ見た目にする
export default function PostCard({ post, onDelete, detail = false }: { post: PostView; onDelete?: (id: string) => void; detail?: boolean }) {
  const [liked, setLiked] = useState(!!post.liked);
  const [likes, setLikes] = useState(post.likes ?? 0);
  const [note, setNote] = useState('');

  const toggleLike = async () => {
    const h = authHeaders();
    if (!h.Authorization) { setNote('いいねするにはログインしてね'); return; }
    const next = !liked;
    setLiked(next); setLikes((n) => Math.max(0, n + (next ? 1 : -1)));
    const r = await fetch(`/api/posts/${post.id}/like`, { method: next ? 'POST' : 'DELETE', headers: h }).catch(() => null);
    if (!r || !r.ok) { setLiked(!next); setLikes((n) => Math.max(0, n + (next ? -1 : 1))); }
  };
  const share = async () => {
    const url = `${location.origin}/p/${post.id}`;
    try {
      if (navigator.share) await navigator.share({ title: `${post.author.name}の投稿 | AWP`, url });
      else { await navigator.clipboard.writeText(url); setNote('リンクをコピーしました'); setTimeout(() => setNote(''), 2000); }
    } catch { /* キャンセル */ }
  };

  return (
    <article className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
      <header className="flex items-center gap-3">
        <div className="w-9 h-9 shrink-0 rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 text-white font-black flex items-center justify-center text-sm">
          {post.author.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          {post.author.username ? (
            <Link href={`/${post.author.username}`} className="block font-bold text-sm truncate">{post.author.name} <span className="font-normal text-gray-400">@{post.author.username}</span></Link>
          ) : <p className="font-bold text-sm truncate">{post.author.name}</p>}
          <p className="text-[11px] text-gray-400">{ago(post.createdAt)}</p>
        </div>
        {post.mine && onDelete ? (
          <button onClick={() => onDelete(post.id)} className="text-xs text-gray-400 underline">削除</button>
        ) : (
          <ReportButton targetType="post" targetId={post.id} />
        )}
      </header>
      {detail ? (
        <p className="mt-3 text-base leading-relaxed whitespace-pre-wrap break-words">{post.body}</p>
      ) : (
        <Link href={`/p/${post.id}`} className="block mt-3 text-sm leading-relaxed whitespace-pre-wrap break-words">{post.body}</Link>
      )}
      {post.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.image} alt="" loading="lazy" className="mt-3 w-full rounded-xl object-cover max-h-[420px]" />
      )}
      <footer className="mt-3 flex items-center gap-1 text-xs text-gray-500">
        <button onClick={toggleLike} aria-pressed={liked} className={`flex items-center gap-1 rounded-full px-3 py-1.5 ${liked ? 'bg-pink-50 text-pink-600 font-bold' : 'hover:bg-gray-50'}`}>
          <span aria-hidden>{liked ? '♥' : '♡'}</span>{likes > 0 && <span>{likes}</span>}<span className="sr-only">いいね</span>
        </button>
        <Link href={`/p/${post.id}`} className="flex items-center gap-1 rounded-full px-3 py-1.5 hover:bg-gray-50">
          <span aria-hidden>💬</span>{(post.comments ?? 0) > 0 ? <span>{post.comments}</span> : <span>返信</span>}
        </Link>
        <button onClick={share} className="flex items-center gap-1 rounded-full px-3 py-1.5 hover:bg-gray-50"><span aria-hidden>↗</span>共有</button>
        {note && <span className="ml-auto text-[11px] text-violet-700">{note}</span>}
      </footer>
    </article>
  );
}
