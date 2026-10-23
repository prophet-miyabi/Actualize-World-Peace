import { Router } from 'express';
import crypto from 'crypto';
import { messagingApi, WebhookEvent } from '@line/bot-sdk';
import prisma from '../prisma';
import { fallbackReply, generateLineReply } from '../ai/lineReply';
import { captureError } from '../lib/errors';
import { notifyUser } from '../lib/push';
import { aiQuota, runAsUser } from '../lib/aiUsage';
import { industryOfUser, recordCommercialIntelligence } from '../automation/awpDataAssetEngine';
import { addTag, enroll, matchGate, onLineFollow, onLineUnfollow, surveyHooks, touchContact, upsertContact } from '../automation/harnessEngine';
import { replySpec } from '../line/send';
import { answerSurvey, startSurvey } from '../crm/surveys';

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

// 新着問い合わせを、店主のスマホアプリへプッシュ通知する
const notifyOwner = (tenantId: string, message: string) => notifyUser(tenantId, '新しいお問い合わせ', message, { type: 'inquiry' });

// Webhook の受け口は 2 種類: /api/webhook/<CrmLineAccount.id>（複数アカウント）と /api/webhook/<userId>（旧 LineConfig）
async function resolveAccount(param: string): Promise<{ ownerId: string; accountId: string | null; channelSecret: string; channelAccessToken: string } | null> {
  const acc = await prisma.crmLineAccount.findUnique({ where: { id: param } });
  if (acc && acc.active) return { ownerId: acc.ownerId, accountId: acc.id, channelSecret: acc.channelSecret, channelAccessToken: acc.channelAccessToken };
  const config = await prisma.lineConfig.findUnique({ where: { userId: param } });
  if (config?.channelSecret && config.channelAccessToken) return { ownerId: param, accountId: null, channelSecret: config.channelSecret, channelAccessToken: config.channelAccessToken };
  return null;
}

async function profileName(client: messagingApi.MessagingApiClient, userId: string | null) {
  if (!userId) return null;
  try { return (await client.getProfile(userId)).displayName; } catch { return null; }
}

