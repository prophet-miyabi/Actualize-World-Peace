'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import LandingView, { buildTokens, HeroSection, StrengthsSection, LineCtaSection, SiteFooter, SiteNav, type Lp } from '@/components/lp/LandingView';

// 支払い前の無料お試し中でも、本人だけが自分のLP/HPの仕上がりを確認できるプレビュー画面
// （公開URLではなく、ログインした本人のデータをそのまま描画する）
export default function DashboardPreview() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <DashboardPreviewInner />
    </Suspense>
  );
}

function DashboardPreviewInner() {
  const searchParams = useSearchParams();
  const lpId = searchParams.get('lp') || '';
  const [lp, setLp] = useState<Lp | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const params = lpId ? { lpId } : {};
    api.get('/lp/dashboard/stats', { params }).then(({ data }) => {
      if (!data.lp) { setNotFound(true); return; }
      setLp(data.lp);
      if (data.lp.hasImage) {
        api.get('/lp/preview/image', { params, responseType: 'blob' })
          .then(({ data: blob }) => setImageUrl(URL.createObjectURL(blob)))
          .catch(() => {});
      }
    }).catch(() => setNotFound(true));
  }, [lpId]);

  if (notFound) return <div className="text-center p-20 text-xl font-bold">まだページが作成されていません。</div>;
  if (!lp) return <div className="min-h-screen" />;

  const isHp = lp.siteType === 'hp' && lp.sections.length > 0;
  const tokens = buildTokens(lp.design);

  return (
    <div>
      <div className="bg-blue-600 text-white text-sm px-4 py-3 flex flex-wrap items-center justify-center gap-3 text-center">
        <span>これはプレビューです。実際の公開URLではありません。</span>
        <Link href="/billing" className="bg-white text-blue-700 px-3 py-1 rounded-full font-bold whitespace-nowrap">
          このページを公開する →
        </Link>
      </div>
      {isHp ? (
        <div style={{ background: tokens.p.background, color: tokens.p.text, fontFamily: tokens.font.body }} className="min-h-screen">
          <SiteNav lp={lp} tokens={tokens} current="" />
          <HeroSection lp={lp} imageUrl={imageUrl} tokens={tokens} />
          <StrengthsSection lp={lp} tokens={tokens} />
          <LineCtaSection lp={lp} tokens={tokens} />
          <SiteFooter lp={lp} tokens={tokens} />
        </div>
      ) : (
        <LandingView lp={lp} imageUrl={imageUrl} />
      )}
    </div>
  );
}
