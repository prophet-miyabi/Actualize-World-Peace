import type { Metadata } from 'next';
import Link from 'next/link';
import SiteAssetImage from '@/components/SiteAssetImage';
import Logo from '@/components/Logo';

// AWP 自体のLP（ログイン画面の前に表示するサービス紹介）。
// 表示内容はすべて事実に基づくこと: 根拠のない利用者数・口コミ・所要時間は載せない。
// 料金は必ず明記する（「無料」と誤解される表示は景品表示法の有利誤認にあたるおそれがある）。

const TITLE = 'AWP | スマホひとつで、ホームページとLINE公式アカウントを';
const DESCRIPTION =
  '事業内容を一言入力するだけで、AIがホームページの文章とデザインを作成。個人事業から、社内新規事業・フランチャイズの多店舗展開まで、複数ページを1つのアカウントで管理できます。月額2,980円（税込）。';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    locale: 'ja_JP',
    images: ['/api/site-assets/marketing_hero']
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/api/site-assets/marketing_hero']
  }
};

const SIGNUP = '/login?mode=register';
const DEMO_SLUG = process.env.NEXT_PUBLIC_DEMO_SLUG;

const PROBLEMS = [
  { title: 'ホームページを作る時間がない', body: '文章を考え、写真を選び、デザインを整える。本業や新規事業の立ち上げの合間に進めるのは大変です。' },
  { title: '制作を頼むと費用がかさむ', body: '制作会社への依頼は、初期費用や更新のたびの費用が負担になりがちです。店舗数・事業数が増えるほど積み重なります。' },
  { title: '拠点・事業ごとにページを増やしにくい', body: 'フランチャイズの新規加盟店や、社内の新規事業立ち上げのたびに、同じ制作の手間がかかってしまいます。' }
];

// 需要が高いと考えられる順に並べる（購入判断への直結度・対応できる事業の幅で判断）：
// 1. AIによる作成（サービスの核）→ 2. LINE連携（サービス名を構成する柱）→
// 3. 複数ページ管理（フランチャイズ・新規事業向けの新しい強み）→ 4. 機能追加 → 5. 独自ドメイン →
// 6. スマホ通知（アプリ公開準備中のため下位）→ 7. 品質チェック（差別化要素としては弱い）
const FEATURES = [
  {
    title: 'AIがページの文章とデザインを作成',
    body: '事業内容を一言入力すると、キャッチコピーと強みの文章を作成。配色・書体・レイアウトも、業種の雰囲気に合わせてAIが整えます。',
    tag: 'Claude × Gemini',
    assetKey: 'feature_ai_design'
  },
  {
    title: 'LINE公式アカウントと連携',
    body: 'ページから友だち追加されたお客様のお問い合わせに、自動で返信。受け付けた内容は一覧で確認できます。',
    tag: 'LINE',
    assetKey: 'feature_line'
  },
  {
    title: '複数の店舗・事業をまとめて管理',
    body: '拠点や新規事業が増えても、同じアカウントからページを追加していけます。ダッシュボードでページを切り替えるだけです。',
    tag: 'マルチページ',
    assetKey: 'feature_multipage'
  },
  {
    title: '必要な機能を、質問に答えて追加',
    body: 'メニュー・料金表、よくある質問、アクセス、キャンペーンなど。質問に答えるだけで、ページに追加されます。料金や日付は入力した内容がそのまま使われます。',
    tag: '6種類',
    assetKey: 'feature_addons'
  },
  {
    title: '独自ドメインにも対応',
    body: 'まずは共有のURLですぐに公開。ご自身のドメインで運用したくなったら、画面の案内に沿って切り替えられます。',
    tag: 'ドメイン',
    assetKey: 'feature_domain'
  },
  {
    title: '新着のお問い合わせをスマホに通知',
    body: 'スマートフォンアプリで、新しいお問い合わせをすぐに受け取れるようになります（アプリは公開準備中です）。',
    tag: 'アプリ',
    assetKey: 'feature_notifications'
  },
  {
    title: '読みやすさを自動でチェック',
    body: '文字と背景の色の組み合わせを自動で確認し、読みにくい配色は補正してから公開します。',
    tag: '品質',
    assetKey: 'feature_quality'
  }
];

const STEPS = [
  { title: 'アカウントを作成', body: 'メールアドレスとパスワードで登録します（無料）。' },
  { title: '事業内容を入力して無料で試作', body: '一言の説明から、AIが文章とデザインを作成します。仕上がりはダッシュボードでいつでも確認・作り直しできます。' },
  { title: '気に入ったら公開', body: '有料プランにお申し込みいただくと、独自URLで公開され、LINE連携も有効になります。' },
  { title: 'LINEと連携', body: 'LINE Developersで取得した情報を入力すると自動応答まで設定されます。まだお持ちでない方には作り方をご案内します。' }
];

