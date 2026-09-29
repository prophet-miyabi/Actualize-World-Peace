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
import { startScheduler } from './social/scheduler';
import { startAgentLoop } from './agents/loop';

const app = express();
app.use(cors());

// LINEのWebhookは「JSONとして読みつつ生のBodyも保持」する必要がある（署名検証用）
app.use(
  '/api/webhook',
  express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }),
  webhookRoutes
);

// Stripeは生のBufferのみで良い（SDKがそこから直接検証・パースする）
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json());

// 公開先（Render / Docker）が「起動しているか」を確認するためのエンドポイント
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/lp', lpRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/site-assets', siteAssetRoutes);
app.use('/api/agent-tasks', agentRoutes);
app.use('/api/automation', automationRoutes);

// 想定外のエラーでもサーバー全体を落とさず、500を返す（Express 5はasync処理の例外もここへ流す）
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error', err?.message || err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'サーバーでエラーが発生しました。時間をおいて再度お試しください。' });
});

const port = process.env.PORT || 8000;
app.listen(port, () => console.log(`Server running on port ${port}`));
startScheduler();
startAgentLoop();
