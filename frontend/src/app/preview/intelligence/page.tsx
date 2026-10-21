'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { buildTokens, FeatureSection, FeatureStrip, HeroSection, MobileCtaBar, SiteFooter, StrengthsSection, TopBar, type Design, type Lp } from '@/components/lp/LandingView';

// AWP Page Intelligence の構成案を、本物の部品で描くプレビュー。
// /page/create の中で iframe（幅375 または 1024）として読み込む。クエリ: t=プレビュー用トークン / p=構成案ID / v=再読込用
type Payload = {
  businessName: string; heroTitle: string; strengths: string[]; purpose: string; design: Design; heroImageUrl: string | null;
  sections: { feature: string; content: any }[]; postsIndex: number; lineCta: { heading: string; body: string; cta: { label: string } | null } | null;
};

export default function IntelligencePreviewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const q = useSearchParams();
  const token = q.get('t') || '';
  const proposal = q.get('p') || '';
  const v = q.get('v') || '';
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    let alive = true;
    api.get(`/page-intelligence/preview/${encodeURIComponent(token)}`, { params: proposal ? { proposal } : {} })
      .then(({ data }) => { if (alive) setData(data); })
      .catch(() => { if (alive) setError('プレビューを読み込めませんでした'); });
    return () => { alive = false; };
  }, [token, proposal, v]);

  if (error) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">{error}</div>;
  if (!data) return <div className="min-h-screen bg-gray-50" />;

  const lp: Lp = {
    slug: '', businessName: data.businessName, heroTitle: data.heroTitle, strengths: data.strengths, purpose: data.purpose,
    socialProof: null, scarcityOffer: null, design: data.design, hasImage: !!data.heroImageUrl, imageVersion: 0,
    sections: data.sections, lineAddUrl: data.lineCta ? 'https://lin.ee/' : null
  };
  const tokens = buildTokens(lp.design);
  const posts = data.postsIndex >= 0 ? (
    <section className="px-6 py-14" style={{ background: tokens.p.surface }}>
      <div className="max-w-3xl mx-auto">
        <p style={{ color: tokens.p.primary }} className="text-xs font-bold tracking-widest mb-2">POSTS</p>
        <p style={tokens.headingStyle} className="text-xl mb-4">最近の投稿</p>
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="aspect-square" style={{ background: tokens.alpha(tokens.p.primary, 0.12), borderRadius: tokens.r.box }} />)}
        </div>
        <p className="text-xs mt-3" style={{ color: tokens.muted }}>AWP で投稿すると、ここに自動で並びます（投稿ごとに外せます）</p>
      </div>
    </section>
  ) : null;
  // 投稿ブロックの位置: 構成案で上の方にあれば強みの直後、そうでなければ最後の CTA の前
  const postsTop = data.postsIndex >= 0 && data.postsIndex <= 3;

  return (
    <div style={{ background: tokens.p.background, color: tokens.p.text, fontFamily: tokens.font.body, minHeight: '100vh' }}>
      <TopBar lp={lp} tokens={tokens} />
      <HeroSection lp={lp} imageUrl={data.heroImageUrl} tokens={tokens} />
      <FeatureStrip lp={lp} tokens={tokens} />
      <StrengthsSection lp={lp} tokens={tokens} />
      {postsTop && posts}
      {data.sections.map((s, i) => <FeatureSection key={s.feature} section={s} index={i} tokens={tokens} />)}
      {!postsTop && posts}
      {data.lineCta && (
        <section className="px-6 py-20 text-center" style={{ background: tokens.p.text, color: tokens.p.background }}>
          <div className="max-w-2xl mx-auto">
            <h2 style={{ ...tokens.headingStyle, color: tokens.p.background }} className="text-2xl sm:text-4xl mb-5">{data.lineCta.heading || 'お気軽にご相談ください'}</h2>
            {data.lineCta.body && <p className="mb-8 opacity-80 leading-relaxed">{data.lineCta.body}</p>}
            <span style={{ ...tokens.ctaStyle, background: '#06C755', color: '#fff' }} className="inline-block px-10 py-5 font-bold text-lg shadow-lg">{data.lineCta.cta?.label || 'LINEで相談'}</span>
          </div>
        </section>
      )}
      <SiteFooter lp={lp} tokens={tokens} />
      <MobileCtaBar lp={lp} tokens={tokens} />
    </div>
  );
}
