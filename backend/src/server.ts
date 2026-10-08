// .envは他のどのモジュールよりも先に読み込む（JWT_SECRET等をimport時に参照するため）
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import lpRoutes from './routes/lp';
import webhookRoutes from './routes/webhook';
import billingRoutes, { stripeWebhookHandler } from './routes/billing';
import socialRoutes from './routes/social';
import siteAssetRoutes from './routes/siteAssets';
import agentRoutes from './routes/agents';
import automationRoutes from './routes/automation';
import monitoringRoutes from './routes/monitoring';
import photoRoutes from './routes/photos';
import reportRoutes from './routes/reports';
import toolRoutes from './routes/tools';
import exportRoutes from './routes/export';
import harnessRoutes from './routes/harness';
import opsRoutes from './routes/ops';
import communityRoutes from './routes/community';
import builderRoutes from './routes/builder';
import walletRoutes from './routes/wallet';
import chatbotRoutes from './routes/chatbot';
import bookingRoutes from './routes/bookings';
import productRoutes from './routes/products';
import postRoutes from './routes/posts';
import harnessLinkRoutes from './routes/harnessLink';
import crewRoutes, { discordInteractions } from './routes/crew';
import planRoutes from './routes/plans';
import shopRoutes, { sweepOrders } from './routes/shop';
import companyRoutes from './routes/company';
import { startCompany } from './company/loop';
import { startCrew } from './crew/orchestrator';
import { startScheduler } from './social/scheduler';
import { startAgentLoop } from './agents/loop';
import { captureError } from './lib/errors';
import { anthropicKeyProblem } from './lib/aiUsage';

const app = express();
app.use(cors());

// LINEのWebhookは「JSONとして読みつつ生のBodyも保持」する必要がある（署名検証用）
app.use(
  '/api/webhook',
  express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }),
  webhookRoutes
);

// Discord の Interactions は署名検証に生のBodyが必要
app.post('/api/crew/discord/interactions', express.raw({ type: 'application/json' }), discordInteractions);

// Stripeは生のBufferのみで良い（SDKがそこから直接検証・パースする）
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

// 既定は100kbだが、写真アップロード（backend/src/routes/photos.ts）はbase64化した画像を
// JSONで受け取るため、8MBの画像＋base64の膨張分（約1.33倍）に余裕を持たせて引き上げる
app.use(express.json({ limit: '12mb' }));

// 公開先（Render / Docker）が「起動しているか」を確認するためのエンドポイント
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/lp', lpRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/site-assets', siteAssetRoutes);
app.use('/api/agent-tasks', agentRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/photos', photoRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/tools', toolRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/harness', harnessRoutes);
app.use('/api/ops', opsRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/builder', builderRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/products', productRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/harness-link', harnessLinkRoutes);
app.use('/api/crew', crewRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/company', companyRoutes);

// 想定外のエラーでもサーバー全体を落とさず、500を返す（Express 5はasync処理の例外もここへ流す）
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error', err?.message || err);
  void captureError('unhandled', err, { method: req.method, path: req.path });
  if (res.headersSent) return;
  res.status(500).json({ error: 'サーバーでエラーが発生しました。時間をおいて再度お試しください。' });
});

const port = process.env.PORT || 8000;
app.listen(port, () => console.log(`Server running on port ${port}`));
startScheduler();
startAgentLoop();
// 起動時に設定の明らかな誤りを知らせる（マスクされたAPIキーなど）
{
  const problem = anthropicKeyProblem();
  if (problem) {
    console.error(`⚠ ${problem}`);
    void captureError('config', new Error(problem));
  }
}
startCrew();
startCompany();
// 振込期限を過ぎた注文の取り消しと、保存期間を過ぎた注文の削除
setInterval(() => void sweepOrders().catch((e) => console.error('order sweep failed', e?.message)), 10 * 60_000);
