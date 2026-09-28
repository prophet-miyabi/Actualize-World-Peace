import crypto from 'crypto';
import type { PostInput, PostResult, SocialAccountRecord, TokenResult } from '../types';

// OAuth 2.0 Authorization Code with PKCE。ドキュメント:
// https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// PKCEのcode_verifier/code_challengeを作る（毎回のログイン試行ごとに新しく作る）
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function xAuthorizeUrl(clientId: string, redirectUri: string, state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'tweet.read tweet.write users.read offline.access',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  return `https://x.com/i/oauth2/authorize?${params}`;
}

export async function exchangeXCode(code: string, codeVerifier: string, clientId: string, clientSecret: string, redirectUri: string): Promise<TokenResult> {
  try {
    // confidential client（サーバー側にclient_secretを持つアプリ）として、Basic認証で交換する
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const form = new URLSearchParams({ code, grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirectUri, code_verifier: codeVerifier });
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    const tokenData: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData?.access_token) {
      return { ok: false, error: tokenData?.error_description || tokenData?.error || `Xのトークン取得に失敗しました (${tokenRes.status})` };
    }
    const expiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;

    let externalId: string | null = null;
    let accountLabel: string | null = null;
    try {
      const meRes = await fetch('https://api.x.com/2/users/me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
      const meData: any = await meRes.json().catch(() => ({}));
      externalId = meData?.data?.id || null;
      accountLabel = meData?.data?.username ? `@${meData.data.username}` : null;
    } catch {
      // アカウント名の取得は失敗しても連携自体は続行する
    }

    return { ok: true, accessToken: tokenData.access_token, refreshToken: tokenData.refresh_token || null, externalId, accountLabel, expiresAt };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}

// X (旧Twitter) API v2。ドキュメント: https://docs.x.com/x-api/posts/creation-of-a-post
// 画像・動画付き投稿には事前のメディアアップロード（v1.1 media/upload、チャンク方式）が必要だが、
// ここではURL先の動画を都度アップロードする実装まではせず、テキストのみの投稿を先に成立させる。
// mediaUrlがある場合は「動画アップロードは未実装」であることを結果に明記する（黙って無視しない）。
export async function postToX(account: SocialAccountRecord, input: PostInput): Promise<PostResult> {
  if (input.mediaUrl) {
    return { ok: false, error: '動画付き投稿は未実装です（メディアアップロードのチャンク処理が必要）。テキストのみ対応しています。' };
  }
  try {
    const res = await fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text: input.text })
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.detail || data?.title || `X API error (${res.status})` };
    return { ok: true, postId: data?.data?.id };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}
