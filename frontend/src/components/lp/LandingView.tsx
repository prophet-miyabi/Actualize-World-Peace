import type { CSSProperties, ReactNode } from 'react';
import { LineFriendAddLink } from './LineFriendAddLink';

// 公開LPの表示。AIが決めたデザイン（配色・書体・角丸・レイアウト）の値だけで見た目を組み立てる。
// AIの出力をHTMLとして埋め込むことはせず、すべて文字として表示する（不正なスクリプトが入り込まない）。
//
// LP（1ページ）とHP（複数ページ）の両方で同じ部品（ヒーロー・強み・機能セクション・LINE導線・フッター）を
// 使い回せるよう、各部品を関数として個別にexportしている。LandingViewはそれらを1ページに並べただけのもの。

export type Design = {
  palette: { primary: string; onPrimary: string; background: string; surface: string; text: string };
  font: 'modern' | 'elegant' | 'friendly' | 'bold';
  corner: 'sharp' | 'soft' | 'round';
  heroLayout: 'centered' | 'split' | 'imageBackground';
  strengthsStyle: 'cards' | 'numbered' | 'minimal';
  heroOverlay?: 'none' | 'light' | 'medium' | 'strong';
};

export type Lp = {
  slug: string;
  businessName: string;
  heroTitle: string;
  strengths: string[];
  socialProof: string | null;
  scarcityOffer: string | null;
  siteType?: string;
  design: Design;
  hasImage: boolean;
  imageVersion: number;
  sections: { feature: string; content: any }[];
  // A/Bテストで選ばれたバリエーションのID。テスト未実施ならnull（バックエンドがすでにheroTitleへ反映済み）
  variantId?: string | null;
  // ユーザーが追加した外部ツール（予約・ネットショップ・フォーム等）。URLはサーバー側で許可済みのhttpsホストのみ
  tools?: { label: string; url: string; display: string }[];
};

const FONT_FAMILY: Record<Design['font'], { body: string; heading: string; headingWeight: number }> = {
  modern: { body: 'var(--font-sans-jp)', heading: 'var(--font-sans-jp)', headingWeight: 700 },
  elegant: { body: 'var(--font-serif-jp)', heading: 'var(--font-serif-jp)', headingWeight: 600 },
  friendly: { body: 'var(--font-rounded-jp)', heading: 'var(--font-rounded-jp)', headingWeight: 800 },
  bold: { body: 'var(--font-sans-jp)', heading: 'var(--font-sans-jp)', headingWeight: 900 }
};
const RADIUS: Record<Design['corner'], { box: string; button: string }> = {
  sharp: { box: '4px', button: '4px' },
  soft: { box: '14px', button: '12px' },
  round: { box: '28px', button: '9999px' }
};
const OVERLAY: Record<NonNullable<Design['heroOverlay']>, number> = { none: 0, light: 0.25, medium: 0.45, strong: 0.62 };

// #RRGGBB に透明度を付ける
function alpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

export function buildTokens(design: Design) {
  const p = design.palette;
  const font = FONT_FAMILY[design.font] ?? FONT_FAMILY.modern;
  const r = RADIUS[design.corner] ?? RADIUS.soft;
  const headingStyle: CSSProperties = { fontFamily: font.heading, fontWeight: font.headingWeight, letterSpacing: '0.02em' };
  const boxStyle: CSSProperties = { background: p.surface, borderRadius: r.box, border: `1px solid ${alpha(p.text, 0.08)}` };
  const ctaStyle: CSSProperties = { background: p.primary, color: p.onPrimary, borderRadius: r.button };
  const muted = alpha(p.text, 0.72);
  return { d: design, p, font, r, headingStyle, boxStyle, ctaStyle, muted, alpha };
}
export type Tokens = ReturnType<typeof buildTokens>;

function SectionWrap({ tokens, children, tint = false, id }: { tokens: Tokens; children: ReactNode; tint?: boolean; id?: string }) {
  return (
    <section id={id} style={{ background: tint ? alpha(tokens.p.primary, 0.05) : 'transparent' }} className="px-6 py-16 sm:py-24">
      <div className="max-w-5xl mx-auto">{children}</div>
    </section>
  );
}
function HeadingBlock({ tokens, children }: { tokens: Tokens; children: ReactNode }) {
  return (
    <h2 style={tokens.headingStyle} className="text-2xl sm:text-3xl text-center mb-10 sm:mb-14">
      {children}
      <span aria-hidden style={{ background: tokens.p.primary }} className="block w-10 h-1 mx-auto mt-4 rounded-full" />
    </h2>
  );
}
function CtaLink({ tokens, large = false }: { tokens: Tokens; large?: boolean }) {
  return (
    <a href="#line" style={tokens.ctaStyle}
      className={`inline-block font-bold shadow-lg transition-transform hover:-translate-y-0.5 ${large ? 'px-10 py-5 text-lg' : 'px-8 py-4'}`}>
      LINEで無料相談する
    </a>
  );
}

