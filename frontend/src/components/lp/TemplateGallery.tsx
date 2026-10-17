'use client';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import api from '@/lib/api';
import { buildTokens } from './LandingView';

type TemplateOption = { key: string; label: string; description: string; bestFor: string; mode: 'light' | 'dark'; defaultAccent: string; design: any };
type Swatch = { hex: string; label: string };

// 見本は訪問者の多くが見るスマホ幅で描き、カードの幅に合わせて縮小する。
// （CSSの scale() には長さを渡せないため、幅を実測して倍率を計算する）
const PREVIEW_WIDTH = 420;

// 見本用の短い見出し（本番は AWP が付ける）。助詞や句読点の手前で切り、言葉が途中で切れないようにする
function shortLabel(s: string) {
  const m = /[、。・がでをにはとへ]/.exec(s.slice(2, 14));
  const cut = m ? 2 + m.index : Math.min(s.length, 12);
  return s.slice(0, cut) || s.slice(0, 12);
}

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

// 「作る前に、自分のページがどう仕上がるか一目でわかる」ための型えらび。
// 入力済みの名前・キャッチコピー・強みと、選んだメインカラーで、12種類の型を実際の部品で描く（AWP呼び出しなし・即時）。
// 同じ型でも色・書体の組み合わせ・写真・文章で店ごとに違う仕上がりになる
export default function TemplateGallery({ businessName, heroTitle, strengths, purpose, value, onChange, accent, onAccent }: {
  businessName: string;
  heroTitle: string;
  strengths: string[];
  purpose?: string;
  value: string | null;
  onChange: (key: string) => void;
  // メインカラー（#rrggbb）。null = 型の既定色（AWPが業種に合わせて選ぶ）
  accent?: string | null;
  onAccent?: (hex: string | null) => void;
}) {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [swatches, setSwatches] = useState<Swatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState(accent ?? '#1e3a8a');

  useEffect(() => {
    let alive = true;
    setLoading(templates.length === 0);
    const t = setTimeout(() => {
      api.post('/lp/templates/preview', { businessName, heroTitle, strengths, accent: accent ?? undefined })
        .then(({ data }) => { if (alive) { setTemplates(data.templates); setSwatches(data.swatches ?? []); } })
        .catch(() => { if (alive) setTemplates([]); })
        .finally(() => { if (alive) setLoading(false); });
    }, 150);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessName, heroTitle, JSON.stringify(strengths), accent]);

  return (
    <div className="space-y-5">
      {onAccent && (
        <section>
          <p className="font-bold text-sm mb-2">メインカラー <span className="text-xs text-gray-500 font-normal">ボタンや見出しの差し色。全部の型がこの色で描かれます</span></p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onAccent(null)}
              className={`h-9 px-3 rounded-full border-2 text-xs font-bold ${accent == null ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-gray-200 bg-white text-gray-600'}`}>
              AWPにまかせる
            </button>
            {swatches.map((sw) => (
              <button key={sw.hex} type="button" onClick={() => onAccent(sw.hex)} aria-label={sw.label} title={sw.label}
                className={`w-9 h-9 rounded-full border-2 ${accent === sw.hex ? 'border-violet-500 ring-2 ring-violet-200' : 'border-white shadow'}`}
                style={{ background: sw.hex }} />
            ))}
            <label className="relative w-9 h-9 rounded-full border-2 border-dashed border-gray-300 overflow-hidden cursor-pointer" title="好きな色を選ぶ"
              style={{ background: accent && !swatches.some((s) => s.hex === accent) ? accent : 'conic-gradient(#f87171,#fbbf24,#34d399,#60a5fa,#a78bfa,#f87171)' }}>
              <input type="color" value={custom} onChange={(e) => { setCustom(e.target.value); onAccent(e.target.value.toLowerCase()); }}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" aria-label="好きな色を選ぶ" />
            </label>
          </div>
        </section>
      )}

      {loading ? <p className="text-gray-400 text-sm py-10 text-center">見本をつくっています…</p> : (
        <div className="grid grid-cols-2 gap-3 sm:gap-5">
          {templates.map((t) => {
            const tokens = buildTokens(t.design);
            // 見本は /preview/style を幅420pxの iframe で描く（大きな画面でもスマホ用のスタイルのまま縮小される）
            const qs = new URLSearchParams({ style: t.key, name: businessName, title: heroTitle, s: strengths.filter(Boolean).join('|'), purpose: purpose ?? 'business', ...(accent ? { accent } : {}) });
            const selected = value === t.key;
            return (
              <button key={t.key} type="button" onClick={() => onChange(t.key)}
                className={`relative text-left rounded-2xl overflow-hidden border-2 transition-all ${selected ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200 hover:border-gray-300'}`}>
                <ScaledPreview background={tokens.p.background}>
                  <iframe src={`/preview/style?${qs.toString()}`} title={`${t.label}の見本`} tabIndex={-1} aria-hidden scrolling="no" loading="lazy"
                    style={{ width: PREVIEW_WIDTH, height: PREVIEW_WIDTH * 1.25, border: 0, pointerEvents: 'none', background: tokens.p.background }} />
                </ScaledPreview>
                {selected && (
                  <span className="absolute top-2 right-2 bg-violet-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow">選択中</span>
                )}
                <div className="p-3 bg-white">
                  <p className="font-bold text-sm flex items-center gap-2">{t.label}<span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.mode === 'dark' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>{t.mode === 'dark' ? 'ダーク' : 'ライト'}</span></p>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{t.description}</p>
                  <p className="text-[10px] text-violet-700 mt-1">向いている用途: {t.bestFor}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
