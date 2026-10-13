'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import PostCard, { type PostView } from '@/components/community/PostCard';

type Summary = {
  me: { username: string | null; name: string; bio: string | null; category: string | null; region: string | null; links: { label: string; url: string }[]; isAdmin: boolean; followers: number; following: number; postCount: number };
  pages: { slug: string; businessName: string; heroTitle: string; hidden: boolean; views: number; likes: number; image: string | null }[];
  unread: number;
  contribution: { totalPoints: number; last30Points: number; byKind: { kind: string; points: number; count: number }[] };
  posts: PostView[];
};
const KIND_LABEL: Record<string, string> = { post: '投稿', comment: '返信', like_received: 'もらったいいね', follow_received: 'フォローされた', page_published: 'ページを公開', referral: '紹介', order_completed: '注文を完了' };

// マイページ: あなた（プロフィール）が中心。作ったページ・投稿・参加の記録・管理への入口をひとまとめに
export default function MePage() {
  const router = useRouter();
  const [d, setD] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/posts/me/summary').then((r) => setD(r.data)).catch((e) => {
      if (e?.response?.status === 401) router.replace('/login?next=/me'); else setError('読み込めませんでした。');
    });
  }, [router]);

  const removePost = async (id: string) => {
    if (!confirm('この投稿を削除しますか？')) return;
    await api.delete(`/posts/${id}`).catch(() => {});
    setD((prev) => prev ? { ...prev, posts: prev.posts.filter((p) => p.id !== id) } : prev);
  };

  if (!d) return <main className="min-h-screen p-6 text-sm text-gray-500">{error || '読み込み中…'}</main>;
  const m = d.me;

  return (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-sky-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 pt-5 pb-10 space-y-4">
        {/* あなた */}
        <section className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 shrink-0 rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 text-white text-2xl font-black flex items-center justify-center">{m.name.slice(0, 1)}</div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-black truncate">{m.name}</h1>
              {m.username ? <p className="text-sm text-gray-500">@{m.username}</p> : <Link href="/profile" className="text-sm text-violet-700 font-bold underline">ユーザー名を決める →</Link>}
              <p className="text-xs text-gray-600 mt-1 flex gap-3"><span><b>{m.followers}</b> フォロワー</span><span><b>{m.following}</b> フォロー中</span><span><b>{m.postCount}</b> 投稿</span></p>
            </div>
          </div>
          {m.bio && <p className="mt-3 text-sm whitespace-pre-wrap">{m.bio}</p>}
          <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-bold">
            <Link href="/profile" className="rounded-full border py-2 text-center">プロフィールを編集</Link>
            {m.username ? <Link href={`/${m.username}`} className="rounded-full border py-2 text-center">公開ページを見る</Link> : <span className="rounded-full border py-2 text-center text-gray-400">公開ページ</span>}
          </div>
        </section>

        {/* 参加の記録 */}
        <section className="rounded-3xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 text-white p-5">
          <p className="text-xs opacity-90">あなたの参加の記録</p>
          <p className="text-3xl font-black mt-1">{d.contribution.totalPoints}<span className="text-sm font-bold ml-1">pt</span><span className="text-xs font-bold ml-3 opacity-90">この30日 +{d.contribution.last30Points}</span></p>
          <p className="text-xs mt-2 opacity-90">投稿・返信・もらったいいね・フォロー・ページの公開を、事実として記録しています。AWP が生む余剰を参加者に配る仕組み（参加配当）の根拠になります。</p>
          {d.contribution.byKind.length > 0 && (
            <p className="text-[11px] mt-2 opacity-90 flex flex-wrap gap-x-3">{d.contribution.byKind.map((k) => <span key={k.kind}>{KIND_LABEL[k.kind] ?? k.kind} {k.count}</span>)}</p>
          )}
        </section>

        {/* あなたのページ */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-black">あなたのページ <span className="text-gray-400 font-bold text-sm">{d.pages.length}</span></h2>
            <Link href="/create" className="text-xs font-bold text-violet-700">＋ 作る</Link>
          </div>
          {d.pages.length === 0 ? (
            <Link href="/create" className="block bg-white border-2 border-dashed border-violet-300 rounded-2xl p-5 text-center text-sm">
              <span className="block font-bold text-violet-700">はじめてのページを作る</span>
              <span className="block text-xs text-gray-500 mt-1">質問に答えるだけ。公開まで無料</span>
            </Link>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {d.pages.map((p) => (
                <Link key={p.slug} href={`/dashboard?lp=${encodeURIComponent(p.slug)}`} className="bg-white border rounded-2xl overflow-hidden">
                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt="" className="w-full h-24 object-cover" />
                  ) : <div className="w-full h-24 bg-gradient-to-br from-fuchsia-100 to-sky-100" />}
                  <div className="p-3">
                    <p className="font-bold text-sm truncate">{p.businessName}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{p.hidden ? '非公開' : '公開中'}・👀 {p.views}・♥ {p.likes}</p>
                    <p className="text-[11px] text-violet-700 font-bold mt-1">管理する →</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 管理への入口 */}
        <section className="bg-white border rounded-2xl divide-y text-sm">
          {[
            ['/dashboard', 'ページの管理（デザイン・機能・独自ドメイン）'],
            ['/bookings', '予約リクエスト'], ['/orders', '注文'], ['/products', '商品'], ['/analytics', 'アクセス解析'],
            ['/wallet', 'キャッシュと収益化'], ['/plans', 'プラン'],
            ...(m.isAdmin ? [['/admin', '運営者画面']] : [])
          ].map(([href, label]) => (
            <Link key={href} href={href} className="flex items-center justify-between px-4 py-3"><span>{label}</span><span className="text-gray-400">›</span></Link>
          ))}
        </section>

        {/* 自分の投稿 */}
        <section className="space-y-3">
          <h2 className="font-black">あなたの投稿</h2>
          {d.posts.length === 0 ? <p className="text-sm text-gray-500 bg-white rounded-2xl p-5 text-center">まだ投稿はありません。<Link href="/feed" className="text-violet-700 font-bold underline">タイムライン</Link>から投稿できます。</p>
            : d.posts.map((p) => <PostCard key={p.id} post={p} onDelete={removePost} />)}
        </section>

        <p className="text-[11px] text-gray-500 text-center"><Link href="/terms" className="underline">利用規約</Link>・<Link href="/privacy" className="underline">プライバシー</Link>・アカウントの削除とデータの持ち出しはダッシュボードの「データの書き出し」から</p>
      </div>
    </main>
  );
}