const FAQ = [
  { q: '無料で使えますか？', a: 'アカウントの作成と、LP・HPの試作（AIによる文章・デザイン作成、作り直し）は無料です。実際に公開する（独自URLでアクセスできるようにする）には、有料プラン（月額2,980円・税込）への申し込みが必要です。' },
  { q: '契約期間の縛りはありますか？', a: 'ありません。ダッシュボードからいつでも解約でき、解約後は次回以降の請求は発生しません。支払い済みの料金の返金はしておりません。' },
  { q: 'LINE公式アカウントは必要ですか？', a: 'LINE連携を使うには、LINE公式アカウントとLINE Developersでの設定が必要です。LINE公式アカウントの利用料金は、LINEヤフー社の料金体系に従います。' },
  { q: 'AIが作った文章は編集できますか？', a: 'できます。AIが作成した内容は下書きとして表示され、公開前に自由に書き換えられます。' },
  { q: '支払い方法は何がありますか？', a: 'クレジットカードに対応しています（決済はStripeを利用しており、カード情報が当サービスに保存されることはありません）。' },
  { q: '作れるページの数は？', a: '1つのアカウントで、複数のページを作成・公開できます。店舗ごと・事業ごとにページを追加していけるので、フランチャイズの多店舗展開や、社内の新規事業立ち上げにもご利用いただけます。' }
];

function Cta({ className = '' }: { className?: string }) {
  return (
    <Link href={SIGNUP} className={`inline-block bg-blue-600 text-white font-bold rounded-full shadow-lg hover:bg-blue-700 transition ${className}`}>
      アカウントを作成する
    </Link>
  );
}

