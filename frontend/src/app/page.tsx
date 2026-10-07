import type { Metadata } from 'next';
import Link from 'next/link';
import SiteAssetImage from '@/components/SiteAssetImage';
import SalonMockup from '@/components/SalonMockup';
import Logo from '@/components/Logo';

// AWP 自体のLP（ログイン画面の前に表示するサービス紹介）。
// 表示内容はすべて事実に基づくこと: 根拠のない利用者数・口コミ・所要時間は載せない。
// 料金は必ず明記する（「無料」と誤解される表示は景品表示法の有利誤認にあたるおそれがある）。

const TITLE = 'AWP | やりたいことを、スマホひとつで世界へ';
const DESCRIPTION =
  'お店も、作品も、あなた自身も。一言入力するだけで、AIがホームページの文章とデザインを作成。そのまま無料で公開して、予約やネットショップなどのツールもかんたんに追加できます。AWPは Actualize World Peace の略です。';

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
  { title: '発信したいのに、自分のページがない', body: 'SNSだけだと、作品やサービスの情報はどんどん流れていきます。ちゃんとまとまった「自分の場所」がほしい。' },
  { title: '作るのはむずかしそう、高そう', body: '文章を考えて、デザインを整えて……。制作を頼むと、費用もかかってしまいます。' },
  { title: '予約や販売の仕組みまで手が回らない', body: 'お申し込みやショップを用意したいけれど、どのツールをどうつなげばいいかわからない。' }
];

// 新しく始める人が「これならできそう」と思える順に並べる：作成 → 公開 → 収益化の入口 → 育てる → 安心
const FEATURES = [
  {
    title: 'AIが文章とデザインをつくる',
    body: '一言入力するだけで、キャッチコピーと魅力の文章をAIが作成。配色・書体・レイアウトも、あなたの雰囲気に合わせて整えます。',
    tag: 'AI',
    assetKey: 'feature_ai_design'
  },
  {
    title: 'つくったら、そのまま無料で公開',
    body: 'AWPのURLですぐに公開できます。自分のドメインで公開したくなったら、画面の案内にそって切り替えられます。',
    tag: '無料公開',
    assetKey: 'feature_domain'
  },
  {
    title: '予約・ショップ・フォームをかんたん追加',
    body: 'ツールを選んで、あなたのページのURLを貼るだけ。お客様やファンの情報は、あなた名義のツールのアカウントに保存されます。',
    tag: '提携ツール',
    assetKey: 'feature_tools'
  },
  {
    title: '質問に答えて、機能をプラス',
    body: 'メニュー・料金表、よくある質問、アクセス、キャンペーンなど。質問に答えるだけで、ページに追加されます。',
    tag: '6種類',
    assetKey: 'feature_addons'
  },
  {
    title: 'LINEで、お客様やファンとつながる',
    body: 'LINE公式アカウントの友だち追加URLを登録すると、ページにLINEボタンが表示されます。',
    tag: 'LINE',
    assetKey: 'feature_line'
  },
  {
    title: 'ページはいくつでも',
    body: '本業と副業、作品ごと、お店ごと。1つのアカウントで、ページを増やしていけます。',
    tag: 'マルチページ',
    assetKey: 'feature_multipage'
  },
  {
    title: 'データはいつでも持ち出せる',
    body: 'ページの内容や写真、お問い合わせの履歴は、いつでもファイルで書き出せます。',
    tag: '安心',
    assetKey: 'feature_quality'
  }
];

const STEPS = [
  { title: 'アカウントをつくる', body: 'メールアドレスとパスワードだけで、無料で登録できます。' },
  { title: 'なにをはじめるか選ぶ', body: 'お店・ビジネスか、クリエイター活動か。選んで一言入力すれば、AIが文章とデザインをつくります。' },
  { title: 'そのまま無料で公開', body: 'AWPのURL（/ページ名）ですぐに公開されます。独自ドメインでの公開もできます。' },
  { title: '提携ツールを追加', body: '予約・ネットショップ・問い合わせフォームなどのツールを、あなた名義のアカウントで導入して、ページに追加できます。' }
];

