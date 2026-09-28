// IndexNow: ページを公開・更新したことを検索エンジンに即座に知らせる仕組み。
// ドキュメント: https://www.indexnow.org/documentation
// Bing・Yandexなど対応エンジンに1回の送信で伝わる（Googleは現時点でIndexNowに参加していないため、
// Google向けには従来通りsitemap.xml経由でのクロールに任せる）。
// キーファイルは frontend/public/{INDEXNOW_KEY}.txt に置き、ドメイン直下で配信する。

export async function submitToIndexNow(urls: string[]): Promise<{ ok: boolean; reason?: string }> {
  const key = process.env.INDEXNOW_KEY;
  const siteUrl = process.env.SITE_URL;
  if (!key || !siteUrl) return { ok: false, reason: 'INDEXNOW_KEY / SITE_URL が未設定です' };
  if (urls.length === 0) return { ok: true };

  try {
    const host = new URL(siteUrl).host;
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host,
        key,
        keyLocation: `${siteUrl.replace(/\/$/, '')}/${key}.txt`,
        urlList: urls
      })
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text().catch(() => '');
      return { ok: false, reason: `IndexNow error (${res.status}): ${text}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

export async function submitLpToIndexNow(slug: string): Promise<{ ok: boolean; reason?: string }> {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) return { ok: false, reason: 'SITE_URL が未設定です' };
  return submitToIndexNow([`${siteUrl.replace(/\/$/, '')}/${slug}`]);
}
