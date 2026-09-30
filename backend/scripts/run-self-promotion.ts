import 'dotenv/config';
import prisma from '../src/prisma';
import { planWeeklyXCampaign } from '../src/agents/xCampaign';
import { runSelfPromotionAgents, SELF_PROMOTION_FACTS, SELF_PROMOTION_X_PROFILE } from '../src/agents/selfPromotion';

// AWP自身のSNS集客キャンペーンを手動で実行するCLIスクリプト。
// 通常は6時間ごとの自動実行（backend/src/agents/loop.ts）で十分だが、
// すぐに結果を確認したい・DBに書き込まず内容だけ見たい場合はこちらを使う。
//
// 使い方:
//   npm run promo:dry-run   → Claudeでキャンペーン案を生成して表示するだけ。DBには一切書き込まない
//   npm run promo:generate  → 実際の運用経路（backend/src/agents/selfPromotion.ts）をそのまま実行する。
//                             審査・承認待ちキューへの登録・（オンなら）自動承認までを本番と同じ処理で行う
//
// 対象のXアカウントについて：このスクリプトや設定ファイルの中でアカウントIDを指定する必要はない。
// 管理者（User.isAdmin = true）がダッシュボードの「SNS連携」からXアカウントをOAuth連携した時点で、
// backend/src/agents/selfPromotion.ts が自動的にそのアカウントを対象にする
// （管理者が複数いれば、連携している全員が対象になる）。
// 投稿の実配信は backend/src/social/scheduler.ts が15秒間隔でScheduledPostを確認して行っており、
// server.ts起動時に自動的に動き出すため、Render上でも追加設定なしでそのまま機能する。
async function dryRun() {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    console.error('SITE_URL が未設定です（backend/.env）。');
    process.exit(1);
  }
  console.log('[dry-run] Claudeでキャンペーン案を生成します（DBへの書き込みはありません）\n');

  const plan = await planWeeklyXCampaign({
    businessName: SELF_PROMOTION_FACTS.businessName,
    heroTitle: SELF_PROMOTION_FACTS.heroTitle,
    strengths: SELF_PROMOTION_FACTS.strengths,
    socialProof: null,
    scarcityOffer: null,
    lpUrl: siteUrl,
    ...SELF_PROMOTION_X_PROFILE
  });

  if (!plan) {
    console.error('生成に失敗しました（ANTHROPIC_API_KEY未設定、または審査の連続差し戻しの可能性があります）。');
    process.exit(1);
  }
  console.log(JSON.stringify(plan, null, 2));
}

async function generate() {
  console.log('AWP自己PR担当を実行します。管理者アカウントに紐づく、連携済みSNSが対象です。');
  const before = new Date();
  await runSelfPromotionAgents();

  const tasks = await prisma.agentTask.findMany({
    where: { role: { startsWith: 'self_promotion_' }, createdAt: { gte: before } },
    orderBy: { createdAt: 'desc' }
  });
  if (tasks.length === 0) {
    console.log(
      '新しいタスクは作成されませんでした。考えられる理由: ' +
      '(1) 管理者がXなどのSNSを連携していない、(2) 直近のクールダウン期間中（Xは7日、他は24時間）、' +
      '(3) CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKENが未設定。'
    );
    return;
  }
  console.log(`${tasks.length}件のタスクを作成しました:`);
  for (const t of tasks) {
    console.log(`- [${t.role}] status=${t.status} autoApproved=${t.autoApproved}`);
  }
  console.log('\n承認待ちの内容は /agents ダッシュボードから確認・承認できます。');
}

async function main() {
  if (process.argv.includes('--dry-run')) {
    await dryRun();
  } else {
    await generate();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
