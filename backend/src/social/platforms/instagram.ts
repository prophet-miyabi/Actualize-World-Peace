import type { PostInput, PostResult, SocialAccountRecord, TokenResult } from '../types';

// Instagram Graph API（Reels）。ドキュメント:
// https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
// 手順: ①動画URLからコンテナを作成 → ②処理完了(FINISHED)を待つ → ③公開
const API_VERSION = 'v21.0';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// OAuth（Instagram API with Instagram Login）。ドキュメント:
// https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
export function instagramAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_content_publish',
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
      const meRes = await fetch(`https://graph.instagram.com/${API_VERSION}/me?fields=username&access_token=${encodeURIComponent(accessToken)}`);
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

export async function postToInstagramReels(account: SocialAccountRecord, input: PostInput): Promise<PostResult> {
  if (!account.externalId) return { ok: false, error: 'InstagramビジネスアカウントIDが未設定です。' };
  if (!input.mediaUrl) return { ok: false, error: 'Instagram Reelsには動画（mediaUrl）が必須です。' };

  try {
    // ① コンテナ作成
    const createRes = await fetch(
      `https://graph.instagram.com/${API_VERSION}/${account.externalId}/media?` +
        new URLSearchParams({
          media_type: 'REELS',
          video_url: input.mediaUrl,
          caption: input.text,
          access_token: account.accessToken
        }),
      { method: 'POST' }
    );
    const created: any = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !created?.id) {
      return { ok: false, error: created?.error?.message || `コンテナ作成に失敗しました (${createRes.status})` };
    }
    const containerId = created.id;

    // ② 処理完了を待つ（公式推奨: 1分おき、最大5分）
    let status = 'IN_PROGRESS';
    for (let i = 0; i < 5 && status !== 'FINISHED'; i++) {
      await sleep(60_000);
      const statusRes = await fetch(
        `https://graph.instagram.com/${API_VERSION}/${containerId}?fields=status_code&access_token=${account.accessToken}`
      );
      const statusData: any = await statusRes.json().catch(() => ({}));
      status = statusData?.status_code || status;
      if (status === 'ERROR') return { ok: false, error: '動画の処理中にエラーが発生しました（Instagram側）。' };
    }
    if (status !== 'FINISHED') return { ok: false, error: '動画の処理が時間内に完了しませんでした。' };

    // ③ 公開
    const publishRes = await fetch(
      `https://graph.instagram.com/${API_VERSION}/${account.externalId}/media_publish?` +
        new URLSearchParams({ creation_id: containerId, access_token: account.accessToken }),
      { method: 'POST' }
    );
    const published: any = await publishRes.json().catch(() => ({}));
    if (!publishRes.ok || !published?.id) {
      return { ok: false, error: published?.error?.message || `公開に失敗しました (${publishRes.status})` };
    }
    return { ok: true, postId: published.id };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}
