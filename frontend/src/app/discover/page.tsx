'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';

type Card = {
  slug: string; businessName: string; heroTitle: string; purpose: string; likes: number; image: string | null;
  owner: { username: string; name: string } | null;
};

const TABS = [
  { id: 'foryou', label: 'おすすめ' },
  { id: 'new', label: '新着' },
  { id: 'popular', label: '人気' },
  { id: 'following', label: 'フォロー中' }
];
const CATEGORIES = [
  { id: '', label: 'すべて' },
  { id: 'business', label: 'ビジネス' },
  { id: 'creator', label: 'クリエイター' }
];

// 発見: みんなが公開したページを、おすすめ・新着・人気・フォロー中・キーワードで探す
export default function DiscoverPage() {
  const [tab, setTab] = useState('foryou');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [cards, setCards] = useState<Card[] | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    let token = '';
    try { token = localStorage.getItem('token') || ''; } catch { /* 無視 */ }
    const params = new URLSearchParams({ tab, ...(category ? { category } : {}), ...(query ? { q: query } : {}) });
    setCards(null);
    fetch(`/api/community/discover?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.json())
      .then((d) => { setCards(d.pages || []); setNeedsLogin(!!d.needsLogin); })
      .catch(() => setCards([]));
  }, [tab, category, query]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-sky-50 text-gray-900 pb-10">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 pt-3 pb-2">
          <div className="flex items-center justify-between">
            <Link href="/" aria-label="AWP トップ"><Logo size={28} /></Link>
            <span className="flex gap-3">
              <Link href="/feed" className="text-xs font-bold text-violet-700">タイムライン</Link>
              <Link href="/dashboard" className="text-xs font-bold text-violet-700">マイページ</Link>
            </span>
          </div>
          <h1 className="text-2xl font-black mt-2">発見 <span className="text-base">✨</span></h1>
          <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="mt-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" placeholder="お店・活動名・地域で検索"
              className="w-full rounded-full bg-gray-100 px-4 py-2.5 text-base outline-none focus:ring-2 focus:ring-violet-300" />
          </form>
          <div className="mt-2 flex gap-1">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 py-2 text-sm font-bold border-b-2 ${tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4">
        <div className="flex gap-2 py-3 overflow-x-auto">
          {CATEGORIES.map((c) => (
            <button key={c.id} onClick={() => setCategory(c.id)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-bold ${category === c.id ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
              {c.label}
            </button>
          ))}
        </div>

        {cards === null ? (
          <p className="text-center text-sm text-gray-400 py-16">読み込み中…</p>
        ) : needsLogin ? (
          <div className="text-center py-16">
            <p className="text-sm text-gray-600">フォロー中の人のページを見るにはログインしてね</p>
            <Link href="/login" className="inline-block mt-3 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold px-6 py-2.5 text-sm">ログイン</Link>
          </div>
        ) : cards.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-16">
            {tab === 'following' ? 'フォロー中の人のページはまだありません' : query ? `「${query}」に合うページは見つかりませんでした` : 'まだページがありません'}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {cards.map((p) => (
              <div key={p.slug} className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm flex flex-col">
                <Link href={`/${p.slug}`} className="block">
                  <div className="aspect-[4/3] bg-gradient-to-br from-fuchsia-100 via-violet-100 to-sky-100 flex items-center justify-center">
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-2xl font-black text-violet-300">{p.businessName.slice(0, 1)}</span>
                    )}
                  </div>
                  <div className="px-3 pt-2">
                    <p className="font-bold text-sm truncate">{p.businessName}</p>
                    <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{p.heroTitle}</p>
                  </div>
                </Link>
                <div className="px-3 pb-3 pt-1 mt-auto flex items-center justify-between gap-2 text-xs">
                  {p.owner ? (
                    <Link href={`/${p.owner.username}`} className="truncate text-gray-500">@{p.owner.username}</Link>
                  ) : <span />}
                  <span className="text-pink-500 shrink-0">♥ {p.likes}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
