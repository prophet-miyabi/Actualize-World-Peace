import type { MetadataRoute } from 'next';

// スマホの「ホーム画面に追加」で、アプリのように全画面で起動できるようにする
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AWP - Actualize World Peace',
    short_name: 'AWP',
    description: 'やりたいことを、スマホひとつで世界へ。AIと一緒にホームページをつくって、無料で公開。',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#7c3aed',
    lang: 'ja',
    icons: [
      { src: '/icon/192', sizes: '192x192', type: 'image/png' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
