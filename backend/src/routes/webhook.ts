import { Router } from 'express';
import crypto from 'crypto';
import { messagingApi, WebhookEvent } from '@line/bot-sdk';
import prisma from '../prisma';
import { fallbackReply, generateLineReply } from '../ai/lineReply';

const router = Router();

// LINEからの正規リクエストであることを確認する（署名検証なしだと、
// 誰でも他人のテナントIDにでたらめなイベントを送りつけられてしまう）
function verifySignature(channelSecret: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature || !rawBody) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64'));
  const actual = Buffer.from(signature);
  // timingSafeEqualは長さが違うと例外を投げる（=不正な署名でサーバーが落ちる）ため、先に長さを比べる
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// 新着問い合わせを、店主のスマホアプリへプッシュ通知する（Expo Push API）
async function notifyOwner(tenantId: string, message: string) {
  const user = await prisma.user.findUnique({ where: { id: tenantId }, select: { expoPushToken: true } });
  if (!user?.expoPushToken) return;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: user.expoPushToken,
        title: '新しいお問い合わせ',
        body: message.slice(0, 100),
        sound: 'default',
        data: { type: 'inquiry' }
      })
    });
    const json: any = await res.json().catch(() => ({}));
    const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data;
    // アプリが削除された端末には以後送らない
    if (ticket?.status === 'error' && ticket?.details?.error === 'DeviceNotRegistered') {
      await prisma.user.update({ where: { id: tenantId }, data: { expoPushToken: null } });
    }
  } catch (e: any) {
    console.error('push notification failed', e?.message);
  }
}

// テナントごとのLINE Webhook受け口（マルチテナントL-Harness運用基盤）
// 注意: このルートはexpress.json()より前に、生のBodyを保持するミドルウェアで
// マウントする必要がある（server.ts側でverify関数を使いrawBodyを保存する想定）
router.post('/:tenantId', async (req: any, res) => {
  const tenantId = req.params.tenantId;
  const config = await prisma.lineConfig.findUnique({ where: { userId: tenantId } });
  // LINEをまだ持っていない（無料お試し中の）顧客はチャンネル情報が未設定のため、Webhookも受け付けない
  if (!config?.channelSecret || !config.channelAccessToken) return res.status(404).send('Not found');

  const signature = req.headers['x-line-signature'] as string | undefined;
  if (!verifySignature(config.channelSecret, req.rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }

  const client = new messagingApi.MessagingApiClient({ channelAccessToken: config.channelAccessToken });
  const events: WebhookEvent[] = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      // source.userIdはグループ/ルームからの送信では存在しないことがある
      const senderName = 'userId' in event.source ? event.source.userId ?? 'Guest' : 'Guest';
      // 問い合わせをDBに保存
      await prisma.inquiry.create({
        data: { tenantId, senderName, message: event.message.text, source: 'LINE' }
      });
      // 自動応答メッセージ（失敗しても問い合わせの保存・店主への通知・LINEへの応答は止めない）
      try {
        const lp = await prisma.landingPage.findFirst({ where: { userId: tenantId } });
        const replyText = lp ? await generateLineReply(lp, event.message.text) : fallbackReply(event.message.text);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: replyText }]
        });
      } catch (e: any) {
        console.error('LINE auto-reply failed', tenantId, e?.message);
      }
      // 通知は応答を遅らせないよう待たない
      void notifyOwner(tenantId, event.message.text);
    }
    if (event.type === 'follow') {
      await prisma.lineConfig.update({ where: { id: config.id }, data: { friendsAdded: { increment: 1 } } });
    }
  }
  res.status(200).end();
});

export default router;
