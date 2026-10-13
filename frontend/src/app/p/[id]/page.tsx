'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import PostCard, { ago, type PostView } from '@/components/community/PostCard';

type C = { id: string; body: string; createdAt: string; mine: boolean; author: { username: string | null; name: string } };

function authHeaders(): Record<string, string> {
  try { const t = localStorage.getItem('token'); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

// 投稿の詳細: 本文と返信。返信はログインしていれば書ける
export default function PostDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<PostView | null | undefined>(undefined);
  const [comments, setComments] = useState<C[]>([]);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signedIn = typeof window !== 'undefined' && !!authHeaders().Authorization;

  useEffect(() => {
    fetch(`/api/posts/${id}`, { headers: authHeaders() }).then(async (r) => {
      if (!r.ok) { setPost(null); return; }
      const d = await r.json();
      setPost(d.post); setComments(d.comments);
    }).catch(() => setPost(null));
  }, [id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/posts/${id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || '返信できませんでした');
      setComments((prev) => [...prev, d.comment]);
      setBody('');
      setPost((p) => p ? { ...p, comments: (p.comments ?? 0) + 1 } : p);
    } catch (err: any) { setError(err?.message || '返信できませんでした'); } finally { setBusy(false); }
  };
  const remove = async (cid: string) => {
    if (!confirm('この返信を削除しますか？')) return;
    const r = await fetch(`/api/posts/comments/${cid}`, { method: 'DELETE', headers: authHeaders() });
    if (r.ok) setComments((prev) => prev.filter((c) => c.id !== cid));
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-sky-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 pt-4 pb-32 space-y-3">
        <Link href="/feed" className="text-sm text-violet-700 font-bold">← タイムライン</Link>
        {post === undefined ? <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>
          : post === null ? <p className="text-sm text-gray-500 py-10 text-center">この投稿は見つかりません（削除されたか、非公開です）</p>
          : (
            <>
              <PostCard post={post} detail />
              <h2 className="font-black text-sm pt-2">返信 <span className="text-gray-400 font-bold">{comments.length}</span></h2>
              {comments.length === 0 && <p className="text-sm text-gray-500 bg-white rounded-2xl p-4 text-center">まだ返信はありません。最初の一言をどうぞ</p>}
              {comments.map((c) => (
                <div key={c.id} className="bg-white border border-gray-100 rounded-2xl p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 shrink-0 rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 text-white font-black flex items-center justify-center text-xs">{c.author.name.slice(0, 1)}</div>
                    {c.author.username ? <Link href={`/${c.author.username}`} className="text-sm font-bold truncate">{c.author.name} <span className="font-normal text-gray-400">@{c.author.username}</span></Link> : <span className="text-sm font-bold">{c.author.name}</span>}
                    <span className="text-[11px] text-gray-400 ml-auto">{ago(c.createdAt)}</span>
                    {(c.mine || post.mine) && <button onClick={() => remove(c.id)} className="text-[11px] text-gray-400 underline">削除</button>}
                  </div>
                  <p className="mt-2 text-sm whitespace-pre-wrap break-words">{c.body}</p>
                </div>
              ))}
            </>
          )}
      </div>
      {post && (
        <form onSubmit={submit} className="fixed bottom-20 md:bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t px-4 py-3">
          <div className="max-w-xl mx-auto">
            {error && <p className="text-xs text-red-600 mb-1">{error}{error.includes('ユーザー名') && <> <Link href="/profile" className="underline font-bold">プロフィールへ</Link></>}</p>}
            {signedIn ? (
              <div className="flex gap-2">
                <input value={body} onChange={(e) => setBody(e.target.value)} maxLength={300} placeholder="返信を書く" className="flex-1 border rounded-full px-4 py-2 text-base" />
                <button disabled={busy || !body.trim()} className="rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white text-sm font-bold px-4 disabled:opacity-40">送る</button>
              </div>
            ) : <p className="text-sm text-center"><Link href={`/login?next=/p/${id}`} className="font-bold text-violet-700 underline">ログイン</Link>すると返信できるよ</p>}
          </div>
        </form>
      )}
    </main>
  );
}
