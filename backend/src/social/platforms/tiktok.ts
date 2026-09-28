import type { PostInput, PostResult, SocialAccountRecord, TokenResult } from '../types';

// OAuth（TikTok Login Kit）。ドキュメント: https://developers.tiktok.com/doc/login-kit-web
export function tiktokAuthorizeUrl(clientKey: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope: 'user.info.basic,video.publish',
    redirect_uri: redirectUri,
    state
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

export async function exchangeTikTokCode(code: string, clientKey: string, clientSecret: string, redirectUri: string): Promise<TokenResult> {
  try {
    const form = new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    const tokenData: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData?.access_token) {
      return { ok: false, error: tokenData?.error_description || `TikTokのトークン取得に失敗しました (${tokenRes.status})` };
    }
    const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;
    return { ok: true, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || null, externalId: tokenData.open_id || null, accountLabel: null, expiresAt };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}

// TikTok Content Posting API（直接投稿・PULL_FROM_URL方式）。
// ドキュメント: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
// 動画をこちらのサーバーにアップロードさせず、URLを渡して先方に取得させる方式（実装が簡単なため採用）。
// 注意: 投稿後の状態確認（publish_status/fetch）は現時点で公式ドキュメントの参照ページが見つからず未検証。
// init が成功した時点で「投稿を受け付けた」ことは確定するため、ここではそれをもって成功とする。
export async function postToTikTok(account: SocialAccountRecord, input: PostInput): Promise<PostResult> {
  if (!input.mediaUrl) return { ok: false, error: 'TikTokには動画（mediaUrl）が必須です。' };

  try {
    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8'
      },
      body: JSON.stringify({
        post_info: { title: input.text.slice(0, 2200), privacy_level: 'PUBLIC_TO_EVERYONE' },
        source_info: { source: 'PULL_FROM_URL', video_url: input.mediaUrl }
      })
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.error?.code !== 'ok') {
      return { ok: false, error: data?.error?.message || `TikTok API error (${res.status})` };
    }
    return { ok: true, postId: data?.data?.publish_id };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}
