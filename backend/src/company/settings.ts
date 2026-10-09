import prisma from '../prisma';

// AI企業の運用設定（管理画面から変更できる）。環境変数は初期値としてだけ使う
export type CompanySettings = {
  ceoHour: number;        // CEOの日次見直しの時刻（JST, 0-23）
  monthlyCapUsd: number;  // 会社のエージェント全体の月のAI費用の上限
  concurrency: number;    // 同時に実行するタスク数
  discordApprovals: boolean; // 承認待ちを Discord #🏢-AI企業 に通知する
};

const DEFAULTS: CompanySettings = {
  ceoHour: Number(process.env.COMPANY_CEO_HOUR || 8),
  monthlyCapUsd: Number(process.env.COMPANY_MONTHLY_CAP_USD || 150),
  concurrency: Number(process.env.COMPANY_CONCURRENCY || 2),
  discordApprovals: true
};

let cache: { value: CompanySettings; until: number } | null = null;

export async function getCompanySettings(): Promise<CompanySettings> {
  if (cache && cache.until > Date.now()) return cache.value;
  const row = await prisma.systemSetting.findUnique({ where: { key: 'company_settings' } });
  let value = DEFAULTS;
  if (row) {
    try {
      const v = JSON.parse(row.value);
      value = {
        ceoHour: Number.isInteger(v.ceoHour) && v.ceoHour >= 0 && v.ceoHour <= 23 ? v.ceoHour : DEFAULTS.ceoHour,
        monthlyCapUsd: Number(v.monthlyCapUsd) >= 0 ? Number(v.monthlyCapUsd) : DEFAULTS.monthlyCapUsd,
        concurrency: Number.isInteger(v.concurrency) && v.concurrency >= 1 && v.concurrency <= 6 ? v.concurrency : DEFAULTS.concurrency,
        discordApprovals: v.discordApprovals !== false
      };
    } catch { /* 既定値 */ }
  }
  cache = { value, until: Date.now() + 15_000 };
  return value;
}

export async function setCompanySettings(next: Partial<CompanySettings>, updatedBy: string) {
  const cur = await getCompanySettings();
  const merged: CompanySettings = {
    ceoHour: next.ceoHour !== undefined ? Math.min(23, Math.max(0, Math.floor(Number(next.ceoHour)))) : cur.ceoHour,
    monthlyCapUsd: next.monthlyCapUsd !== undefined ? Math.max(0, Number(next.monthlyCapUsd) || 0) : cur.monthlyCapUsd,
    concurrency: next.concurrency !== undefined ? Math.min(6, Math.max(1, Math.floor(Number(next.concurrency)) || 1)) : cur.concurrency,
    discordApprovals: next.discordApprovals !== undefined ? !!next.discordApprovals : cur.discordApprovals
  };
  await prisma.systemSetting.upsert({ where: { key: 'company_settings' }, update: { value: JSON.stringify(merged), updatedBy }, create: { key: 'company_settings', value: JSON.stringify(merged), updatedBy } });
  cache = null;
  return merged;
}

// 承認待ちができたことを Discord（#🏢-AI企業）に知らせる
export async function notifyApproval(agentName: string, tool: string, reason: string, taskTitle: string) {
  const s = await getCompanySettings();
  if (!s.discordApprovals) return;
  const { say, discordConfigured } = await import('../crew/discord');
  if (!discordConfigured()) return;
  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  await say('mina', 'company', `🧑‍⚖️ **承認が必要な操作**: ${agentName} → ${tool}\nタスク: ${taskTitle}\n理由: ${reason.slice(0, 500)}\n→ ${base}/admin/company で承認／却下できます`).catch(() => {});
}