// ---- ヒーロー（3種類のレイアウト） ----
export function HeroSection({ lp, imageUrl, tokens }: { lp: Lp; imageUrl: string | null; tokens: Tokens }) {
  const { d, p, headingStyle, r } = tokens;
  const heroText = (onDark: boolean) => (
    <>
      <p style={{ color: onDark ? 'rgba(255,255,255,0.85)' : p.primary }} className="font-bold tracking-widest text-sm mb-4">{lp.businessName}</p>
      <h1 style={{ ...headingStyle, color: onDark ? '#ffffff' : p.text }} className="text-3xl sm:text-5xl leading-tight mb-8 whitespace-pre-line">{lp.heroTitle}</h1>
      {lp.socialProof && (
        <p style={{ color: onDark ? '#ffffff' : p.text, background: onDark ? 'rgba(255,255,255,0.14)' : alpha(p.primary, 0.08), borderRadius: r.button }}
          className="inline-block px-5 py-2 text-sm font-bold mb-8">{lp.socialProof}</p>
      )}
      <div><CtaLink tokens={tokens} large /></div>
    </>
  );

  if (d.heroLayout === 'imageBackground') {
    const overlay = OVERLAY[d.heroOverlay ?? 'medium'];
    return (
      <header className="relative min-h-[78vh] flex items-center px-6 py-24 overflow-hidden"
        style={imageUrl ? undefined : { background: `linear-gradient(135deg, ${p.primary}, ${alpha(p.text, 0.92)})` }}>
        {imageUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, rgba(0,0,0,${overlay * 0.6}), rgba(0,0,0,${Math.min(overlay + 0.15, 0.8)}))` }} />
          </>
        )}
        <div className="relative max-w-5xl mx-auto w-full">{heroText(true)}</div>
      </header>
    );
  }
  if (d.heroLayout === 'split') {
    return (
      <header className="px-6 py-16 sm:py-24">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>{heroText(false)}</div>
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="w-full aspect-[4/3] object-cover shadow-xl" style={{ borderRadius: r.box }} />
          ) : (
            <div aria-hidden className="w-full aspect-[4/3] shadow-xl flex items-center justify-center"
              style={{ borderRadius: r.box, background: `linear-gradient(135deg, ${alpha(p.primary, 0.9)}, ${alpha(p.primary, 0.55)})` }}>
              <span style={{ ...headingStyle, color: p.onPrimary }} className="text-6xl opacity-90">{lp.businessName.slice(0, 1)}</span>
            </div>
          )}
        </div>
      </header>
    );
  }
  return (
    <header className="px-6 pt-20 pb-16 sm:pt-28 text-center" style={{ background: `radial-gradient(ellipse at top, ${alpha(p.primary, 0.12)}, transparent 70%)` }}>
      <div className="max-w-3xl mx-auto">{heroText(false)}</div>
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="max-w-5xl w-full mx-auto mt-14 aspect-[16/7] object-cover shadow-xl" style={{ borderRadius: r.box }} />
      )}
    </header>
  );
}

// ---- 強み（3種類の見せ方） ----
export function StrengthsSection({ lp, tokens }: { lp: Lp; tokens: Tokens }) {
  const { d, p, headingStyle } = tokens;
  const strengths = lp.strengths.filter(Boolean);
  let block: ReactNode;
  if (d.strengthsStyle === 'numbered') {
    block = (
      <ol className="grid md:grid-cols-3 gap-8">
        {strengths.map((s, i) => (
          <li key={i} className="text-center">
            <span style={{ ...headingStyle, color: p.primary }} className="block text-5xl mb-4">{String(i + 1).padStart(2, '0')}</span>
            <p className="font-bold text-lg leading-relaxed">{s}</p>
          </li>
        ))}
      </ol>
    );
  } else if (d.strengthsStyle === 'minimal') {
    block = (
      <ul className="max-w-2xl mx-auto divide-y" style={{ borderColor: alpha(p.text, 0.12) }}>
        {strengths.map((s, i) => (
          <li key={i} className="py-6 flex gap-5 items-baseline" style={{ borderColor: alpha(p.text, 0.12) }}>
            <span style={{ color: p.primary }} className="text-sm font-bold tracking-widest">POINT {i + 1}</span>
            <p className="text-lg leading-relaxed">{s}</p>
          </li>
        ))}
      </ul>
    );
  } else {
    block = (
      <div className="grid md:grid-cols-3 gap-6">
        {strengths.map((s, i) => (
          <div key={i} style={tokens.boxStyle} className="p-8 shadow-sm">
            <span aria-hidden style={{ background: alpha(p.primary, 0.12), color: p.primary, borderRadius: tokens.r.button }}
              className="inline-flex w-10 h-10 items-center justify-center font-bold mb-5">{i + 1}</span>
            <p className="font-bold text-lg leading-relaxed">{s}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <SectionWrap tokens={tokens} tint>
      <HeadingBlock tokens={tokens}>選ばれる3つの理由</HeadingBlock>
      {block}
    </SectionWrap>
  );
}

export const FEATURE_LABELS: Record<string, string> = {
  menu: 'メニュー・料金', faq: 'よくある質問', access: 'アクセス・営業時間',
  about: '私たちについて', flow: 'ご利用の流れ', campaign: 'キャンペーン'
};

// ---- 追加した機能（セクション） ----
export function FeatureSection({ section, index, tokens }: { section: { feature: string; content: any }; index: number; tokens: Tokens }) {
  const { p, r, muted, boxStyle, ctaStyle, headingStyle } = tokens;
  const c = section.content ?? {};
  const tint = index % 2 === 0;
  switch (section.feature) {
    case 'menu':
      return (
        <SectionWrap tokens={tokens} tint={tint} id={section.feature}>
          <HeadingBlock tokens={tokens}>{str(c.heading) || FEATURE_LABELS.menu}</HeadingBlock>
          {str(c.intro) && <p className="text-center mb-10 leading-relaxed" style={{ color: muted }}>{str(c.intro)}</p>}
          <div style={boxStyle} className="max-w-3xl mx-auto p-6 sm:p-10">
            {arr(c.items).map((it, j) => (
              <div key={j} className="py-5 border-b last:border-b-0" style={{ borderColor: alpha(p.text, 0.1) }}>
                <div className="flex items-baseline gap-3">
                  <span className="font-bold">{str(it?.name)}</span>
                  <span aria-hidden className="flex-1 border-b border-dotted" style={{ borderColor: alpha(p.text, 0.3) }} />
                  <span className="font-bold whitespace-nowrap" style={{ color: p.primary }}>{str(it?.price)}</span>
                </div>
                {str(it?.description) && <p className="text-sm mt-2 leading-relaxed" style={{ color: muted }}>{str(it.description)}</p>}
              </div>
            ))}
            {str(c.note) && <p className="text-xs mt-6" style={{ color: muted }}>{str(c.note)}</p>}
          </div>
        </SectionWrap>
      );
    case 'faq':
      return (
        <SectionWrap tokens={tokens} tint={tint} id={section.feature}>
          <HeadingBlock tokens={tokens}>{str(c.heading) || FEATURE_LABELS.faq}</HeadingBlock>
          <div className="max-w-3xl mx-auto space-y-3">
            {arr(c.items).map((it, j) => (
              <details key={j} style={boxStyle} className="group p-5 sm:p-6">
                <summary className="font-bold cursor-pointer list-none flex justify-between gap-4">
                  <span><span style={{ color: p.primary }} className="mr-2">Q.</span>{str(it?.question)}</span>
                  <span aria-hidden className="transition-transform group-open:rotate-45" style={{ color: p.primary }}>＋</span>
                </summary>
                <p className="mt-4 leading-relaxed" style={{ color: muted }}>{str(it?.answer)}</p>
              </details>
            ))}
          </div>
        </SectionWrap>
      );
    case 'access':
      return (
        <SectionWrap tokens={tokens} tint={tint} id={section.feature}>
          <HeadingBlock tokens={tokens}>{str(c.heading) || FEATURE_LABELS.access}</HeadingBlock>
          <div style={boxStyle} className="max-w-3xl mx-auto p-6 sm:p-10">
            {str(c.directions) && <p className="mb-6 leading-relaxed">{str(c.directions)}</p>}
            <dl className="divide-y" style={{ borderColor: alpha(p.text, 0.1) }}>
              {arr(c.rows).map((row, j) => (
                <div key={j} className="grid grid-cols-3 gap-4 py-4" style={{ borderColor: alpha(p.text, 0.1) }}>
                  <dt className="font-bold text-sm" style={{ color: muted }}>{str(row?.label)}</dt>
                  <dd className="col-span-2">{str(row?.value)}</dd>
                </div>
              ))}
            </dl>
            {/^https:\/\/www\.google\.com\/maps\//.test(str(c.mapUrl)) && (
              <a href={str(c.mapUrl)} target="_blank" rel="noopener noreferrer" style={{ ...ctaStyle, background: 'transparent', color: p.primary, border: `2px solid ${p.primary}` }}
                className="inline-block mt-8 px-6 py-3 font-bold">Googleマップで見る</a>
            )}
          </div>
        </SectionWrap>
      );
    case 'about':
      return (
        <SectionWrap tokens={tokens} tint={tint} id={section.feature}>
          <HeadingBlock tokens={tokens}>{str(c.heading) || FEATURE_LABELS.about}</HeadingBlock>
          <div className="max-w-2xl mx-auto space-y-6 text-lg leading-loose">
            {arr(c.body).map((para, j) => <p key={j}>{str(para)}</p>)}
            {str(c.signature) && <p className="text-right font-bold" style={headingStyle}>{str(c.signature)}</p>}
          </div>
        </SectionWrap>
      );
    case 'flow':
      return (
        <SectionWrap tokens={tokens} tint={tint} id={section.feature}>
          <HeadingBlock tokens={tokens}>{str(c.heading) || FEATURE_LABELS.flow}</HeadingBlock>
          <ol className="max-w-3xl mx-auto">
            {arr(c.steps).map((st, j, all) => (
              <li key={j} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <span style={{ background: p.primary, color: p.onPrimary, borderRadius: '9999px' }} className="w-10 h-10 flex items-center justify-center font-bold shrink-0">{j + 1}</span>
                  {j < all.length - 1 && <span aria-hidden className="w-0.5 flex-1 my-2" style={{ background: alpha(p.primary, 0.25) }} />}
                </div>
                <div className="pb-10">
                  <p className="font-bold text-lg">{str(st?.title)}</p>
                  <p className="mt-1 leading-relaxed" style={{ color: muted }}>{str(st?.description)}</p>
                </div>
              </li>
            ))}
          </ol>
        </SectionWrap>
      );
    case 'campaign':
      return (
        <SectionWrap tokens={tokens} tint={tint} id={section.feature}>
          <div className="max-w-3xl mx-auto p-8 sm:p-12 text-center shadow-xl"
            style={{ borderRadius: tokens.r.box, background: `linear-gradient(135deg, ${p.primary}, ${alpha(p.primary, 0.82)})`, color: p.onPrimary }}>
            <p className="text-sm font-bold tracking-widest opacity-90 mb-3">{str(c.heading) || FEATURE_LABELS.campaign}</p>
            <p style={headingStyle} className="text-2xl sm:text-4xl mb-5">{str(c.title)}</p>
            <p className="leading-relaxed opacity-95 mb-6">{str(c.description)}</p>
            <p className="text-sm opacity-90">{str(c.conditions)}</p>
            {str(c.deadline) && <p className="text-sm font-bold mt-2">期限：{str(c.deadline)}</p>}
          </div>
        </SectionWrap>
      );
    default:
      return null;
  }
}

// 外部ツール（予約・ネットショップ・問い合わせフォーム等）への入口。
// 埋め込みは第三者のページをiframeで表示する。sandboxの allow-same-origin は「そのツール自身の生成元」として
// 動かすためのもので、srcがAWPとは別のドメイン（サーバー側で許可ホストを検証済み）なのでAWP側の情報には触れられない
export function ToolsSection({ lp, tokens }: { lp: Lp; tokens: Tokens }) {
  const tools = lp.tools ?? [];
  if (tools.length === 0) return null;
  const buttons = tools.filter((t) => t.display !== 'embed');
  const embeds = tools.filter((t) => t.display === 'embed');
  return (
    <SectionWrap tokens={tokens} id="tools">
      <HeadingBlock tokens={tokens}>オンライン窓口</HeadingBlock>
      {buttons.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:flex-wrap justify-center gap-4">
          {buttons.map((t) => (
            <a key={t.url} href={t.url} target="_blank" rel="noopener noreferrer" style={tokens.ctaStyle}
              className="text-center font-bold px-8 py-4 shadow-md transition-transform hover:-translate-y-0.5">
              {t.label}
            </a>
          ))}
        </div>
      )}
      {embeds.map((t) => (
        <div key={t.url} className="mt-10">
          <p style={tokens.headingStyle} className="text-lg mb-3">{t.label}</p>
          <iframe src={t.url} title={t.label} loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin"
            className="w-full h-[70vh] min-h-[480px]" style={{ border: 0, borderRadius: tokens.r.box, background: tokens.p.surface }} />
          <a href={t.url} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-sm underline" style={{ color: tokens.muted }}>
            うまく表示されない場合はこちら
          </a>
        </div>
      ))}
    </SectionWrap>
  );
}

export function LineCtaSection({ lp, tokens }: { lp: Lp; tokens: Tokens }) {
  const { p, headingStyle, ctaStyle } = tokens;
  return (
    <section id="line" className="px-6 py-20 sm:py-28 text-center" style={{ background: p.text, color: p.background }}>
      <div className="max-w-2xl mx-auto">
        {lp.scarcityOffer && <p className="font-bold mb-5" style={{ color: p.background, opacity: 0.9 }}>{lp.scarcityOffer}</p>}
        <h2 style={{ ...headingStyle, color: p.background }} className="text-2xl sm:text-4xl mb-6">お気軽にご相談ください</h2>
        <p className="mb-10 opacity-80 leading-relaxed">LINEから24時間受け付けています。担当者よりご返信いたします。</p>
        <LineFriendAddLink slug={lp.slug} variantId={lp.variantId ?? null} style={{ ...ctaStyle, background: '#06C755', color: '#ffffff' }}
          className="inline-block px-10 py-5 font-bold text-lg shadow-lg">LINEで友だち追加する</LineFriendAddLink>
      </div>
    </section>
  );
}

export function SiteFooter({ lp, tokens }: { lp: Lp; tokens: Tokens }) {
  const { p } = tokens;
  return (
    <footer className="px-6 py-8 text-center text-xs" style={{ background: p.text, color: alpha(p.background, 0.6) }}>
      © {new Date().getFullYear()} {lp.businessName}
    </footer>
  );
}

// HP（複数ページ）モードのページ間ナビゲーション。ホームと、追加済みの機能ページへのリンクを並べる。
export function SiteNav({ lp, tokens, current }: { lp: Lp; tokens: Tokens; current?: string }) {
  const { p, alpha: a } = tokens;
  const items = [{ id: '', label: 'ホーム' }, ...lp.sections.map((s) => ({ id: s.feature, label: FEATURE_LABELS[s.feature] || s.feature }))];
  return (
    <nav className="sticky top-0 z-10 backdrop-blur px-4 py-3 flex gap-2 overflow-x-auto"
      style={{ background: a(p.background, 0.9), borderBottom: `1px solid ${a(p.text, 0.08)}` }}>
      <div className="max-w-5xl mx-auto flex gap-2 w-full">
        {items.map((it) => {
          const href = `/${lp.slug}${it.id ? `/${it.id}` : ''}`;
          const active = (current ?? '') === it.id;
          return (
            <a key={it.id || 'home'} href={href}
              style={active ? { background: p.primary, color: p.onPrimary } : { color: p.text }}
              className="px-4 py-2 text-sm font-bold rounded-full whitespace-nowrap transition-colors">
              {it.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

// LP（1ページ完結）モード。すべてのセクションを1つのスクロールに並べる。
export default function LandingView({ lp, imageUrl }: { lp: Lp; imageUrl: string | null }) {
  const tokens = buildTokens(lp.design);
  return (
    <div style={{ background: tokens.p.background, color: tokens.p.text, fontFamily: tokens.font.body }} className="min-h-screen">
      <HeroSection lp={lp} imageUrl={imageUrl} tokens={tokens} />
      <StrengthsSection lp={lp} tokens={tokens} />
      {lp.sections.map((s, i) => <FeatureSection key={s.feature} section={s} index={i} tokens={tokens} />)}
      <ToolsSection lp={lp} tokens={tokens} />
      <LineCtaSection lp={lp} tokens={tokens} />
      <SiteFooter lp={lp} tokens={tokens} />
    </div>
  );
}
