import prisma from '../prisma';
import { anthropicKeyProblem } from './aiUsage';
import { smsMode } from './sms';
import { githubConfigured } from './github';
import { getAllFlags } from './systemSettings';

const DAY = 24 * 60 * 60 * 1000;

// 管理者画面のダッシュボードと、AIオペレーターの両方が使うシステムの現況。
// 個人を特定できる情報（メールアドレス・電話番号・氏名）は含めない（AIに送るため）
export async function buildOverview() {
  const since7 = new Date(Date.now() - 7 * DAY);
  const [
    users, newUsers7d, pages, newPages7d, ordersRequested, ordersInProgress,
    openErrors, pendingReviews, proposalsWaiting, clicks7d, unpricedAddons, flags
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: since7 } } }),
    prisma.landingPage.count(),
    prisma.landingPage.count({ where: { createdAt: { gte: since7 } } }),
    prisma.harnessOrder.count({ where: { status: 'requested' } }),
    prisma.harnessOrder.count({ where: { status: 'in_progress' } }),
    prisma.systemError.count({ where: { status: { in: ['open', 'diagnosed'] } } }),
    prisma.agentTask.count({ where: { status: 'pending_review' } }),
    prisma.opsProposal.count({ where: { status: 'awaiting_approval' } }),
    prisma.affiliateClick.count({ where: { createdAt: { gte: since7 } } }),
    prisma.harnessAddon.count({ where: { priceYen: null } }),
    getAllFlags()
  ]);

  // 「設定されているか」だけを返す（値そのものは絶対に返さない）
  const config = {
    smsVerification: smsMode() === 'twilio' ? '有効' : smsMode() === 'dev' ? '開発用モード' : '未設定',
    stripe: !!process.env.STRIPE_SECRET_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY && !anthropicKeyProblem(),
    anthropicProblem: anthropicKeyProblem(),
    imageAi: !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) || !!process.env.GEMINI_API_KEY,
    githubForAiDevelopment: githubConfigured(),
    customDomainBase: !!process.env.MAIN_DOMAIN
  };

  const todos: { label: string; count: number; href: string }[] = [
    { label: '未対応のHarness申し込み', count: ordersRequested, href: '/admin/harness' },
    { label: '承認待ちのAIの提案', count: proposalsWaiting, href: '/admin/ops' },
    { label: '未解決のエラー', count: openErrors, href: '/admin/monitoring' },
    { label: '料金未設定のHarnessメニュー', count: unpricedAddons, href: '/admin/harness' },
    { label: `AIのAPIキーの設定に問題: ${anthropicKeyProblem() ?? ''}`, count: anthropicKeyProblem() ? 1 : 0, href: '/admin/monitoring' }
  ].filter((t) => t.count > 0);

  return {
    generatedAt: new Date().toISOString(),
    kpi: { users, newUsers7d, pages, newPages7d, ordersRequested, ordersInProgress, openErrors, pendingReviews, proposalsWaiting, affiliateClicks7d: clicks7d },
    emergency: flags,
    config,
    todos
  };
}
