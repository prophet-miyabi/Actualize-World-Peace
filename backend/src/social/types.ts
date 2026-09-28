export type Platform = 'x' | 'instagram' | 'facebook' | 'youtube' | 'tiktok';
export const PLATFORMS: Platform[] = ['x', 'instagram', 'facebook', 'youtube', 'tiktok'];

export type PostInput = { text: string; mediaUrl?: string | null };

export type PostResult = { ok: true; postId: string } | { ok: false; error: string };

export type SocialAccountRecord = {
  accessToken: string;
  refreshToken: string | null;
  externalId: string | null;
};

// OAuthの認可コードをアクセストークンに交換した結果
export type TokenResult =
  | { ok: true; accessToken: string; refreshToken: string | null; externalId: string | null; accountLabel: string | null; expiresAt: Date | null }
  | { ok: false; error: string };
