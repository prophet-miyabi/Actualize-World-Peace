import prisma from '../prisma';
import { captureError } from './errors';

// 通知の種類ごとの開き先（アプリ内の通知一覧から飛ぶ）
const HREF_BY_TYPE: Record<string, string> = { booking: '/bookings', order: '/orders', plan: '/plans', follow: '/me', post_like: '/me', comment: '/me', page_like: '/me' };

// 利用者に通知する: アプリ内の通知に残し、スマホアプリがあればプッシュも送る
export async function notifyUser(userId: string, title: string, body: string, data: Record<string, unknown> = {}) {
  const type = typeof data.type === 'string' ? data.type : 'system';
  const href = typeof data.href === 'string' ? data.href : HREF_BY_TYPE[type] ?? null;
  try {
    await prisma.notification.create({ data: { userId, type, title: title.slice(0, 120), body: body.slice(0, 300), href, actorId: typeof data.actorId === 'string' ? data.actorId : null } });
  } catch (e: any) {
    console.error('notification save failed', e?.message);
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { expoPushToken: true } });
  if (!user?.expoPushToken) return;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: user.expoPushToken, title, body: body.slice(0, 100), sound: 'default', data })
    });
    const json: any = await res.json().catch(() => ({}));
    const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data;
    // アプリが削除された端末には以後送らない
    if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
      await prisma.user.update({ where: { id: userId }, data: { expoPushToken: null } });
    }
  } catch (e: any) {
    console.error('push notification failed', e?.message);
    void captureError('push_notification', e, { userId });
  }
}
