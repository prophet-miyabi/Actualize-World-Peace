import type { PostInput, PostResult, SocialAccountRecord, TokenResult } from '../types';

// Instagram Graph API（Instagram API with Instagram Login）。ドキュメント:
// https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
// 投稿の手順: ①メディアURLからコンテナを作成 → ②処理完了(FINISHED)を待つ → ③公開
// 画像（フィード）とリール（動画）の両方に対応し、メディアの種類はURLの中身から自動判定する
const API_VERSION = 'v21.0';
const G = `https://graph.instagram.com/${API_VERSION}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// OAuth（Instagram API with Instagram Login）。ドキュメント:
// https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
export function instagramAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights',
    state
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

export async function exchangeInstagramCode(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<TokenResult> {
  try {
    const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code });
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
    const tokenData: any = await tokenRes.json().catch(() => ({}));
    const shortToken = tokenData?.data?.[0]?.access_token || tokenData?.access_token;
    const igUserId = tokenData?.data?.[0]?.user_id || tokenData?.user_id;
    if (!tokenRes.ok || !shortToken) return { ok: false, error: tokenData?.error_message || `Instagramのトークン取得に失敗しました (${tokenRes.status})` };

    // 短期トークンを60日間有効な長期トークンに交換する
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(shortToken)}`
    );
    const longData: any = await longRes.json().catch(() => ({}));
    const accessToken = longRes.ok && longData?.access_token ? longData.access_token : shortToken;
    const expiresAt = longData?.expires_in ? new Date(Date.now() + longData.expires_in * 1000) : null;

    let accountLabel: string | null = null;
    try {
      const meRes = await fetch(`${G}/me?fields=username&access_token=${encodeURIComponent(accessToken)}`);
      const meData: any = await meRes.json().catch(() => ({}));
      accountLabel = meData?.username || null;
    } catch {
      // アカウント名の取得は失敗しても連携自体は続行する
    }

    return { ok: true, accessToken, refreshToken: null, externalId: igUserId ? String(igUserId) : null, accountLabel, expiresAt };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}

// 運営者が Meta for Developers で発行した長期トークンを、そのまま貼り付けて連携する（OAuthアプリの公開設定が不要）
export async function verifyInstagramToken(accessToken: string): Promise<TokenResult> {
  try {
    const res = await fetch(`${G}/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(accessToken)}`);
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok || !(d?.user_id || d?.id)) return { ok: false, error: d?.error?.message || `トークンを確認できませんでした (${res.status})` };
    return { ok: true, accessToken, refreshToken: null, externalId: String(d.user_id ?? d.id), accountLabel: d.username ?? null, expiresAt: new Date(Date.now() + 60 * 86_400_000) };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}

