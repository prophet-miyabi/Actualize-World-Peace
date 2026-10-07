// 収益化（PR枠）。ページの持ち主がオンにしたときだけ、提携サービスを「PR」と明示して紹介する
// （広告であることを隠さない: ステルスマーケティング規制への対応）
type Promotion = { key: string; name: string; description: string };

export default function PromotionBlock({ slug, items }: { slug: string; items: Promotion[] }) {
  if (items.length === 0) return null;
  return (
    <aside className="bg-gray-50 text-gray-800 border-t border-gray-200 px-4 py-5" style={{ fontFamily: 'var(--font-sans-jp)' }} aria-label="広告">
      <div className="max-w-3xl mx-auto">
        <p className="text-[11px] font-bold text-gray-500">
          <span className="inline-block rounded border border-gray-400 px-1.5 mr-1.5">PR</span>
          このページの運営者が紹介している提携サービス（広告）です
        </p>
        <ul className="mt-3 grid gap-2">
          {items.map((p) => (
            <li key={p.key}>
              <a href={`/api/tools/go/${encodeURIComponent(p.key)}?lp=${encodeURIComponent(slug)}&src=pr`} target="_blank" rel="sponsored noopener noreferrer"
                className="block rounded-2xl bg-white border border-gray-200 px-4 py-3">
                <span className="block text-sm font-bold">{p.name} →</span>
                <span className="block text-xs text-gray-500 mt-0.5 line-clamp-2">{p.description}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
