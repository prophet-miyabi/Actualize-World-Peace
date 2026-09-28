import type { PostInput, PostResult, SocialAccountRecord, TokenResult } from '../types';

// Facebook Pages API。ドキュメント: https://developers.facebook.com/docs/pages-api/posts
// account.accessToken にはページアクセストークン（ユーザートークンではない）を保存しておくこと。
// account.externalId にはページID（page_id）を保存しておくこと。
const API_VERSION = 'v25.0';

// OAuth（Facebook Login）。ドキュメント: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
// ログイン自体はユーザートークンを返すが、投稿にはページアクセストークンが必要なため、
// ログイン後に /me/accounts でユーザーが管理するページの一覧を取得し、先頭の1件を使う。
export function facebookAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: 'pages_manage_posts,pages_read_engagement,pages_show_list'
  });
  return `https://www.facebook.com/${API_VERSION}/dialog/oauth?${params}`;
}

export async function exchangeFacebookCode(code: string, clientId: string, clientSecret: string, redirectUri: string): Promise<TokenResult> {
  try {
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, client_secret: clientSecret, code });
    const tokenRes = await fetch(`https://graph.facebook.com/${API_VERSION}/oauth/access_token?${params}`);
    const tokenData: any = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData?.access_token) {
      return { ok: false, error: tokenData?.error?.message || `Facebookのトークン取得に失敗しました (${tokenRes.status})` };
    }

    const pagesRes = await fetch(`https://graph.facebook.com/${API_VERSION}/me/accounts?access_token=${encodeURIComponent(tokenData.access_token)}`);
    const pagesData: any = await pagesRes.json().catch(() => ({}));
    const page = pagesData?.data?.[0];
    if (!pagesRes.ok || !page) {
      return { ok: false, error: pagesData?.error?.message || '管理しているFacebookページが見つかりませんでした。ページの管理者になっているアカウントでログインしてください。' };
    }

    return { ok: true, accessToken: page.access_token, refreshToken: null, externalId: page.id, accountLabel: page.name || null, expiresAt: null };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}

export async function postToFacebookPage(account: SocialAccountRecord, input: PostInput): Promise<PostResult> {
  if (!account.externalId) return { ok: false, error: 'FacebookページIDが未設定です。' };

  try {
    // 画像がある場合は /photos（url + caption）、テキストのみの場合は /feed（message）を使う
    const path = input.mediaUrl ? 'photos' : 'feed';
    const params = new URLSearchParams({ access_token: account.accessToken });
    if (input.mediaUrl) {
      params.set('url', input.mediaUrl);
      params.set('caption', input.text);
    } else {
      params.set('message', input.text);
    }

    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${account.externalId}/${path}`, {
      method: 'POST',
      body: params
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) {
      return { ok: false, error: data?.error?.message || `Facebook API error (${res.status})` };
    }
    return { ok: true, postId: data.post_id || data.id };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}
