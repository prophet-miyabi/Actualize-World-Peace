import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { buildTokens, FeatureSection, LineCtaSection, SiteFooter, SiteNav, FEATURE_LABELS, type Lp } from '@/components/lp/LandingView';

const API = process.env.API_INTERNAL_URL || 'http://localhost:8000/api';

async function fetchLp(slug: string): Promise<Lp | null> {
  try {
    const res = await fetch(`${API}/lp/${encodeURIComponent(slug)}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function currentOrigin() {
  const h = await headers();
  const host = h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

type Params = { params: Promise<{ slug: string; page: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, page } = await params;
  const lp = await fetchLp(slug);
  const section = lp?.sections.find((s) => s.feature === page);
  if (!lp || lp.siteType !== 'hp' || !section) return { title: 'ページが見つかりません', robots: { index: false, follow: false } };

  const origin = await currentOrigin();
  const label = FEATURE_LABELS[page] || page;
  const title = `${lp.businessName} | ${label}`;
  const description = `${lp.businessName}の${label}のご案内。${lp.heroTitle}`.slice(0, 155);
  const canonical = `${origin}/${lp.slug}/${page}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: 'website', url: canonical, locale: 'ja_JP' },
    twitter: { card: 'summary', title, description }
  };
}

// HP（複数ページ）モードで、機能ごとの内容だけを表示する専用ページ
export default async function LandingFeaturePage({ params }: Params) {
  const { slug, page } = await params;
  const lp = await fetchLp(slug);
  const section = lp?.sections.find((s) => s.feature === page);
  if (!lp || lp.siteType !== 'hp' || !section) notFound();

  const tokens = buildTokens(lp.design);
  return (
    <div style={{ background: tokens.p.background, color: tokens.p.text, fontFamily: tokens.font.body }} className="min-h-screen">
      <SiteNav lp={lp} tokens={tokens} current={page} />
      <header className="px-6 pt-14 pb-4 text-center">
        <p style={{ color: tokens.p.primary }} className="font-bold tracking-widest text-sm mb-2">{lp.businessName}</p>
        <h1 style={tokens.headingStyle} className="text-2xl sm:text-3xl">{FEATURE_LABELS[page] || page}</h1>
      </header>
      <FeatureSection section={section} index={0} tokens={tokens} />
      <LineCtaSection lp={lp} tokens={tokens} />
      <SiteFooter lp={lp} tokens={tokens} />
    </div>
  );
}
