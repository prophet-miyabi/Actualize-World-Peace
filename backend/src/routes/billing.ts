import { Router } from 'express';
import Stripe from 'stripe';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { setupLineWebhook } from './lp';
import { submitLpToIndexNow } from '../seo/indexnow';

const router = Router();

// 無料お試し中にLINE情報を入力済みだった顧客について、有料プラン加入と同時にWebhookを有効化する
// （一度有効化していれば再度は呼ばない）
async function activatePendingLineWebhook(customerId: string) {
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  if (!user) return;
  const lineConfig = await prisma.lineConfig.findUnique({ where: { userId: user.id } });
  if (!lineConfig?.channelAccessToken || lineConfig.webhookActivated) return;
  try {
    const result = await setupLineWebhook(user.id, lineConfig.channelAccessToken);
    if (result.ok) await prisma.lineConfig.update({ where: { userId: user.id }, data: { webhookActivated: true } });
    else console.error('LINE webhook activation failed after payment', user.id, result.reason);
  } catch (e: any) {
    console.error('LINE webhook activation error after payment', user.id, e?.message);
  }
}

// 公開と同時に、検索エンジン（Bing・Yandex等、IndexNow対応先）へページの存在を知らせる
async function notifySearchEnginesForUser(customerId: string) {
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  if (!user) return;
  const lp = await prisma.landingPage.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
  if (!lp) return;
  const result = await submitLpToIndexNow(lp.slug);
  if (!result.ok) console.error('IndexNow submission failed after payment', user.id, result.reason);
}

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY が未設定です');
  return new Stripe(key);
}

// 現在の課金状況を返す（ダッシュボード表示用）
router.get('/status', authenticate, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  res.json({ subscriptionStatus: user?.subscriptionStatus ?? null });
});

// Stripe Checkout（月額サブスクリプション）を開始する
// カード情報はStripeの画面に入力されるため、このサーバーを一切通らない
router.post('/checkout', authenticate, async (req: AuthRequest, res) => {
  const priceId = process.env.STRIPE_PRICE_ID;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  if (!priceId) return res.status(400).json({ error: 'STRIPE_PRICE_ID が未設定です' });

  try {
    const stripe = getStripe();
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.name });
      customerId = customer.id;
      await prisma.user.update({ where: { id: user.id }, data: { stripeCustomerId: customerId } });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/dashboard?checkout=success`,
      cancel_url: `${frontendUrl}/billing?checkout=cancel`
    });
    res.json({ url: session.url });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// 支払い方法の変更・解約はStripeの管理ページ（Billing Portal）に任せる
router.get('/portal', authenticate, async (req: AuthRequest, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  try {
    const stripe = getStripe();
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.stripeCustomerId) return res.status(400).json({ error: 'まだ課金情報がありません' });

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${frontendUrl}/dashboard`
    });
    res.json({ url: session.url });
  } catch (e: any) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Stripeからのイベント通知（決済成功・解約など）
// 注意: このハンドラーはexpress.raw()で生のBodyを受け取る必要があるため、
// server.ts側でexpress.json()より前に個別マウントしている（stripeWebhookHandlerとして export）
export const stripeWebhookHandler = async (req: any, res: any) => {
  const sig = req.headers['stripe-signature'] as string | undefined;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || !sig) return res.status(400).send('Webhook not configured');

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  const obj: any = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      const customerId = obj.customer as string;
      const subscriptionId = obj.subscription as string;
      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: { stripeSubscriptionId: subscriptionId, subscriptionStatus: 'active' }
      });
      void activatePendingLineWebhook(customerId);
      void notifySearchEnginesForUser(customerId);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const customerId = obj.customer as string;
      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: { subscriptionStatus: obj.status } // active / past_due / canceled 等
      });
      if (obj.status === 'active') {
        void activatePendingLineWebhook(customerId);
        void notifySearchEnginesForUser(customerId);
      }
      break;
    }
  }
  res.json({ received: true });
};

export default router;
