import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';
import { validateWorkflowSteps, MAX_STEPS } from '../automation/safety';
import { runWorkflow } from '../automation/executor';
import type { AutomationStep } from '../automation/types';
import { userHasPaidPlan } from '../lib/plans';

const router = Router();

async function requirePaidOrAdmin(userId: string): Promise<boolean> {
  return userHasPaidPlan(userId);
}

router.get('/', authenticate, async (req: AuthRequest, res) => {
  const workflows = await prisma.automationWorkflow.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: 'desc' }
  });
  res.json({ workflows, maxSteps: MAX_STEPS });
});

router.get('/:id/runs', authenticate, async (req: AuthRequest, res) => {
  const workflow = await prisma.automationWorkflow.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (!workflow) return res.status(404).json({ error: 'Not found' });
  const runs = await prisma.automationRun.findMany({
    where: { workflowId: workflow.id },
    orderBy: { startedAt: 'desc' },
    take: 20
  });
  res.json({ runs });
});

router.post('/', authenticate, async (req: AuthRequest, res) => {
  if (!(await requirePaidOrAdmin(req.user!.id))) {
    return res.status(402).json({ error: 'この機能は有料プランでご利用いただけます' });
  }
  const { name, targetUrl, steps } = req.body as { name?: string; targetUrl?: string; steps?: AutomationStep[] };
  if (!name || !targetUrl || !Array.isArray(steps)) {
    return res.status(400).json({ error: 'name / targetUrl / steps は必須です' });
  }
  const check = validateWorkflowSteps(steps, targetUrl);
  if (!check.ok) return res.status(400).json({ error: check.reason, index: check.index });

  const workflow = await prisma.automationWorkflow.create({
    data: { userId: req.user!.id, name, targetUrl, steps: steps as any }
  });
  res.status(201).json({ workflow });
});

router.put('/:id', authenticate, async (req: AuthRequest, res) => {
  const existing = await prisma.automationWorkflow.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { name, targetUrl, steps, enabled } = req.body as {
    name?: string; targetUrl?: string; steps?: AutomationStep[]; enabled?: boolean;
  };
  const nextTargetUrl = targetUrl ?? existing.targetUrl;
  const nextSteps = (steps ?? (existing.steps as unknown as AutomationStep[]));
  const check = validateWorkflowSteps(nextSteps, nextTargetUrl);
  if (!check.ok) return res.status(400).json({ error: check.reason, index: check.index });

  const workflow = await prisma.automationWorkflow.update({
    where: { id: existing.id },
    data: {
      name: name ?? existing.name,
      targetUrl: nextTargetUrl,
      steps: nextSteps as any,
      enabled: enabled ?? existing.enabled
    }
  });
  res.json({ workflow });
});

router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
  const existing = await prisma.automationWorkflow.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (!existing) return res.status(404).json({ error: 'Not found' });
  await prisma.automationRun.deleteMany({ where: { workflowId: existing.id } });
  await prisma.automationWorkflow.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

// 実行にはブラウザの起動を伴い数秒〜数十秒かかるため、run-nowと同様にすぐ202を返し裏側で実行する
router.post('/:id/run', authenticate, async (req: AuthRequest, res) => {
  if (!(await requirePaidOrAdmin(req.user!.id))) {
    return res.status(402).json({ error: 'この機能は有料プランでご利用いただけます' });
  }
  const workflow = await prisma.automationWorkflow.findFirst({ where: { id: String(req.params.id), userId: req.user!.id } });
  if (!workflow) return res.status(404).json({ error: 'Not found' });
  if (!workflow.enabled) return res.status(400).json({ error: 'このワークフローは無効化されています' });

  runWorkflow(workflow.id).catch((e) => console.error('automation run failed', workflow.id, e?.message));
  res.status(202).json({ ok: true, status: 'running' });
});

export default router;
