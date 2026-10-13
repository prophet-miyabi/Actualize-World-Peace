import prisma from '../prisma';
import { STRATEGY_MD, STRATEGY_VERSION } from './strategy';
import { BEHAVIORAL_MD, BEHAVIORAL_VERSION } from './behavioral';
import { VISION_MD, VISION_VERSION } from './vision';
import { seedCouncil } from './council';

// 起動時に、オーナーの目標と戦略メモを用意する（既にあれば触らない。戦略は版が上がったときだけ更新）
export const OWNER_GOAL = {
  title: '1年で100万ユーザーを獲得し、サービスを提供し続け、拡張性を高める',
  description: '公開（2026-10-28）から1年で登録ユーザー100万人。無料で全部そろうプロダクトのループ（ページ・SNS・紹介・エコシステム）で獲得し、AI費用はプランの利用枠で上限を守りながら、信頼性と拡張性のある基盤を整える。',
  kpis: [
    { key: 'users', label: '累計登録ユーザー', target: 1_000_000, unit: '人', by: '2027-10-31' },
    { key: 'users_q1', label: '累計登録（Q1）', target: 5_000, unit: '人', by: '2026-12-31' },
    { key: 'users_q2', label: '累計登録（Q2）', target: 50_000, unit: '人', by: '2027-03-31' },
    { key: 'users_q3', label: '累計登録（Q3）', target: 250_000, unit: '人', by: '2027-06-30' },
    { key: 'active7_rate', label: '7日アクティブ率', target: 30, unit: '%', by: 'always' },
    { key: 'referral_share', label: '紹介経由の登録比率', target: 30, unit: '%', by: '2027-06-30' },
    { key: 'ai_cost_per_user', label: '利用者1人あたりの月のAI費用', target: 0.3, unit: 'USD', by: 'always' },
    { key: 'uptime', label: '稼働率', target: 99.9, unit: '%', by: 'always' }
  ]
};

// オーナーの決定（2026-10-13）: 2027年中に第三種資金移動業の登録を取得し、収益を利用者に配分できるようにする
export const FUNDS_GOAL = {
  title: '2027年中に第三種資金移動業の登録を取得し、収益を利用者に配分できるようにする',
  description: '利用者のキャッシュを現金として出金し、参加配当を支払えるようにするため、資金決済法の第三種資金移動業（1件5万円以下）の登録を2027年中に取得する。法人格・財産的基礎・利用者資金の保全（供託か預金管理＋外部監査）・体制整備・犯収法対応（eKYC）・業務方法書・協会加入が必要。詳細は弁護士と財務局の事前相談で確認する（docs/strategy/funds-transfer-license.md）。登録までキャッシュは有料機能の支払い専用のまま。',
  kpis: [
    { key: 'fsa_preconsult', label: '財務局の事前相談を実施', target: 1, unit: '回', by: '2026-12-31' },
    { key: 'entity_capital', label: '法人・資本・保全方法の確定', target: 1, unit: '件', by: '2027-03-31' },
    { key: 'policies', label: '規程類（内部管理・AML・システムリスク・苦情対応）の完成', target: 4, unit: '本', by: '2027-06-30' },
    { key: 'application', label: '登録申請書類の提出', target: 1, unit: '件', by: '2027-09-30' },
    { key: 'registration', label: '第三種資金移動業の登録', target: 1, unit: '件', by: '2027-12-31' },
    { key: 'first_dividend', label: '参加配当の初回支払い', target: 1, unit: '回', by: '2027-12-31' }
  ]
};

export async function seedCompany() {
  if (!(await prisma.companyGoal.findFirst({ where: { title: FUNDS_GOAL.title } }))) {
    await prisma.companyGoal.create({ data: { ...FUNDS_GOAL, kpis: FUNDS_GOAL.kpis as any, setBy: 'owner' } });
  }
  const existing = await prisma.companyGoal.findFirst({ where: { title: OWNER_GOAL.title } });
  if (!existing) {
    await prisma.companyGoal.create({ data: { ...OWNER_GOAL, kpis: OWNER_GOAL.kpis as any, setBy: 'owner' } });
    // 初回は停止状態で用意する（AI費用が発生するため、オーナーが管理画面で「開始」したときから動く）
    await prisma.systemSetting.upsert({ where: { key: 'pause_company' }, update: {}, create: { key: 'pause_company', value: 'true', updatedBy: 'system' } });
  }
  await seedCouncil();
  // ビジョン（北極星）。版が変わったら上書きする
  const vis = await prisma.companyMemory.findUnique({ where: { scope_key: { scope: 'company', key: 'vision' } } });
  if (!vis || !vis.content.includes(`v${VISION_VERSION}`)) {
    await prisma.companyMemory.upsert({
      where: { scope_key: { scope: 'company', key: 'vision' } },
      update: { content: VISION_MD, updatedBy: 'system' },
      create: { scope: 'company', key: 'vision', content: VISION_MD, updatedBy: 'system' }
    });
  }
  // 体験設計の原則（文章・画面・料金の見せ方）。版が変わったら上書きする
  const beh = await prisma.companyMemory.findUnique({ where: { scope_key: { scope: 'company', key: 'behavioral-design' } } });
  if (!beh || !beh.content.includes(`v${BEHAVIORAL_VERSION}`)) {
    await prisma.companyMemory.upsert({
      where: { scope_key: { scope: 'company', key: 'behavioral-design' } },
      update: { content: BEHAVIORAL_MD, updatedBy: 'system' },
      create: { scope: 'company', key: 'behavioral-design', content: BEHAVIORAL_MD, updatedBy: 'system' }
    });
  }
  const strat = await prisma.companyMemory.findUnique({ where: { scope_key: { scope: 'company', key: 'strategy' } } });
  if (!strat || (strat.updatedBy === 'system' && !strat.content.includes(`v${STRATEGY_VERSION}`))) {
    await prisma.companyMemory.upsert({
      where: { scope_key: { scope: 'company', key: 'strategy' } },
      update: { content: STRATEGY_MD, updatedBy: 'system' },
      create: { scope: 'company', key: 'strategy', content: STRATEGY_MD, updatedBy: 'system' }
    });
  }
}
