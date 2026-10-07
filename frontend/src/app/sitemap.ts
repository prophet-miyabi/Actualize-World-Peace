import type { MetadataRoute } from 'next';

const API = process.env.API_INTERNAL_URL || 'http://localhost:8000/api';
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';

// 公開されている顧客ページを含めたサイトマップを自動生成する（/sitemap.xml）。
// 新しいページが公開されるたびに、手作業なしで検索エンジンに見つけてもらえるようにする
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/login`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/discover`, changeFrequency: 'daily', priority: 0.7 }
  ];

  // 公開中のプロフィール（/ユーザー名）。取れなくてもページ側のサイトマップは出す
  let profiles: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(`${API}/community/public-profiles`, { cache: 'no-store' });
    if (res.ok) {
      const { usernames } = (await res.json()) as { usernames: string[] };
      profiles = usernames.map((u) => ({ url: `${SITE_URL}/${u}`, changeFrequency: 'weekly', priority: 0.6 }));
    }
  } catch {
    // 無視
  }

  try {
    const res = await fetch(`${API}/lp/public-slugs`, { cache: 'no-store' });
    if (!res.ok) return [...staticPages, ...profiles];
    const { pages } = (await res.json()) as { pages: { slug: string; updatedAt: string }[] };
    const lpPages: MetadataRoute.Sitemap = pages.map((p) => ({
      url: `${SITE_URL}/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.8
    }));
    return [...staticPages, ...lpPages, ...profiles];
  } catch {
    return [...staticPages, ...profiles];
  }
}
