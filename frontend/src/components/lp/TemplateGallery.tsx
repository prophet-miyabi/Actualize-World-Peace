'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { buildTokens, HeroSection, StrengthsSection, type Lp } from './LandingView';

type TemplateOption = { key: string; label: string; description: string; design: any };

// 「作る前に、自分のLPがどう仕上がるか一目でわかる」ためのギャラリー。
// 入力済みの店名・キャッチコピー・強みをそのまま使い、実際の見本デザインで見せる（AI呼び出しなし・即時）。
export default function TemplateGallery({ businessName, heroTitle, strengths, value, onChange }: {
  businessName: string;
  heroTitle: string;
  strengths: string[];
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

  if (loading) return <p className="text-gray-400 text-sm py-10 text-center">見本を作成しています…</p>;

  return (
    <div className="grid sm:grid-cols-2 gap-5">
      {templates.map((t) => {
        const tokens = buildTokens(t.design);
        const previewLp: Lp = {
          slug: '', businessName, heroTitle, strengths,
          socialProof: null, scarcityOffer: null,
          design: t.design, hasImage: false, imageVersion: 0, sections: []
        };
        const selected = value === t.key;
        return (
          <button key={t.key} type="button" onClick={() => onChange(t.key)}
            className={`text-left rounded-2xl overflow-hidden border-2 transition-all ${selected ? 'border-blue-600 ring-2 ring-blue-200' : 'border-gray-200 hover:border-gray-300'}`}>
            <div className="relative w-full aspect-[4/3] overflow-hidden" style={{ background: tokens.p.background, containerType: 'inline-size' } as any}>
              <div style={{ width: '1000px', transform: 'scale(calc(100cqw / 1000))', transformOrigin: 'top left', pointerEvents: 'none' } as any}>
                <HeroSection lp={previewLp} imageUrl={null} tokens={tokens} />
                <StrengthsSection lp={previewLp} tokens={tokens} />
              </div>
              {selected && (
                <span className="absolute top-3 right-3 bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow">選択中</span>
              )}
            </div>
            <div className="p-4 bg-white">
              <p className="font-bold">{t.label}</p>
              <p className="text-xs text-gray-500 mt-1">{t.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
