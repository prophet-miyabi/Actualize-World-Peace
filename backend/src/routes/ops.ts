import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '../prisma';
import { anthropicKeyProblem, describeAiError } from '../lib/aiUsage';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { buildOverview } from '../lib/opsOverview';
import { ALL_SETTING_KEYS, setFlag, type SettingKey } from '../lib/systemSettings';
import { createClaudeIssue, githubConfigured } from '../lib/github';
import { runOpsChat, type ChatTurn } from '../agents/opsAgent';
import { hitRateLimit } from '../lib/rateLimit';
import { createAnthropic } from '../lib/anthropic';

// 運営者（管理者）専用: ダッシュボード・緊急コントロール・AIオペレーターとのチャット・提案の承認
const router = Router();

async function requireAdmin(req: AuthRequest, res: any): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!user?.isAdmin) {
    res.status(403).json({ error: '管理者のみ利用できます' });
    return false;
  }
  return true;
}

router.get('/overview', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json(await buildOverview());
});

// 緊急コントロール（運営者が画面から直接切り替える）
router.put('/emergency', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const key = req.body?.key as SettingKey;
  if (!ALL_SETTING_KEYS.includes(key) || typeof req.body?.value !== 'boolean') {
    return res.status(400).json({ error: '設定の指定が正しくありません' });
  }
  await setFlag(key, req.body.value, req.user!.id);
  res.json((await buildOverview()).emergency);
});

// ---- AIオペレーターとのチャット（Server-Sent Events で少しずつ返す） ----
router.post('/chat', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY が未設定のため、AIオペレーターは使えません。' });
  if (hitRateLimit(`ops:chat:${req.user!.id}`, 40, 60 * 60 * 1000)) {
    return res.status(429).json({ error: '1時間あたりの利用回数の上限に達しました。少し時間をおいてお試しください。' });
  }

  const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const history: ChatTurn[] = raw
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .slice(-20)
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 6000) }));
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'メッセージを入力してください。' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    await runOpsChat(history, req.user!.id, send);
    send({ type: 'done' });
  } catch (e: any) {
    console.error('ops chat failed', e?.message);
    send({ type: 'error', message: `AIの応答に失敗しました: ${describeAiError(e)}` });
  } finally {
    res.end();
  }
});

// ---- AI接続の確認（運営者が原因をすぐ特定できるように、実際に1回だけ小さな呼び出しをする） ----
router.get('/ai-check', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const problem = anthropicKeyProblem();
  if (problem) return res.json({ ok: false, problem, stage: 'key' });
  try {
    const client = createAnthropic();
    const model = process.env.COMPANY_MODEL_FAST || 'claude-haiku-4-5-20251001';
    const msg = await client.messages.create({ model, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] });
    res.json({ ok: true, model: msg.model, strongModel: process.env.CLAUDE_MODEL || 'claude-opus-5' });
  } catch (e: any) {
    res.json({ ok: false, problem: describeAiError(e), stage: 'request', status: e?.status ?? null });
  }
});

// ---- 提案の一覧と承認 ----
router.get('/proposals', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const proposals = await prisma.opsProposal.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ proposals, githubConfigured: githubConfigured() });
});

router.post('/proposals/:id/reject', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const p = await prisma.opsProposal.findUnique({ where: { id: String(req.params.id) } });
  if (!p || p.status !== 'awaiting_approval') return res.status(400).json({ error: 'この提案は承認待ちではありません' });
  res.json({ proposal: await prisma.opsProposal.update({ where: { id: p.id }, data: { status: 'rejected', decidedBy: req.user!.id } }) });
});

// 承認したときだけ実行する。setting はその場で反映、code_change は GitHub に課題を作って Claude Code に引き渡す
router.post('/proposals/:id/approve', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const p = await prisma.opsProposal.findUnique({ where: { id: String(req.params.id) } });
  if (!p || p.status !== 'awaiting_approval') return res.status(400).json({ error: 'この提案は承認待ちではありません' });

  if (p.kind === 'setting') {
    const payload = p.payload as { key?: SettingKey; value?: boolean } | null;
    if (!payload?.key || !ALL_SETTING_KEYS.includes(payload.key) || typeof payload.value !== 'boolean') {
      return res.status(400).json({ error: '提案の内容が正しくありません' });
    }
    await setFlag(payload.key, payload.value, req.user!.id);
    return res.json({ proposal: await prisma.opsProposal.update({ where: { id: p.id }, data: { status: 'approved', decidedBy: req.user!.id } }) });
  }

  if (p.kind === 'code_change') {
    if (!githubConfigured()) {
      return res.status(503).json({ error: 'GitHub連携（GITHUB_OPS_TOKEN・GITHUB_REPO）が未設定のため、実装を依頼できません。' });
    }
    const body = [
      p.body,
      '',
      '---',
      'この課題は、AWPの管理者画面でAIオペレーターが作成し、運営者が承認したものです。',
      '- 作業はこのリポジトリのルール（CLAUDE.md）に従ってください。',
      '- 変更はブランチで行い、プルリクエストとして提出してください（mainへ直接プッシュしない）。',
      '- 本番への反映は、運営者がプルリクエストを確認してマージしたときだけ行われます。'
    ].join('\n');
    try {
      const issue = await createClaudeIssue(p.title, body);
      return res.json({
        proposal: await prisma.opsProposal.update({
          where: { id: p.id },
          data: { status: 'approved', decidedBy: req.user!.id, githubIssueNumber: issue.number, githubIssueUrl: issue.url, error: null }
        })
      });
    } catch (e: any) {
      const updated = await prisma.opsProposal.update({ where: { id: p.id }, data: { status: 'failed', error: String(e?.message || e).slice(0, 500) } });
      return res.status(502).json({ error: updated.error, proposal: updated });
    }
  }

  res.status(400).json({ error: '不明な提案の種類です' });
});

export default router;
