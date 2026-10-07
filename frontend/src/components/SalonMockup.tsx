import SiteAssetImage from './SiteAssetImage';

// トップページのスマホ見本。AWPで作れるページの完成度を一目で伝えるための、架空の美容院サイト。
// 写真は管理画面（/admin/assets）でAI生成したものを使い、未生成のあいだは
// グラデーションとぼかしで「やわらかい光のサロン写真」の雰囲気を描く。
// 店名・場所・料金は架空。評価や口コミ件数のような実績の表示は入れない。
const serif = { fontFamily: 'var(--font-serif-jp)' };

const MENU = [
  { name: 'Cut', price: '¥6,600' },
  { name: 'Color', price: '¥8,800〜' },
  { name: 'Treatment', price: '¥4,400' }
];

const STYLES = [
  { key: 'mockup_salon_style_1', bg: 'linear-gradient(160deg, #e8dccd, #b9a48c 55%, #7d6a58)' },
  { key: 'mockup_salon_style_2', bg: 'linear-gradient(160deg, #d9c3a5, #a07c5a 55%, #5b4231)' },
  { key: 'mockup_salon_style_3', bg: 'linear-gradient(160deg, #c8c3bd, #8f8780 55%, #4d4642)' }
];

export default function SalonMockup() {
  return (
    <div className="relative w-[17rem] sm:w-72 h-[37rem] rounded-[2.75rem] border-[9px] border-[#1c1c1e] bg-[#f7f3ee] shadow-2xl overflow-hidden text-[#2b2420]">
      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-5 rounded-full bg-[#1c1c1e] z-20" />

      <header className="flex items-center justify-between px-5 pt-9 pb-3">
        <span className="flex flex-col gap-[3px]">
          <span className="block w-4 h-px bg-[#2b2420]" />
          <span className="block w-3 h-px bg-[#2b2420]" />
        </span>
        <span className="text-[13px] italic tracking-[0.25em]" style={serif}>Lumière</span>
        <span className="w-4 h-4 rounded-full border border-[#2b2420]/60" />
      </header>

      <div className="relative mx-3 h-48 rounded-[1.4rem] overflow-hidden"
        style={{ background: 'radial-gradient(120% 80% at 75% 15%, rgba(255,238,214,0.95), transparent 55%), radial-gradient(90% 70% at 15% 95%, rgba(110,78,56,0.9), transparent 60%), linear-gradient(160deg, #cfae8c, #6e4f3a 62%, #2f231c)' }}>
        <div className="absolute -right-6 top-10 w-36 h-44 rounded-full bg-[#3a2a20]/60 blur-2xl" />
        <div className="absolute right-10 top-4 w-16 h-16 rounded-full bg-white/50 blur-xl" />
        <SiteAssetImage assetKey="mockup_salon_hero" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <div className="absolute left-4 bottom-4 right-4 text-white">
          <p className="text-[7.5px] tracking-[0.35em] opacity-80 mb-2">OMOTESANDO / HAIR SALON</p>
          <p className="text-[18px] leading-snug" style={serif}>毎朝の髪が、<br />少しうれしくなる。</p>
        </div>
      </div>

      <section className="px-5 mt-4">
        <p className="text-[8px] tracking-[0.35em] text-[#9a7b5f] mb-1">CONCEPT</p>
        <p className="text-[10.5px] leading-relaxed" style={serif}>骨格と髪質に合わせて、<br />おうちでも再現しやすいスタイルを。</p>
      </section>

      <section className="px-5 mt-3">
        <p className="text-[8px] tracking-[0.35em] text-[#9a7b5f] mb-1.5">MENU</p>
        <ul className="space-y-1">
          {MENU.map((m) => (
            <li key={m.name} className="flex items-baseline text-[10.5px]">
              <span style={serif}>{m.name}</span>
              <span className="flex-1 mx-2 border-b border-dotted border-[#2b2420]/30" />
              <span className="tabular-nums">{m.price}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-5 mt-3">
        <p className="text-[8px] tracking-[0.35em] text-[#9a7b5f] mb-1.5">STYLE</p>
        <div className="grid grid-cols-3 gap-1.5">
          {STYLES.map((st) => (
            <div key={st.key} className="relative aspect-square rounded-lg overflow-hidden" style={{ background: st.bg }}>
              <SiteAssetImage assetKey={st.key} className="absolute inset-0 w-full h-full object-cover" />
            </div>
          ))}
        </div>
      </section>

      <div className="absolute bottom-0 inset-x-0 px-3 pb-3 pt-6 bg-gradient-to-t from-[#f7f3ee] via-[#f7f3ee] to-transparent flex gap-2 items-center">
        <span className="flex-1 text-center rounded-full bg-[#2b2420] text-white text-[10px] tracking-[0.3em] py-2.5">WEB予約</span>
        <span className="w-9 h-9 shrink-0 rounded-full bg-[#06C755] text-white text-[8px] font-bold flex items-center justify-center">LINE</span>
      </div>
    </div>
  );
}
