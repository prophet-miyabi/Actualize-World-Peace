'use client';
import { useEffect, useState } from 'react';
import PostCard, { type PostView } from './PostCard';

// プロフィールの投稿一覧（本人なら削除ボタンが出るよう、ログイン情報付きで画面側から取得する）
export default function ProfilePosts({ username }: { username: string }) {
  const [posts, setPosts] = useState<PostView[] | null>(null);

  const auth = (): Record<string, string> => {
    try {
      const t = localStorage.getItem('token');
      return t ? { Authorization: `Bearer ${t}` } : {};
    } catch {
      return {};
    }
  };

  useEffect(() => {
    fetch(`/api/posts/user/${encodeURIComponent(username)}`, { headers: auth() })
      .then((r) => r.json()).then((d) => setPosts(d.posts || [])).catch(() => setPosts([]));
  }, [username]);

  const remove = async (id: string) => {
    if (!confirm('この投稿を削除しますか？')) return;
    const r = await fetch(`/api/posts/${id}`, { method: 'DELETE', headers: auth() });
    if (r.ok) setPosts((prev) => (prev ?? []).filter((p) => p.id !== id));
  };

  if (!posts || posts.length === 0) return null;
  return (
    <section className="max-w-2xl mx-auto px-4 pb-6">
      <h2 className="font-black mb-3">投稿</h2>
      <div className="space-y-3">{posts.map((p) => <PostCard key={p.id} post={p} onDelete={remove} />)}</div>
    </section>
  );
}
