import { buildTokens, type Lp } from '@/components/lp/LandingView';

export type PublicProduct = {
  id: string; name: string; priceYen: number | null; priceNote: string | null; description: string | null;
  buyUrl: string | null; soldOut: boolean; image: string | null;
};

// 商品カタログ（ページのデザインの色に合わせて表示）。購入は持ち主のネットショップで行う
export default function ProductsSection({ lp, products }: { lp: Lp; products: PublicProduct[] }) {
  if (products.length === 0) return null;
  const { p, alpha, font, headingStyle, boxStyle, ctaStyle } = buildTokens(lp.design);
  return (
    <section className="px-5 py-14" style={{ background: p.background, color: p.text, fontFamily: font.body }} aria-labelledby="awp-products">
      <div className="max-w-4xl mx-auto">
        <h2 id="awp-products" className="text-2xl text-center mb-8" style={headingStyle}>商品</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {products.map((item) => (
            <article key={item.id} className="overflow-hidden flex flex-col" style={boxStyle}>
              <div className="aspect-square relative" style={{ background: alpha(p.primary, 0.08) }}>
                {item.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt={item.name} loading="lazy" className="w-full h-full object-cover" />
                )}
                {item.soldOut && (
                  <span className="absolute top-2 left-2 rounded-full bg-black/70 text-white text-[11px] font-bold px-2 py-0.5">売り切れ</span>
                )}
              </div>
              <div className="p-3 flex flex-col flex-1">
                <h3 className="font-bold text-sm">{item.name}</h3>
                {item.priceYen != null && (
                  <p className="text-sm font-bold mt-1" style={{ color: p.primary }}>
                    ¥{item.priceYen.toLocaleString('ja-JP')}{item.priceNote && <span className="text-[11px] font-normal opacity-70">（{item.priceNote}）</span>}
                  </p>
                )}
                {item.description && <p className="text-xs opacity-75 mt-1 line-clamp-3">{item.description}</p>}
                {item.buyUrl && !item.soldOut && (
                  <a href={item.buyUrl} target="_blank" rel="noopener noreferrer"
                    className="mt-auto pt-3 block">
                    <span className="block text-center text-xs font-bold py-2" style={ctaStyle}>ショップで見る</span>
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
