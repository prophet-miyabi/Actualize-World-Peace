import type { MetadataRoute } from 'next';

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

// 管理画面・API・支払い関連ページはクロール対象から外し、公開LPと紹介ページだけを見せる
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/wizard', '/billing', '/admin', '/domain', '/features', '/social', '/preview', '/dev-login', '/api/', '/reserve/', '/bookings', '/products', '/wallet', '/analytics', '/builder', '/profile', '/order/', '/orders', '/shop-settings', '/plans']
    },
    sitemap: `${SITE_URL}/sitemap.xml`
  };
}
