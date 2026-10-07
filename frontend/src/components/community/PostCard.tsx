'use client';
import Link from 'next/link';
import ReportButton from './ReportButton';

export type PostView = {
  id: string; body: string; createdAt: string; mine: boolean; image: string | null;
  author: { username: string | null; name: string };
};

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}日前`;
  return new Date(iso).toLocaleDateString('ja-JP');
}

// 投稿1件の表示。本文はテキストとして表示する（HTMLとしては解釈しない）
export default function PostCard({ post, onDelete }: { post: PostView; onDelete?: (id: string) => void }) {
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
      <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap break-words">{post.body}</p>
      {post.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.image} alt="" loading="lazy" className="mt-3 w-full rounded-xl object-cover max-h-[420px]" />
      )}
    </article>
  );
}
