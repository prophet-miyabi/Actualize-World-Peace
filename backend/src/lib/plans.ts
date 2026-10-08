import prisma from '../prisma';

// AWPの有料プラン（3段階）。運営者の方針:
// - 料金は Claude の Pro プラン（月額・米ドル）を基準に、段階ごとの倍率で決める
// - 料金の 78% を、その利用者の「AIの利用枠」（トークンの消費にかかる費用）に充てる。22% がAWPの運営の取り分
// 基準額・為替・倍率・無料プランの利用枠は、管理画面から変えられる（SystemSetting の plan_config）
export const PLAN_KEYS = ['lite', 'standard', 'pro'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];
export const AI_SHARE = 0.78;

export type PlanConfig = {
  baseUsd: number;     // 基準: Claude Pro の月額（米ドル）
  usdJpy: number;      // 円換算のレート
  multipliers: Record<PlanKey, number>;
  freeAiUsd: number;   // 無料プランの月のAI利用枠（米ドル）
};

export const DEFAULT_PLAN_CONFIG: PlanConfig = {
  baseUsd: Number(process.env.PLAN_BASE_USD || 20),
  usdJpy: Number(process.env.PLAN_USD_JPY || 150),
  multipliers: { lite: 0.5, standard: 1, pro: 3 },
  freeAiUsd: Number(process.env.PLAN_FREE_AI_USD || 1.5)
};

export const PLAN_LABEL: Record<PlanKey | 'free', string> = { free: 'フリー', lite: 'ライト', standard: 'スタンダード', pro: 'プロ' };

export async function getPlanConfig(): Promise<PlanConfig> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'plan_config' } });
  if (!row) return DEFAULT_PLAN_CONFIG;
  try {
    const v = JSON.parse(row.value);
    return {
      baseUsd: Number(v.baseUsd) > 0 ? Number(v.baseUsd) : DEFAULT_PLAN_CONFIG.baseUsd,
      usdJpy: Number(v.usdJpy) > 0 ? Number(v.usdJpy) : DEFAULT_PLAN_CONFIG.usdJpy,
      multipliers: Object.fromEntries(PLAN_KEYS.map((k) => [k, Number(v.multipliers?.[k]) > 0 ? Number(v.multipliers[k]) : DEFAULT_PLAN_CONFIG.multipliers[k]])) as Record<PlanKey, number>,
      freeAiUsd: Number(v.freeAiUsd) >= 0 ? Number(v.freeAiUsd) : DEFAULT_PLAN_CONFIG.freeAiUsd
    };
  } catch {
    return DEFAULT_PLAN_CONFIG;
  }
}

export async function setPlanConfig(c: PlanConfig, updatedBy: string) {
  await prisma.systemSetting.upsert({ where: { key: 'plan_config' }, update: { value: JSON.stringify(c), updatedBy }, create: { key: 'plan_config', value: JSON.stringify(c), updatedBy } });
}

// 月額（円・10円単位）と、そのうちAIの利用枠に充てる額
export function planPrices(c: PlanConfig) {
  return Object.fromEntries(PLAN_KEYS.map((k) => {
    const priceYen = Math.round((c.baseUsd * c.multipliers[k] * c.usdJpy) / 10) * 10;
    const aiYen = Math.floor(priceYen * AI_SHARE);
    return [k, { key: k, label: PLAN_LABEL[k], priceYen, aiYen, platformYen: priceYen - aiYen, aiUsd: aiYen / c.usdJpy }];
  })) as Record<PlanKey, { key: PlanKey; label: string; priceYen: number; aiYen: number; platformYen: number; aiUsd: number }>;
}

type PlanUser = { plan: string; planUntil: Date | null; isAdmin: boolean; subscriptionStatus?: string | null };

export function activePlan(u: PlanUser): PlanKey | 'free' {
  if (u.plan !== 'free' && u.planUntil && u.planUntil.getTime() > Date.now() && (PLAN_KEYS as readonly string[]).includes(u.plan)) return u.plan as PlanKey;
  return 'free';
}

// 有料の機能を使えるか（管理者・有料プラン期間中・以前のStripeサブスク加入者）
export function hasPaidPlan(u: PlanUser | null) {
  if (!u) return false;
  return u.isAdmin || activePlan(u) !== 'free' || u.subscriptionStatus === 'active';
}

export async function userHasPaidPlan(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { plan: true, planUntil: true, isAdmin: true, subscriptionStatus: true } });
  return hasPaidPlan(u);
}

// 月のAI利用枠（米ドル）
export async function aiAllowanceUsd(userId: string) {
  const [u, c] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { plan: true, planUntil: true, isAdmin: true, subscriptionStatus: true } }),
    getPlanConfig()
  ]);
  if (!u) return 0;
  if (u.isAdmin) return Number.POSITIVE_INFINITY;
  const plan = activePlan(u);
  if (plan === 'free') return u.subscriptionStatus === 'active' ? planPrices(c).standard.aiUsd : c.freeAiUsd;
  return planPrices(c)[plan].aiUsd;
}