// 長期トークンの更新（60日で切れる。期限が近いときに呼ぶ）
export async function refreshInstagramToken(accessToken: string): Promise<{ ok: true; accessToken: string; expiresAt: Date } | { ok: false; error: string }> {
  try {
    const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(accessToken)}`);
    const d: any = await res.json().catch(() => ({}));
    if (!res.ok || !d?.access_token) return { ok: false, error: d?.error?.message || `更新に失敗しました (${res.status})` };
    return { ok: true, accessToken: d.access_token, expiresAt: new Date(Date.now() + (Number(d.expires_in) || 60 * 86_400) * 1000) };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}

// --- 読み取り（プロフィール・最近の投稿・インサイト） ----------------------------------------------

export type InstagramProfile = { id: string; username: string | null; name: string | null; followers: number | null; follows: number | null; mediaCount: number | null; pictureUrl: string | null; biography: string | null; website: string | null };

export async function instagramProfile(account: SocialAccountRecord): Promise<InstagramProfile | { error: string }> {
  const res = await fetch(`${G}/me?fields=user_id,username,name,followers_count,follows_count,media_count,profile_picture_url,biography,website&access_token=${encodeURIComponent(account.accessToken)}`);
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok) return { error: d?.error?.message || `プロフィールを取得できませんでした (${res.status})` };
  return { id: String(d.user_id ?? d.id ?? account.externalId), username: d.username ?? null, name: d.name ?? null, followers: d.followers_count ?? null, follows: d.follows_count ?? null, mediaCount: d.media_count ?? null, pictureUrl: d.profile_picture_url ?? null, biography: d.biography ?? null, website: d.website ?? null };
}

export type InstagramMedia = { id: string; caption: string; mediaType: string; mediaUrl: string | null; thumbnailUrl: string | null; permalink: string | null; timestamp: string | null; likes: number | null; comments: number | null };

export async function instagramRecentMedia(account: SocialAccountRecord, limit = 12): Promise<InstagramMedia[]> {
  const res = await fetch(`${G}/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=${limit}&access_token=${encodeURIComponent(account.accessToken)}`);
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(d?.data)) return [];
  return d.data.map((m: any) => ({ id: String(m.id), caption: String(m.caption ?? ''), mediaType: String(m.media_type ?? ''), mediaUrl: m.media_url ?? null, thumbnailUrl: m.thumbnail_url ?? null, permalink: m.permalink ?? null, timestamp: m.timestamp ?? null, likes: m.like_count ?? null, comments: m.comments_count ?? null }));
}

// アカウント全体のインサイト（直近7日）。取れない指標は無視する（アカウント種別・権限で変わるため）
export async function instagramInsights(account: SocialAccountRecord): Promise<Record<string, number>> {
  const until = Math.floor(Date.now() / 1000);
  const since = until - 7 * 86_400;
  const out: Record<string, number> = {};
  for (const metric of ['reach', 'profile_views', 'accounts_engaged', 'total_interactions']) {
    try {
      const res = await fetch(`${G}/me/insights?metric=${metric}&period=day&metric_type=total_value&since=${since}&until=${until}&access_token=${encodeURIComponent(account.accessToken)}`);
      const d: any = await res.json().catch(() => ({}));
      const v = d?.data?.[0]?.total_value?.value;
      if (res.ok && typeof v === 'number') out[metric] = v;
    } catch {
      // 取れない指標は飛ばす
    }
  }
  return out;
}

// --- 投稿 ----------------------------------------------------------------------------------------

async function waitContainer(containerId: string, accessToken: string, tries: number, intervalMs: number): Promise<string> {
  let status = 'IN_PROGRESS';
  for (let i = 0; i < tries && status !== 'FINISHED'; i++) {
    await sleep(intervalMs);
    const res = await fetch(`${G}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`);
    const d: any = await res.json().catch(() => ({}));
    status = d?.status_code || status;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error('メディアの処理に失敗しました（Instagram側）。画像・動画の形式や大きさを確認してください');
  }
  if (status !== 'FINISHED') throw new Error('メディアの処理が時間内に完了しませんでした。');
  return status;
}

async function publishContainer(account: SocialAccountRecord, containerId: string): Promise<PostResult> {
  const res = await fetch(`${G}/${account.externalId}/media_publish?` + new URLSearchParams({ creation_id: containerId, access_token: account.accessToken }), { method: 'POST' });
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok || !d?.id) return { ok: false, error: d?.error?.message || `公開に失敗しました (${res.status})` };
  return { ok: true, postId: String(d.id) };
}

async function createContainer(account: SocialAccountRecord, params: Record<string, string>): Promise<string> {
  const res = await fetch(`${G}/${account.externalId}/media?` + new URLSearchParams({ ...params, access_token: account.accessToken }), { method: 'POST' });
  const d: any = await res.json().catch(() => ({}));
  if (!res.ok || !d?.id) throw new Error(d?.error?.message || `コンテナ作成に失敗しました (${res.status})`);
  return String(d.id);
}

export async function postToInstagramReels(account: SocialAccountRecord, input: PostInput): Promise<PostResult> {
  if (!account.externalId) return { ok: false, error: 'InstagramビジネスアカウントIDが未設定です。' };
  if (!input.mediaUrl) return { ok: false, error: 'Instagram Reelsには動画（mediaUrl）が必須です。' };
  try {
    const containerId = await createContainer(account, { media_type: 'REELS', video_url: input.mediaUrl, caption: input.text });
    // 公式推奨: 1分おき、最大5分
    await waitContainer(containerId, account.accessToken, 5, 60_000);
    return await publishContainer(account, containerId);
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}

export async function postToInstagramImage(account: SocialAccountRecord, input: PostInput): Promise<PostResult> {
  if (!account.externalId) return { ok: false, error: 'InstagramビジネスアカウントIDが未設定です。' };
  if (!input.mediaUrl) return { ok: false, error: 'Instagramの投稿には画像（mediaUrl）が必須です。' };
  try {
    const containerId = await createContainer(account, { image_url: input.mediaUrl, caption: input.text });
    await waitContainer(containerId, account.accessToken, 12, 5_000);
    return await publishContainer(account, containerId);
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}

// メディアの種類（画像か動画か）をURLから判定する。拡張子が無いURL（AWPの /api/posts/:id/image 等）は Content-Type で見る
export async function detectMediaKind(url: string): Promise<'image' | 'video'> {
  if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) return 'video';
  if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) return 'image';
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const ct = res.headers.get('content-type') || '';
    if (ct.startsWith('video/')) return 'video';
  } catch {
    // 判定できなければ画像として扱う
  }
  return 'image';
}

export async function postToInstagram(account: SocialAccountRecord, input: PostInput): Promise<PostResult> {
  if (!input.mediaUrl) return { ok: false, error: 'Instagramの投稿には画像か動画（mediaUrl）が必須です。' };
  const kind = await detectMediaKind(input.mediaUrl);
  return kind === 'video' ? postToInstagramReels(account, input) : postToInstagramImage(account, input);
}
