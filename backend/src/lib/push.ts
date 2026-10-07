import prisma from '../prisma';
import { captureError } from './errors';

// 持ち主のスマホアプリへプッシュ通知する（Expo Push API）。アプリ未導入・通知未許可なら何もしない
export async function notifyUser(userId: string, title: string, body: string, data: Record<string, unknown> = {}) {
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