function Cta({ className = '' }: { className?: string }) {
  return (
    <Link href={SIGNUP} className={`inline-block bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold rounded-full shadow-lg shadow-violet-200 hover:brightness-110 transition ${className}`}>
      無料ではじめる
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
            <Link href="/login" className="text-gray-700 font-bold">ログイン</Link>
            <Link href={SIGNUP} className="bg-gradient-to-r from-fuchsia-500 to-violet-600 text-white font-bold px-4 py-2 rounded-full hover:brightness-110">はじめる</Link>
          </nav>
        </div>
      </header>

      {/* ヒーロー */}
      <section className="relative px-5 pt-16 pb-20 sm:pt-24 overflow-hidden" style={{ background: 'radial-gradient(ellipse at top left, #fce7f3, transparent 55%), radial-gradient(ellipse at top right, #e0e7ff, transparent 60%)' }}>
        <SiteAssetImage assetKey="marketing_hero" className="hidden md:block absolute inset-0 w-full h-full object-cover object-right" />
        <div className="absolute inset-0 hidden md:block" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.9) 32%, rgba(255,255,255,0.35) 58%, rgba(255,255,255,0.15) 100%)' }} />
        <div className="relative max-w-6xl mx-auto grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="inline-block text-violet-700 bg-violet-100 font-bold text-sm rounded-full px-4 py-1 mb-5">ビジネスにも、クリエイター活動にも。</p>
            <h1 className="text-4xl sm:text-5xl font-black leading-tight mb-6">
              やりたいことを、<br />スマホひとつで<br /><span className="bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 bg-clip-text text-transparent">世界へ。</span>
            </h1>
            <p className="text-gray-600 text-lg leading-relaxed mb-8">
              お店も、作品も、あなた自身も。一言入力するだけで、AIがホームページの文章とデザインをつくります。そのまま無料で公開して、予約やネットショップもかんたんに追加できます。
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Cta className="px-8 py-4 text-lg" />
              {DEMO_SLUG && (
                <a href={`/${DEMO_SLUG}`} target="_blank" rel="noopener noreferrer" className="font-bold text-blue-700 underline underline-offset-4">
                  作成例を見る
                </a>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-4">作成・公開まで無料・クレジットカードの登録不要</p>
          </div>

          {/* 画面イメージ（スマホの枠の中に、作成されるページの完成度を表示） */}
          <div aria-hidden className="flex justify-center">
            <SalonMockup />
          </div>
        </div>
      </section>

      {/* お悩み */}
      <section className="px-5 py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-12">こんなモヤモヤ、ありませんか？</h2>
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
          <p className="text-gray-600 text-center mb-12">むずかしいところは、AIにおまかせ。</p>
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
          <h2 className="text-2xl sm:text-3xl font-black text-center mb-12">はじめかた</h2>
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
            <p className="font-bold">フリープラン</p>
            <p className="text-5xl font-black my-4">¥0</p>
            <ul className="text-left text-sm text-gray-700 space-y-3 my-8">
              {[
                '複数ページの作成・公開',
                'AIによる文章・デザインの作成と作り直し',
                '機能の追加',
                '予約・ネットショップなどの提携ツールの追加',
                '独自ドメインでの公開',
                'データの書き出し'
              ].map((t) => (
                <li key={t} className="flex gap-2"><span className="text-blue-600 font-bold">✓</span>{t}</li>
              ))}
            </ul>
            <Cta className="w-full py-4 text-center" />
            <p className="text-xs text-gray-500 mt-4">LINE自動応答・SNSの自動投稿・AIエージェントによる運用などの上位機能は準備中です。</p>
          </div>
        </div>
      </section>


      {/* ミッション: AWP = Actualize World Peace */}
      <section className="px-5 py-20 text-center bg-gradient-to-br from-fuchsia-50 via-white to-sky-50">
        <div className="max-w-2xl mx-auto">
          <p className="text-violet-700 font-bold text-sm tracking-widest mb-3">OUR MISSION</p>
          <h2 className="text-3xl sm:text-5xl font-black mb-8 bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 bg-clip-text text-transparent">
            Actualize World Peace
          </h2>
          <p className="text-xl sm:text-3xl font-black text-gray-900 leading-relaxed tracking-wide mb-8">
            まだ誰も見たことのない世界は、<br />
            あなたの「やりたい」から始まる。
          </p>
          <div className="text-gray-600 leading-loose tracking-wide space-y-6">
            <p>
              仕組みをつくる人が増えるほど、<br />
              誰かの「ほしい」に応える世界になる。
            </p>
            <p>
              自分だけのシステムを持てたなら、<br />
              人は天性のままに、豊かに生きていける。
            </p>
            <p className="font-bold text-gray-900">
              AWPで<br className="sm:hidden" />世界を動かすリーダーの一人に<br />あなたもなりましょう！
            </p>
          </div>
        </div>
      </section>

      {/* 最後のひと押し */}
      <section className="px-5 py-24 text-center text-white" style={{ background: 'linear-gradient(135deg, #d946ef, #7c3aed 50%, #0ea5e9)' }}>
        <h2 className="text-2xl sm:text-4xl font-black mb-5">あなたのページを、<br className="sm:hidden" />今日から。</h2>
        <p className="opacity-85 mb-10">アカウントの作成から、ページの公開まで無料です。</p>
        <Link href={SIGNUP} className="inline-block bg-white text-blue-700 font-bold rounded-full px-10 py-4 text-lg shadow-lg hover:bg-blue-50">
          無料ではじめる
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
