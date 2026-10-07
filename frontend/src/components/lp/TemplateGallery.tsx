'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import api from '@/lib/api';
import { buildTokens, HeroSection, StrengthsSection, type Lp } from './LandingView';

type TemplateOption = { key: string; label: string; description: string; design: any };

// 見本は訪問者の多くが見るスマホ幅で描き、カードの幅に合わせて縮小する。
// （CSSの scale() には長さを渡せないため、幅を実測して倍率を計算する）
const PREVIEW_WIDTH = 420;

function ScaledPreview({ background, children }: { background: string; children: ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / PREVIEW_WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="relative w-full aspect-[4/5] overflow-hidden" style={{ background }}>
      {scale > 0 && (
        <div style={{ width: PREVIEW_WIDTH, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// 「作る前に、自分のページがどう仕上がるか一目でわかる」ためのギャラリー。
// 入力済みの名前・キャッチコピー・強みをそのまま使い、実際の見本デザインで見せる（AI呼び出しなし・即時）。
export default function TemplateGallery({ businessName, heroTitle, strengths, purpose, value, onChange }: {
  businessName: string;
  heroTitle: string;
  strengths: string[];
  purpose?: string;
  value: string | null;
  onChange: (key: string) => void;
}) {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.post('/lp/templates/preview', { businessName, heroTitle, strengths })
      .then(({ data }) => { if (alive) setTemplates(data.templates); })
      .catch(() => { if (alive) setTemplates([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessName, heroTitle, JSON.stringify(strengths)]);

  if (loading) return <p className="text-gray-400 text-sm py-10 text-center">見本をつくっています…</p>;

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5">
      {templates.map((t) => {
        const tokens = buildTokens(t.design);
        const previewLp: Lp = {
          slug: '', businessName, heroTitle, strengths, purpose,
          socialProof: null, scarcityOffer: null,
          design: t.design, hasImage: false, imageVersion: 0, sections: []
        };
        const selected = value === t.key;
        return (
          <button key={t.key} type="button" onClick={() => onChange(t.key)}
            className={`relative text-left rounded-2xl overflow-hidden border-2 transition-all ${selected ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200 hover:border-gray-300'}`}>
            <ScaledPreview background={tokens.p.background}>
              <HeroSection lp={previewLp} imageUrl={null} tokens={tokens} />
              <StrengthsSection lp={previewLp} tokens={tokens} />
            </ScaledPreview>
            {selected && (
              <span className="absolute top-2 right-2 bg-violet-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow">選択中</span>
            )}
            <div className="p-3 bg-white">
              <p className="font-bold text-sm">{t.label}</p>
              <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{t.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