// テナントごとのLINE Webhook受け口（マルチテナントL-Harness運用基盤）
// 注意: このルートはexpress.json()より前に、生のBodyを保持するミドルウェアで
// マウントする必要がある（server.ts側でverify関数を使いrawBodyを保存する想定）
router.post('/:tenantId', async (req: any, res) => {
  const acc = await resolveAccount(String(req.params.tenantId));
  // LINEをまだ持っていない（無料お試し中の）顧客はチャンネル情報が未設定のため、Webhookも受け付けない
  if (!acc) return res.status(404).send('Not found');
  const tenantId = acc.ownerId;

  const signature = req.headers['x-line-signature'] as string | undefined;
  if (!verifySignature(acc.channelSecret, req.rawBody, signature)) {
    return res.status(401).send('Invalid signature');
  }

  const client = new messagingApi.MessagingApiClient({ channelAccessToken: acc.channelAccessToken });
  const account = { id: acc.accountId ?? tenantId, channelAccessToken: acc.channelAccessToken };
  const events: WebhookEvent[] = req.body.events;

  for (const event of events) {
    const lineUserId = 'userId' in event.source ? event.source.userId ?? null : null;

    if (event.type === 'message' && event.message.type === 'text') {
      // source.userIdはグループ/ルームからの送信では存在しないことがある
      const senderName = lineUserId ?? 'Guest';
      const text = event.message.text;
      // 問い合わせをDBに保存
      await prisma.inquiry.create({ data: { tenantId, senderName, message: text, source: 'LINE' } });
      let gateHit = false;
      try {
        // 顧客と受信箱: 受信を会話ログに残す（名前は LINE のプロフィールから）
        const contact = lineUserId ? await upsertContact(tenantId, 'line', lineUserId, await profileName(client, lineUserId)) : null;
        if (contact) {
          await prisma.crmMessage.create({ data: { ownerId: tenantId, contactId: contact.id, lineAccountId: acc.accountId, direction: 'in', kind: 'text', text: text.slice(0, 2000), status: 'received' } });
          await prisma.crmContact.update({ where: { id: contact.id }, data: { unreadCount: { increment: 1 }, lastInboundAt: new Date(), lastSeenAt: new Date(), blocked: false, ...(acc.accountId ? { lineAccountId: acc.accountId } : {}) } });
          // 進行中のアンケートへの自由入力は、選択肢の文字と一致すれば回答として扱う
          const open = await prisma.crmSurveyAnswer.findFirst({ where: { contactId: contact.id, completedAt: null }, include: { survey: true }, orderBy: { updatedAt: 'desc' } });
          if (open && open.survey.active) {
            const qs = open.survey.questions as { options: { label: string; value: string }[] }[];
            const q = qs[open.currentIdx];
            const idx = q?.options.findIndex((o) => o.label === text.trim() || o.value === text.trim()) ?? -1;
            if (idx >= 0) {
              await answerSurvey(tenantId, open.surveyId, open.currentIdx, idx, contact, event.replyToken, surveyHooks);
              continue;
            }
          }
        }
        // Harness のエンゲージメントゲート: キーワードに当たれば、その返信（クロスUUID付きリンク・ボタン）を優先し、シナリオ・アンケートに登録する
        const hit = lineUserId ? await matchGate(tenantId, 'line', lineUserId, text, contact?.displayName ?? null).catch(() => null) : null;
        gateHit = !!hit;
        if (hit && contact) {
          await replySpec(tenantId, account, event.replyToken, contact, hit.spec, { kind: 'gate', refId: hit.gate.id, vars: { link: hit.link } });
          if (hit.gate.surveyId) await startSurvey(tenantId, hit.gate.surveyId, contact, null, surveyHooks);
        } else {
          const lp = await prisma.landingPage.findFirst({ where: { userId: tenantId } });
          // AWPの自動応答は持ち主の intelligence 利用枠を使う。枠を使い切っていたら、定型の応答にする
          const canUseAi = lp && !(await aiQuota(tenantId)).exceeded;
          const replyText = canUseAi ? await runAsUser(tenantId, 'line_reply', () => generateLineReply(lp, text)) : fallbackReply(text);
          if (contact) await replySpec(tenantId, account, event.replyToken, contact, { kind: 'text', text: replyText }, { kind: 'awp' });
          else await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: replyText }] });
        }
      } catch (e: any) {
        console.error('LINE auto-reply failed', tenantId, e?.message);
        void captureError('line_auto_reply', e, { tenantId });
      }
      // 通知は応答を遅らせないよう待たない
      void notifyOwner(tenantId, text);
      // 匿名のデータレイク: LINE での反応。本文は保存せず、定型のキーワードに当たったものだけを残す
      const kw = ['予約', '料金', '詳細', '場所', 'メニュー', '空き', '相談'].find((k) => text.includes(k)) ?? null;
      if (!gateHit) void industryOfUser(tenantId).then((industryKey) => recordCommercialIntelligence({ industryKey, channel: 'line', funnelStage: 'gate_dm', converted: !!kw, triggerKeyword: kw }));
      continue;
    }

    if (event.type === 'message' && lineUserId) {
      // 画像・スタンプ・位置情報なども受信箱に残す（本体は保存しない）
      try {
        const contact = await upsertContact(tenantId, 'line', lineUserId);
        await prisma.crmMessage.create({ data: { ownerId: tenantId, contactId: contact.id, lineAccountId: acc.accountId, direction: 'in', kind: event.message.type, text: null, payload: { messageId: (event.message as any).id } as any, status: 'received' } });
        await prisma.crmContact.update({ where: { id: contact.id }, data: { unreadCount: { increment: 1 }, lastInboundAt: new Date(), lastSeenAt: new Date() } });
      } catch (e: any) { console.error('LINE inbound log failed', e?.message); }
      continue;
    }

    if (event.type === 'postback' && lineUserId) {
      // ボタン・クイックリプライの動作: awp:tag:<name> / awp:enroll:<scenarioId> / awp:survey:<id>:start / awp:survey:<id>:<q>:<opt>
      try {
        const contact = await upsertContact(tenantId, 'line', lineUserId, await profileName(client, lineUserId));
        const parts = String(event.postback.data || '').split(':');
        if (parts[0] !== 'awp') continue;
        if (parts[1] === 'tag' && parts[2]) {
          await addTag(tenantId, contact.id, parts.slice(2).join(':'));
          await touchContact(contact.id, 'button', 'line', { tag: parts.slice(2).join(':') }, 5);
          await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '承りました。' }] }).catch(() => {});
        } else if (parts[1] === 'enroll' && parts[2]) {
          await enroll(parts[2], contact.id).catch(() => {});
          await touchContact(contact.id, 'button', 'line', { scenarioId: parts[2] }, 5);
          await client.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'ご案内をお送りします。' }] }).catch(() => {});
        } else if (parts[1] === 'survey' && parts[2]) {
          if (parts[3] === 'start') await startSurvey(tenantId, parts[2], contact, event.replyToken, surveyHooks);
          else await answerSurvey(tenantId, parts[2], Number(parts[3]), Number(parts[4]), contact, event.replyToken, surveyHooks);
        }
      } catch (e: any) { console.error('LINE postback failed', e?.message); void captureError('line_postback', e, { tenantId }); }
      continue;
    }

    if (event.type === 'follow') {
      if (acc.accountId) await prisma.crmLineAccount.update({ where: { id: acc.accountId }, data: { friendsAdded: { increment: 1 } } }).catch(() => {});
      else await prisma.lineConfig.update({ where: { userId: tenantId }, data: { friendsAdded: { increment: 1 } } }).catch(() => {});
      // Harness: 顧客を作り、「友だち追加」トリガーのステップ配信に登録する
      if (lineUserId) void onLineFollow(tenantId, lineUserId, acc.accountId, await profileName(client, lineUserId)).catch((e) => console.error('harness follow failed', e?.message));
      void industryOfUser(tenantId).then((industryKey) => recordCommercialIntelligence({ industryKey, channel: 'line', funnelStage: 'step_message', converted: true, triggerKeyword: 'follow' }));
      continue;
    }

    if (event.type === 'unfollow' && lineUserId) {
      void onLineUnfollow(tenantId, lineUserId).catch(() => {});
    }
  }
  res.status(200).end();
});

export default router;
