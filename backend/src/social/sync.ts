// 外部SNS（Instagram / X / TikTok）の投稿を AWP の投稿（Post）として取り込む。
// 取り込んだ投稿は source / externalId / externalUrl を持ち、同じ投稿は二重に作らない。
// 画像は 3MB まで本体を保存（フィードとページに出す）。動画は本体を保存せず、サムネイルと元URLを持つ。
// 連携トークンが切れている場合は SocialAccount.status を expired にし、画面と運営オフィスの警報で分かるようにする。
import prisma from '../prisma';
import { instagramRecentMedia } from './platforms/instagram';
import type { Platform, SocialAccountRecord } from './types';
import { safeExternalFetch } from '../automation/awpDataAssetEngine';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export type ExternalItem = { externalId: string; text: string; url: string | null; imageUrl: string | null; isVideo: boolean; postedAt: Date | null };

async function fetchJson(url: string, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    // 公式 API のホストだけに通信する（safeExternalFetch が他のホストを遮断する）
    const res = await safeExternalFetch(url, { ...init, signal: ctrl.signal });
    const data: any = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally { clearTimeout(t); }
}

// X API v2: 自分の最近の投稿（tweet.read / users.read のスコープが必要）
export async function xRecentPosts(account: SocialAccountRecord, limit = 20): Promise<ExternalItem[] | { error: string }> {
  const h = { Authorization: `Bearer ${account.accessToken}` };
  let uid = account.externalId;
  if (!uid) {
    const me = await fetchJson('https://api.x.com/2/users/me', { headers: h });
    if (!me.ok) return { error: me.data?.detail || me.data?.title || `X API error (${me.status})` };
    uid = String(me.data?.data?.id ?? '');
  }
  const q = `max_results=${Math.min(100, Math.max(5, limit))}&tweet.fields=created_at,attachments,entities&expansions=attachments.media_keys&media.fields=url,preview_image_url,type&exclude=retweets,replies`;
  const r = await fetchJson(`https://api.x.com/2/users/${uid}/tweets?${q}`, { headers: h });
  if (!r.ok) return { error: r.data?.detail || r.data?.title || `X API error (${r.status})` };
  const media = new Map<string, any>(((r.data?.includes?.media as any[]) ?? []).map((m) => [m.media_key, m]));
  const username = account.externalId ? null : r.data?.includes?.users?.[0]?.username ?? null;
  return ((r.data?.data as any[]) ?? []).map((t) => {
    const keys: string[] = t.attachments?.media_keys ?? [];
    const first = keys.map((k) => media.get(k)).find(Boolean);
    return {
      externalId: String(t.id), text: String(t.text ?? ''), url: `https://x.com/${username ?? 'i'}/status/${t.id}`,
      imageUrl: first ? (first.type === 'photo' ? first.url : first.preview_image_url) ?? null : null, isVideo: !!first && first.type !== 'photo',
      postedAt: t.created_at ? new Date(t.created_at) : null
    };
  });
}

// TikTok Display API: 自分の動画一覧（video.list のスコープが必要）
export async function tiktokRecentVideos(account: SocialAccountRecord, limit = 20): Promise<ExternalItem[] | { error: string }> {
  const r = await fetchJson('https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,cover_image_url,share_url,create_time', {
    method: 'POST', headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ max_count: Math.min(20, limit) })
  });
  if (!r.ok || (r.data?.error?.code && r.data.error.code !== 'ok')) return { error: r.data?.error?.message || `TikTok API error (${r.status})` };
  return ((r.data?.data?.videos as any[]) ?? []).map((v) => ({
    externalId: String(v.id), text: String(v.video_description ?? v.title ?? ''), url: v.share_url ?? null, imageUrl: v.cover_image_url ?? null, isVideo: true,
    postedAt: v.create_time ? new Date(Number(v.create_time) * 1000) : null
  }));
}

async function instagramItems(account: SocialAccountRecord, limit: number): Promise<ExternalItem[] | { error: string }> {
  const media = await instagramRecentMedia(account, limit);
  return media.map((m) => ({
    externalId: m.id, text: m.caption, url: m.permalink, imageUrl: m.mediaType === 'VIDEO' ? m.thumbnailUrl : m.mediaUrl, isVideo: m.mediaType === 'VIDEO',
    postedAt: m.timestamp ? new Date(m.timestamp) : null
  }));
}

async function downloadImage(url: string): Promise<{ data: Buffer; type: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return { data: buf, type };
  } catch { return null; }
}

const isAuthError = (msg: string) => /401|403|token|expired|invalid|unauthor/i.test(msg);

export type SyncResult = { platform: Platform; imported: number; skipped: number; error: string | null };

// 1アカウント分を取り込む。戻り値は画面表示用のまとめ
export async function syncAccount(userId: string, platform: Platform, limit = 20): Promise<SyncResult> {
  const account = await prisma.socialAccount.findUnique({ where: { userId_platform: { userId, platform } } });
  if (!account) return { platform, imported: 0, skipped: 0, error: 'このアカウントは連携されていません' };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (!user?.username) return { platform, imported: 0, skipped: 0, error: '取り込むには、先にプロフィールでユーザー名を決めてください' };

  let items: ExternalItem[] | { error: string };
  if (platform === 'instagram') items = await instagramItems(account, limit);
  else if (platform === 'x') items = await xRecentPosts(account, limit);
  else if (platform === 'tiktok') items = await tiktokRecentVideos(account, limit);
  else items = { error: 'このプラットフォームの取り込みは未対応です' };

  if (!Array.isArray(items)) {
    await prisma.socialAccount.update({ where: { id: account.id }, data: { lastError: items.error.slice(0, 500), status: isAuthError(items.error) ? 'expired' : 'error' } });
    await prisma.companyEvent.create({ data: { type: 'social.sync.failed', actor: 'social', payload: { userId, platform, error: items.error.slice(0, 300) } as any } }).catch(() => {});
    return { platform, imported: 0, skipped: 0, error: items.error };
  }

  let imported = 0, skipped = 0;
  for (const it of items) {
    if (!it.externalId) continue;
    const exists = await prisma.post.findFirst({ where: { userId, source: platform, externalId: it.externalId }, select: { id: true } });
    if (exists) { skipped++; continue; }
    const img = it.imageUrl ? await downloadImage(it.imageUrl) : null;
    const body = it.text.trim().slice(0, 2000) || (it.isVideo ? `${platform} の動画` : '');
    if (!body && !img) { skipped++; continue; }
    await prisma.post.create({ data: {
      userId, body, image: img?.data ?? null, imageType: img?.type ?? null, kind: it.isVideo ? 'reel' : 'post',
      source: platform, externalId: it.externalId, externalUrl: it.url, createdAt: it.postedAt ?? new Date()
    } });
    imported++;
  }
  await prisma.socialAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date(), lastError: null, status: 'connected' } });
  await prisma.companyEvent.create({ data: { type: 'social.sync.done', actor: 'social', payload: { userId, platform, imported, skipped } as any } }).catch(() => {});
  return { platform, imported, skipped, error: null };
}

// 自動取り込みがオンのアカウントをまとめて同期（スケジューラから1時間ごとに呼ぶ）
export async function syncAllEnabled() {
  const accounts = await prisma.socialAccount.findMany({ where: { syncEnabled: true, platform: { in: ['instagram', 'x', 'tiktok'] } }, select: { userId: true, platform: true } });
  for (const a of accounts) {
    await syncAccount(a.userId, a.platform as Platform, 12).catch((e) => console.error('social sync failed', a.platform, e?.message));
  }
  return accounts.length;
}
