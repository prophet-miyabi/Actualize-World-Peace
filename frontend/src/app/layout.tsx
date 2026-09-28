import './globals.css';
import type { Metadata } from 'next';
import { M_PLUS_Rounded_1c, Noto_Sans_JP, Noto_Serif_JP } from 'next/font/google';

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

// SEO: 各ページのmetadataで相対パスの画像URLを使えるようにする（OG画像の解決に必要）
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'AWP', template: '%s' },
  robots: { index: true, follow: true }
};

// LPの書体（AIが選ぶ modern / elegant / friendly / bold に対応）。
// 日本語フォントは容量が大きいため事前読み込みはせず、表示しながら読み込む。
const sans = Noto_Sans_JP({ subsets: ['latin'], weight: ['400', '500', '700', '900'], variable: '--font-sans-jp', display: 'swap', preload: false });
const serif = Noto_Serif_JP({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-serif-jp', display: 'swap', preload: false });
const rounded = M_PLUS_Rounded_1c({ subsets: ['latin'], weight: ['400', '700', '800'], variable: '--font-rounded-jp', display: 'swap', preload: false });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${sans.variable} ${serif.variable} ${rounded.variable}`}>
      <body className="bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
