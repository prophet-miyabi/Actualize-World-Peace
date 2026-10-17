import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { buildTokens, FeatureSection, FeatureStrip, HeroSection, StrengthsSection, TopBar, type Lp } from '@/components/lp/LandingView';

// トップページのスマホ見本の中身（1パターン分）。iframe で幅390pxとして描くことで、
// 親ページが大きな画面でもスマホ用のスタイル（文字の大きさ・1列の並び）で表示される。
// 架空の店・活動の見本であり、検索には載せない
const API = process.env.API_INTERNAL_URL || 'http://localhost:8000/api';

export const metadata: Metadata = { robots: { index: false, follow: false }, title: 'AWP 見本' };

type Item = { key: string; label: string; lp: Lp; imageUrl: string | null };

async function fetchItem(key: string): Promise<Item | null> {
  try {
    const res = await fetch(`${API}/lp/showcase`, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const d = await res.json();
    const it = (d.items as Item[]).find((x) => x.key === key);
    return it ? { ...it, imageUrl: it.imageUrl ? it.imageUrl.replace(/^https?:\/\/[^/]+/, '') : null } : null;
  } catch {
    return null;
  }
}

export default async function ShowcasePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const it = await fetchItem(key);
  if (!it) notFound();
  const tokens = buildTokens(it.lp.design);
  return (
    <div style={{ background: tokens.p.background, color: tokens.p.text, fontFamily: tokens.font.body, minHeight: '100vh', paddingTop: 28 }}>
      <TopBar lp={it.lp} tokens={tokens} />
      <HeroSection lp={it.lp} imageUrl={it.imageUrl} tokens={tokens} />
      <FeatureStrip lp={it.lp} tokens={tokens} />
      <StrengthsSection lp={it.lp} tokens={tokens} />
      {it.lp.sections.map((s, k) => <FeatureSection key={s.feature} section={s} index={k} tokens={tokens} />)}
    </div>
  );
}
