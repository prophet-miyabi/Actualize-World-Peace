'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { buildTokens, FeatureStrip, HeroSection, StrengthsSection, TopBar, type Design, type Lp } from '@/components/lp/LandingView';

// 型えらび（TemplateGallery）の見本1枚分。iframe で幅420pxとして描くことで、
// 大きな画面でもスマホ用のスタイル（文字の大きさ・1列の並び）のまま縮小表示できる。
// クエリ: style / accent / name / title / s（強み、| 区切り） / purpose
export default function StylePreviewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <Inner />
    </Suspense>
  );
}

function shortLabel(s: string) {
  const m = /[、。・がでをにはとへ]/.exec(s.slice(2, 14));
  const cut = m ? 2 + m.index : Math.min(s.length, 12);
  return s.slice(0, cut) || s.slice(0, 12);
}

function Inner() {
  const q = useSearchParams();
  const style = q.get('style') || 'minimal';
  const accent = q.get('accent') || '';
  const businessName = q.get('name') || '店舗名';
  const heroTitle = q.get('title') || 'お客様に選ばれる理由がここにあります';
  const strengths = (q.get('s') || '').split('|').map((x) => x.trim()).filter(Boolean);
  const purpose = q.get('purpose') || 'business';
  const [design, setDesign] = useState<Design | null>(null);

  useEffect(() => {
    let alive = true;
    api.post('/lp/templates/preview', { businessName, heroTitle, strengths, accent: accent || undefined })
      .then(({ data }) => { if (!alive) return; const t = (data.templates as { key: string; design: Design }[]).find((x) => x.key === style) ?? data.templates[0]; setDesign(t?.design ?? null); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style, accent, businessName, heroTitle, q.get('s')]);

  if (!design) return <div className="min-h-screen bg-gray-50" />;
  const s3 = strengths.length ? strengths : ['強み1', '強み2', '強み3'];
  const lp: Lp = {
    slug: '', businessName, heroTitle, strengths: s3, purpose, socialProof: null, scarcityOffer: null,
    design: { ...design, copy: { ...(design.copy ?? {}), strengthLabels: s3.map(shortLabel) } },
    hasImage: false, imageVersion: 0, sections: []
  };
  const tokens = buildTokens(lp.design);
  return (
    <div style={{ background: tokens.p.background, color: tokens.p.text, fontFamily: tokens.font.body, minHeight: '100vh' }}>
      <TopBar lp={lp} tokens={tokens} />
      <HeroSection lp={lp} imageUrl={null} tokens={tokens} />
      <FeatureStrip lp={lp} tokens={tokens} />
      <StrengthsSection lp={lp} tokens={tokens} />
    </div>
  );
}