export default function Home() {
  return (
    <div className="bg-white text-gray-900" style={{ fontFamily: 'var(--font-sans-jp)' }}>
      {/* ヘッダー */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link href="/"><Logo size={32} /></Link>
          <nav className="flex items-center gap-5 text-sm">
            <a href="#features" className="hidden sm:inline text-gray-600 hover:text-gray-900">機能</a>
            <a href="#pricing" className="hidden sm:inline text-gray-600 hover:text-gray-900">料金</a>
            <a href="#faq" className="hidden sm:inline text-gray-600 hover:text-gray-900">よくある質問</a>
            <Link href="/login" className="text-gray-700 font-bold">ログイン</Link>
            <Link href={SIGNUP} className="bg-blue-600 text-white font-bold px-4 py-2 rounded-full hover:bg-blue-700">始める</Link>
          </nav>
        </div>
      </header>

      {/* ヒーロー */}
      <section className="relative px-5 pt-16 pb-20 sm:pt-24 overflow-hidden" style={{ background: 'radial-gradient(ellipse at top, #dbeafe, transparent 65%)' }}>
        <SiteAssetImage assetKey="marketing_hero" className="hidden md:block absolute inset-0 w-full h-full object-cover object-right" />
        <div className="absolute inset-0 hidden md:block" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.9) 32%, rgba(255,255,255,0.35) 58%, rgba(255,255,255,0.15) 100%)' }} />
        <div className="relative max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-blue-700 font-bold text-sm tracking-widest mb-4">個人事業から、社内新規事業・フランチャイズ展開まで</p>
            <h1 className="text-4xl sm:text-5xl font-black leading-tight mb-6">
              ホームページと<br />LINE公式アカウントを、<br />スマホひとつで。
            </h1>
            <p className="text-gray-600 text-lg leading-relaxed mb-8">
              事業内容を一言入力するだけで、AIがページの文章とデザインを作成。LINEのお問い合わせへの自動返信まで、まとめて始められます。店舗・事業が増えても、1つのアカウントでページを追加していけます。
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Cta className="px-8 py-4 text-lg" />
              {DEMO_SLUG && (
                <a href={`/${DEMO_SLUG}`} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-700 underline underline-offset-4">
                  作成例を見る
                </a>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-4">月額2,980円（税込）・契約期間の縛りなし</p>
          </div>

          {/* 画面イメージ（スマホの枠の中に、作成されるページの雰囲気を表示） */}
          <div aria-hidden className="flex justify-center">
            <div className="w-64 sm:w-72 rounded-[2.5rem] border-[10px] border-gray-900 bg-white shadow-2xl overflow-hidden">
              <div className="h-40 flex flex-col justify-end p-5 text-white" style={{ background: 'linear-gradient(160deg, #9a6b2f, #3b2a1f)' }}>
                <p className="text-[10px] tracking-widest opacity-80">Hair Salon Lumière</p>
                <p className="text-lg font-bold leading-snug" style={{ fontFamily: 'var(--font-serif-jp)' }}>毎朝の髪が、<br />少しうれしくなる。</p>
              </div>
              <div className="p-5 space-y-3" style={{ background: '#fbf8f3' }}>
                {['骨格に合わせた、扱いやすいカット', '髪へのやさしさにこだわった薬剤', '完全予約制で、ゆったりと'].map((t, i) => (
                  <div key={t} className="flex gap-3 items-baseline text-[11px]" style={{ fontFamily: 'var(--font-serif-jp)' }}>
                    <span className="font-bold" style={{ color: '#9a6b2f' }}>POINT {i + 1}</span>
                    <span>{t}</span>
                  </div>
                ))}
                <div className="rounded-full text-center text-white text-xs font-bold py-2.5 mt-4" style={{ background: '#06C755' }}>LINEで無料相談する</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* お悩み */}
      <section className="px-5 py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-12">こんなお悩みはありませんか？</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {PROBLEMS.map((p) => (
              <div key={p.title} className="bg-white rounded-2xl p-7 border">
                <p className="font-bold text-lg mb-3">{p.title}</p>
                <p className="text-gray-600 leading-relaxed text-sm">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 機能 */}
      <section id="features" className="px-5 py-20 scroll-mt-16">
        <div className="max-w-6xl mx-auto">
          <p className="text-blue-700 font-bold text-center text-sm tracking-widest mb-3">FEATURES</p>
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-4">AWPでできること</h2>
          <p className="text-gray-600 text-center mb-12">2つのAIが役割を分担し、ページ作りとお問い合わせ対応を支えます。</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border hover:shadow-md transition overflow-hidden">
                <div className="aspect-video bg-gradient-to-br from-blue-50 to-indigo-50">
                  <SiteAssetImage assetKey={f.assetKey} alt={f.title} className="w-full h-full object-cover" />
                </div>
                <div className="p-7">
                  <span className="inline-block text-xs font-bold text-blue-700 bg-blue-50 rounded-full px-3 py-1 mb-4">{f.tag}</span>
                  <p className="font-bold text-lg mb-3">{f.title}</p>
                  <p className="text-gray-600 leading-relaxed text-sm">{f.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 始め方 */}
      <section className="px-5 py-20 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-12">ご利用の流れ</h2>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-5">
                <div className="flex flex-col items-center">
                  <span className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  {i < STEPS.length - 1 && <span aria-hidden className="w-0.5 flex-1 bg-blue-200 my-2" />}
                </div>
                <div className="pb-10">
                  <p className="font-bold text-lg">{s.title}</p>
                  <p className="text-gray-600 mt-1 leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="text-center"><Cta className="px-8 py-4" /></div>
        </div>
      </section>

      {/* 料金 */}
      <section id="pricing" className="px-5 py-20 scroll-mt-16">
        <div className="max-w-md mx-auto text-center">
          <p className="text-blue-700 font-bold text-sm tracking-widest mb-3">PRICING</p>
          <h2 className="text-2xl sm:text-3xl font-black mb-10">料金</h2>
          <div className="rounded-3xl border-2 border-blue-600 p-8 shadow-xl">
            <p className="font-bold">スタンダードプラン</p>
            <p className="text-5xl font-black my-4">¥2,980<span className="text-base font-normal text-gray-500">/月（税込）</span></p>
            <ul className="text-left text-sm text-gray-700 space-y-3 my-8">
              {[
                '複数ページの作成・公開（試作は無料。公開のみ本プランが必要）',
                'AIによる文章・デザインの作成と作り直し',
                '機能の追加（メニュー・よくある質問など6種類）',
                'LINE公式アカウント連携・自動応答（お持ちの方は追加料金なし）',
                'お問い合わせの管理（スマホアプリでの通知は公開準備中）',
                '独自ドメインでの公開（ドメインの取得費用は別途）'
              ].map((t) => (
                <li key={t} className="flex gap-2"><span className="text-blue-600 font-bold">✓</span>{t}</li>
              ))}
            </ul>
            <Cta className="w-full py-4 text-center" />
            <p className="text-xs text-gray-500 mt-4">アカウントの作成とページの試作は無料です。公開には本プランへのお申し込みが必要です。いつでも解約できます。</p>
          </div>
        </div>
      </section>

      {/* よくある質問 */}
      <section id="faq" className="px-5 py-20 bg-gray-50 scroll-mt-16">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-10">よくある質問</h2>
          <div className="space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group bg-white rounded-2xl border p-6">
                <summary className="font-bold cursor-pointer list-none flex justify-between gap-4">
                  <span><span className="text-blue-600 mr-2">Q.</span>{f.q}</span>
                  <span aria-hidden className="text-blue-600 transition-transform group-open:rotate-45">＋</span>
                </summary>
                <p className="mt-4 text-gray-600 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 最後のひと押し */}
      <section className="px-5 py-24 text-center text-white" style={{ background: 'linear-gradient(135deg, #1d4ed8, #0f172a)' }}>
        <h2 className="text-2xl sm:text-4xl font-black mb-5">あなたのお店のページを、今日から。</h2>
        <p className="opacity-85 mb-10">アカウントの作成は無料。プランは月額2,980円（税込）です。</p>
        <Link href={SIGNUP} className="inline-block bg-white text-blue-700 font-bold rounded-full px-10 py-4 text-lg shadow-lg hover:bg-blue-50">
          アカウントを作成する
        </Link>
      </section>

      <footer className="px-5 py-10 text-sm text-gray-500">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row gap-4 justify-between">
          <p>© {new Date().getFullYear()} AWP</p>
          <div className="flex gap-5">
            <Link href="/legal" className="hover:underline">特定商取引法に基づく表記</Link>
            <Link href="/privacy" className="hover:underline">プライバシーポリシー</Link>
            <Link href="/login" className="hover:underline">ログイン</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
