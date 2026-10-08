import './globals.css';
import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import AppTabBar from '@/components/AppTabBar';

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

// SEO: 各ページのmetadataで相対パスの画像URLを使えるようにする（OG画像の解決に必要）
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'AWP', template: '%s' },
  robots: { index: true, follow: true },
  // iPhoneで「ホーム画面に追加」したとき、アプリのように全画面で開く
  appleWebApp: { capable: true, title: 'AWP', statusBarStyle: 'default' }
};

export const viewport: Viewport = {
  themeColor: '#7c3aed',
  viewportFit: 'cover'
};

// LPの書体（AIが選ぶ modern / elegant / friendly / bold に対応）とロゴの書体。
// 日本語フォントはビルド時にダウンロードすると数百ファイルになり、ビルドが不安定になる（取得失敗でビルドごと止まる）ため、
// 表示時に Google Fonts から読み込む（変数名は globals.css の --font-*-jp で定義）
const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;900&family=Noto+Serif+JP:wght@400;600;700&family=M+PLUS+Rounded+1c:wght@400;700;800&family=Outfit:wght@600;700&display=swap';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href={FONTS_URL} />
      </head>
      <body className="bg-gray-50 text-gray-900">
        {children}
        <Suspense fallback={null}>
          <AppTabBar />
        </Suspense>
      </body>
    </html>
  );
}
