import prisma from '../prisma';
import { OFFICIAL_USERNAME } from '../lib/official';
import { runwayConfigured, runwayReel } from './runway';

// リール（縦動画）の自動生成: Runway で画像 → 動画を作り、AWP の投稿（kind=reel）として保存する。
// 投稿先は AWP 公式アカウント（既定）または管理者本人。保存した投稿は
//   - AWP のタイムラインと公式ページの「最新の投稿」に出る
//   - /api/posts/:id/video の公開URLから Instagram（queue_instagram_post）にも流せる
export async function generateReelPost(input: { imagePrompt: string; motionPrompt: string; body: string; duration?: 5 | 10; to?: 'official' | string }): Promise<{ postId: string; videoUrl: string; seconds: number }> {
  if (!runwayConfigured()) throw new Error('RUNWAYML_API_SECRET が未設定のため、動画を生成できません（Render の環境変数に追加してください）');
  const username = !input.to || input.to === 'official' ? OFFICIAL_USERNAME : input.to;
  const user = await prisma.user.findFirst({ where: { username }, select: { id: true } });
  if (!user) throw new Error(`投稿先のアカウントが見つかりません: @${username}`);
  const style = 'Vertical 9:16 composition for a social media reel. No text, no letters, no logos, no watermarks, no close-up faces. ';
  const { image, video } = await runwayReel(style + input.imagePrompt, input.motionPrompt || 'slow cinematic camera push-in, soft natural light, gentle motion', input.duration ?? 5);
  const post = await prisma.post.create({
    data: { userId: user.id, body: input.body.slice(0, 500), kind: 'reel', image: image.data, imageType: image.mimeType, video: video.data, videoType: video.mimeType, videoSize: video.data.length },
    select: { id: true }
  });
  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return { postId: post.id, videoUrl: `${base}/api/posts/${post.id}/video`, seconds: video.seconds };
}
