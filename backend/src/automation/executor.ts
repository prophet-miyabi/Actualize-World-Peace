import { chromium } from 'playwright';
import prisma from '../prisma';
import type { AutomationStep, StepLogEntry } from './types';
import { validateWorkflowSteps, isRuntimeFieldBlocked, isCaptchaFrame, MAX_STEPS } from './safety';
import { captureError } from '../lib/errors';

const STEP_TIMEOUT_MS = 15000;
const RUN_TIMEOUT_MS = 120000;

export async function runWorkflow(workflowId: string): Promise<void> {
  const workflow = await prisma.automationWorkflow.findUnique({ where: { id: workflowId } });
  if (!workflow || !workflow.enabled) return;

  const steps = workflow.steps as unknown as AutomationStep[];
  const check = validateWorkflowSteps(steps, workflow.targetUrl);
  if (!check.ok) {
    await prisma.automationRun.create({
      data: { workflowId, status: 'blocked', blockedStep: check.index, log: [{ reason: check.reason }] }
    });
    return;
  }

  const run = await prisma.automationRun.create({ data: { workflowId, status: 'running' } });
  const log: StepLogEntry[] = [];
  let finalStatus: 'success' | 'failed' | 'blocked' = 'success';
  let blockedStep: number | null = null;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    const deadline = Date.now() + RUN_TIMEOUT_MS;

    await page.goto(workflow.targetUrl, { waitUntil: 'domcontentloaded' });

    for (let i = 0; i < Math.min(steps.length, MAX_STEPS); i++) {
      if (Date.now() > deadline) {
        log.push({ index: i, action: steps[i].action, ok: false, detail: '全体の実行時間の上限を超えました' });
        finalStatus = 'failed';
        break;
      }
      const step = steps[i];

      // CAPTCHA/ボット判定サービスのフレーム上での操作は行わない（検知回避目的の利用を防ぐ）
      const captchaFrame = page.frames().find((f) => isCaptchaFrame(f.url()));
      if (captchaFrame && step.selector) {
        log.push({ index: i, action: step.action, label: step.label, ok: false, detail: 'CAPTCHA/ボット判定領域での操作はブロックされました' });
        finalStatus = 'blocked';
        blockedStep = i;
        break;
      }

      if (step.selector && (step.action === 'type' || step.action === 'click')) {
        const blockedReason = await isRuntimeFieldBlocked(page, step.selector);
        if (blockedReason) {
          log.push({ index: i, action: step.action, label: step.label, ok: false, detail: `実行時チェックでブロック: ${blockedReason}` });
          finalStatus = 'blocked';
          blockedStep = i;
          break;
        }
      }

      try {
        switch (step.action) {
          case 'navigate':
            await page.goto(step.value!, { waitUntil: 'domcontentloaded' });
            break;
          case 'click':
            await page.locator(step.selector!).first().click();
            break;
          case 'type':
            await page.locator(step.selector!).first().fill(step.value ?? '');
            break;
          case 'select':
            await page.locator(step.selector!).first().selectOption(step.value ?? '');
            break;
          case 'waitFor':
            await page.locator(step.selector!).first().waitFor({ state: 'visible' });
            break;
          case 'extract': {
            const text = await page.locator(step.selector!).first().innerText();
            log.push({ index: i, action: step.action, label: step.label, ok: true, detail: text.slice(0, 2000) });
            continue;
          }
        }
        log.push({ index: i, action: step.action, label: step.label, ok: true });
      } catch (e: any) {
        log.push({ index: i, action: step.action, label: step.label, ok: false, detail: String(e?.message || e).slice(0, 500) });
        finalStatus = 'failed';
        break;
      }
    }
  } catch (e: any) {
    log.push({ index: -1, action: 'navigate', ok: false, detail: String(e?.message || e).slice(0, 500) });
    finalStatus = 'failed';
    void captureError('automation_workflow', e, { workflowId });
  } finally {
    await browser.close();
  }

  await prisma.automationRun.update({
    where: { id: run.id },
    data: { status: finalStatus, log: log as any, blockedStep, finishedAt: new Date() }
  });
}
