import Link from 'next/link';
import Logo from '@/components/Logo';
import FollowButton from './FollowButton';
import ReportButton from './ReportButton';
import ProfilePosts from './ProfilePosts';

export type Profile = {
  username: string;
  name: string;
  bio: string | null;
  category: string | null;
  region: string | null;
  links: { label: string; url: string }[];
  followers: number;
  following: number;
  pages: { slug: string; businessName: string; heroTitle: string; purpose: string; likes: number; image: string | null }[];
};

const CATEGORY_LABEL: Record<string, string> = { business: 'ビジネス', creator: 'クリエイター', other: 'その他' };

// 公開プロフィール（/ユーザー名）。作ったページ・リンク・フォローをひとまとめに見せる
export default function ProfileView({ profile }: { profile: Profile }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-sky-50 text-gray-900">
      <header className="px-4 py-3 flex items-center justify-between max-w-2xl mx-auto">
        <Link href="/" aria-label="AWP トップ"><Logo size={28} /></Link>
        <Link href="/discover" className="text-sm font-bold text-violet-700">みんなのページを見る →</Link>
      </header>

      <section className="max-w-2xl mx-auto px-4 pt-4">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 shrink-0 rounded-full bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 text-white text-2xl font-black flex items-center justify-center">
              {profile.name.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black truncate">{profile.name}</h1>
              <p className="text-sm text-gray-500">@{profile.username}</p>
              <p className="text-xs text-gray-500 mt-1 flex flex-wrap gap-2">
                {profile.category && <span className="rounded-full bg-violet-50 text-violet-700 font-bold px-2 py-0.5">{CATEGORY_LABEL[profile.category] || profile.category}</span>}
                {profile.region && <span>📍 {profile.region}</span>}
              </p>
            </div>
          </div>
          {profile.bio && <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap">{profile.bio}</p>}
          {profile.links.length > 0 && (
            <ul className="mt-4 grid gap-2">
              {profile.links.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer nofollow ugc"
                    className="block rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-center hover:bg-gray-50">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <FollowButton username={profile.username} initialFollowers={profile.followers} />
          </div>
        </div>
      </section>

      <section className="max-w-2xl mx-auto px-4 py-6">
        <h2 className="font-black mb-3">ページ <span className="text-gray-400 font-bold text-sm">{profile.pages.length}</span></h2>
        {profile.pages.length === 0 ? (
          <p className="text-sm text-gray-500 bg-white rounded-2xl p-5 text-center">まだ公開中のページはありません</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {profile.pages.map((p) => (
              <Link key={p.slug} href={`/${p.slug}`} className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
                <div className="aspect-[4/3] bg-gradient-to-br from-fuchsia-100 via-violet-100 to-sky-100">
                  {p.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt="" loading="lazy" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="p-3">
                  <p className="font-bold text-sm truncate">{p.businessName}</p>
                  <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{p.heroTitle}</p>
                  <p className="text-xs text-pink-500 mt-1">♥ {p.likes}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <ProfilePosts username={profile.username} />

      <footer className="max-w-2xl mx-auto px-4 pb-10 flex items-center justify-between text-xs text-gray-400">
        <span>Made with <Link href="/" className="underline">AWP</Link></span>
        <ReportButton targetType="profile" targetId={profile.username} />
      </footer>
    </main>
  );
}
