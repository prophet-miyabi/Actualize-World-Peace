import type { PostInput, PostResult, SocialAccountRecord } from '../types';

// YouTube Data API v3（再開可能アップロード）。
// ドキュメント: https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
// 手順: ①メタデータをPOSTしてアップロード先URLを取得 → ②動画バイト列をPUT
export async function postToYouTubeShorts(account: SocialAccountRecord, input: PostInput): Promise<PostResult> {
  if (!input.mediaUrl) return { ok: false, error: 'YouTube Shortsには動画（mediaUrl）が必須です。' };

  try {
    const videoRes = await fetch(input.mediaUrl);
    if (!videoRes.ok || !videoRes.body) return { ok: false, error: '動画ファイルの取得に失敗しました。' };
    const contentLength = videoRes.headers.get('content-length');
    const contentType = videoRes.headers.get('content-type') || 'video/*';
    if (!contentLength) return { ok: false, error: '動画ファイルのサイズを取得できませんでした。' };

    // ① アップロードセッションの開始
    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': contentLength,
          'X-Upload-Content-Type': contentType
        },
        body: JSON.stringify({
          // タイトルの先頭に #Shorts を含めることで、YouTube側にShortsとして認識させる
          snippet: { title: `${input.text.slice(0, 90)} #Shorts`.trim(), description: input.text },
          status: { privacyStatus: 'public' }
        })
      }
    );
    const uploadUrl = initRes.headers.get('location');
    if (!initRes.ok || !uploadUrl) {
      const err: any = await initRes.json().catch(() => ({}));
      return { ok: false, error: err?.error?.message || `アップロードセッションの作成に失敗しました (${initRes.status})` };
    }

    // ② 動画本体のアップロード
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Length': contentLength, 'Content-Type': contentType },
      body: videoRes.body,
      // @ts-expect-error Node18+のfetchでストリームボディを送るために必要
      duplex: 'half'
    });
    const uploaded: any = await uploadRes.json().catch(() => ({}));
    if (!uploadRes.ok || !uploaded?.id) {
      return { ok: false, error: uploaded?.error?.message || `動画のアップロードに失敗しました (${uploadRes.status})` };
    }
    return { ok: true, postId: uploaded.id };
  } catch (e: any) {
    return { ok: false, error: String(e.message || e) };
  }
}
