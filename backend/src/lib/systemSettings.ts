import prisma from '../prisma';

// 緊急コントロールなど、システム全体の切り替え。値は文字列 "true" / "false" で保存する
export const SETTING_KEYS = {
  pauseAgentLoop: 'pause_agent_loop',
  pauseSnsPosting: 'pause_sns_posting'
} as const;
export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];
export const ALL_SETTING_KEYS = Object.values(SETTING_KEYS) as SettingKey[];

export const SETTING_LABEL: Record<SettingKey, string> = {
  pause_agent_loop: 'AIエージェントの定期実行を止める',
  pause_sns_posting: 'SNSの予約投稿を止める'
};

export async function getFlag(key: SettingKey): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row?.value === 'true';
}

export async function getAllFlags(): Promise<Record<SettingKey, boolean>> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: ALL_SETTING_KEYS } } });
  const flags = Object.fromEntries(ALL_SETTING_KEYS.map((k) => [k, false])) as Record<SettingKey, boolean>;
  for (const r of rows) flags[r.key as SettingKey] = r.value === 'true';
  return flags;
}

export async function setFlag(key: SettingKey, value: boolean, updatedBy: string) {
  await prisma.systemSetting.upsert({
    where: { key },
    update: { value: String(value), updatedBy },
    create: { key, value: String(value), updatedBy }
  });
}
