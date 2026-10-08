import prisma from '../prisma';
import { STRATEGY_MD, STRATEGY_VERSION } from './strategy';

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

export async function seedCompany() {
  const existing = await prisma.companyGoal.findFirst({ where: { title: OWNER_GOAL.title } });
  if (!existing) {
    await prisma.companyGoal.create({ data: { ...OWNER_GOAL, kpis: OWNER_GOAL.kpis as any, setBy: 'owner' } });
    // 初回は停止状態で用意する（AI費用が発生するため、オーナーが管理画面で「開始」したときから動く）
    await prisma.systemSetting.upsert({ where: { key: 'pause_company' }, update: {}, create: { key: 'pause_company', value: 'true', updatedBy: 'system' } });
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
