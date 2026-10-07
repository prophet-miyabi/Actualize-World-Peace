import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import LandingView, { buildTokens, HeroSection, StrengthsSection, ToolsSection, LineCtaSection, SiteFooter, SiteNav, type Lp } from '@/components/lp/LandingView';
import PageEngagementBar from '@/components/community/PageEngagementBar';
import PromotionBlock from '@/components/community/PromotionBlock';
import ProductsSection, { type PublicProduct } from '@/components/modules/ProductsSection';
import BookingWidget from '@/components/modules/BookingWidget';
import PageChatbot from '@/components/modules/PageChatbot';
import ProfileView, { type Profile } from '@/components/community/ProfileView';

// SEO: 顧客の公開ページはサーバー側でデータを取得して描画する（クライアント側fetchだと
// 検索エンジン・SNSのクローラーには中身が空のページに見えてしまうため）
const API = process.env.API_INTERNAL_URL || 'http://localhost:8000/api';
const SITE_URL = process.env.SITE_URL || '';

type PublicLp = Lp & {
  owner: { username: string; name: string } | null;
  promotions?: { key: string; name: string; description: string }[];
  products?: PublicProduct[];
  booking?: { menus: { name: string; note: string }[]; note: string; leadDays: number; maxDays: number } | null;
  chatbotEnabled?: boolean;
};

async function fetchLp(slug: string): Promise<PublicLp | null> {
  try {
    const res = await fetch(`${API}/lp/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ページのURLとプロフィールのURL（/ユーザー名）は同じ場所を共有する。ページがなければプロフィールを探す
async function fetchProfile(username: string): Promise<Profile | null> {
  try {
    const res = await fetch(`${API}/community/profiles/${encodeURIComponent(username)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).profile;
  } catch {
    return null;
  }
}

// アクセス元のドメイン（共有URL／独自ドメインどちらでも、実際に見えているURLに合わせる）
async function currentOrigin() {
  const h = await headers();
  const host = h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const lp = await fetchLp(slug);
  if (!lp) {
    const profile = await fetchProfile(slug);
    if (!profile) return { title: 'ページが見つかりません', robots: { index: false, follow: false } };
    const origin = await currentOrigin();
    const description = (profile.bio || `${profile.name}さんのプロフィール`).slice(0, 155);
    return {
      title: `${profile.name}（@${profile.username}） | AWP`,
      description,
      alternates: { canonical: `${origin}/${profile.username}` },
      openGraph: { title: `${profile.name}（@${profile.username}）`, description, type: 'profile', url: `${origin}/${profile.username}`, locale: 'ja_JP' },
      twitter: { card: 'summary', title: profile.name, description }
    };
  }

  const origin = await currentOrigin();
  const description = [lp.heroTitle, ...lp.strengths.filter(Boolean)].join(' / ').slice(0, 155);
  const imageUrl = lp.hasImage ? `${origin}/api/lp/${encodeURIComponent(lp.slug)}/image?v=${lp.imageVersion}` : undefined;
  const canonical = `${origin}/${lp.slug}`;

  return {
    title: `${lp.businessName} | ${lp.heroTitle}`,
    description,
    alternates: { canonical },
    openGraph: {
      title: lp.businessName,
      description,
      type: 'website',
      url: canonical,
      locale: 'ja_JP',
      images: imageUrl ? [imageUrl] : undefined
    },
    twitter: {
      card: imageUrl ? 'summary_large_image' : 'summary',
      title: lp.businessName,
      description,
      images: imageUrl ? [imageUrl] : undefined
    }
  };
}

export default async function LandingPage({ params }: Params) {
  const { slug } = await params;
  const lp = await fetchLp(slug);
  if (!lp) {
    const profile = await fetchProfile(slug);
    if (!profile) notFound();
    return <ProfileView profile={profile} />;
  }
  const siteUrl = SITE_URL || (await currentOrigin());
  const { p: palette } = buildTokens(lp.design);
  // 持ち主が追加した機能（商品・予約リクエスト・AIチャットボット）
  const modules = (
    <>
      <ProductsSection lp={lp} products={lp.products ?? []} />
      {lp.booking && (
        <BookingWidget slug={lp.slug} businessName={lp.businessName} config={lp.booking} primary={palette.primary} onPrimary={palette.onPrimary} siteUrl={siteUrl} />
      )}
      {lp.chatbotEnabled && <PageChatbot slug={lp.slug} businessName={lp.businessName} primary={palette.primary} onPrimary={palette.onPrimary} />}
    </>
  );
  const engagement = (
    <>
      <PromotionBlock slug={lp.slug} items={lp.promotions ?? []} />
      <PageEngagementBar slug={lp.slug} owner={lp.owner} siteUrl={siteUrl} />
    </>
  );

  // 画像は版数付きURLで配信し、デザインを作り直したときだけ新しい画像を読み込む
  const imageUrl = lp.hasImage ? `/api/lp/${encodeURIComponent(lp.slug)}/image?v=${lp.imageVersion}` : null;

  // 検索結果でお店の情報として認識されやすくするための構造化データ
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: lp.businessName,
    description: [lp.heroTitle, ...lp.strengths.filter(Boolean)].join('。'),
    ...(imageUrl ? { image: imageUrl } : {})
  };
  const jsonLdScript = (
    // eslint-disable-next-line react/no-danger
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
  );

  // hp = 複数ページ。ホームにはヒーローと強みだけを置き、機能ごとの内容は専用ページに分ける
  if (lp.siteType === 'hp' && lp.sections.length > 0) {
    const tokens = buildTokens(lp.design);
    return (
      <>
        {jsonLdScript}
        <div style={{ background: tokens.p.background, color: tokens.p.text, fontFamily: tokens.font.body }} className="min-h-screen">
          <SiteNav lp={lp} tokens={tokens} current="" />
          <HeroSection lp={lp} imageUrl={imageUrl} tokens={tokens} />
          <StrengthsSection lp={lp} tokens={tokens} />
          <ToolsSection lp={lp} tokens={tokens} />
          <LineCtaSection lp={lp} tokens={tokens} />
          {modules}
          <SiteFooter lp={lp} tokens={tokens} />
          {engagement}
        </div>
      </>
    );
  }

  return (
    <>
      {jsonLdScript}
      <LandingView lp={lp} imageUrl={imageUrl} extra={modules} />
      {engagement}
    </>
  );
}
