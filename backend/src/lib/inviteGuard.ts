import prisma from '../prisma';
import { getFlag, SETTING_KEYS } from './systemSettings';

// コストガード（オーナー決定 2026-10-23）: 一般公開を急がず、年内はページ作成を招待制にできる。
// - 管理画面「緊急コントロール」の invite_only_pages を ON にすると、新しいページの作成に招待コードが要る
// - 招待コードは環境変数 AWP_INVITE_CODE（カンマ区切りで複数可）。一度通った利用者は SystemSetting に記録し、以後は不要
// - 管理者と、既にページを持っている利用者は対象外（ドッグフーディングと既存利用者を止めない）
export class InviteRequiredError extends Error {
  code = 'invite_required';
  constructor() { super('いまは招待制で運用しています。招待コードを入力してください。'); }
}

function validCodes() {
  return (process.env.AWP_INVITE_CODE || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export async function assertInviteForPageCreate(userId: string, code?: string | null) {
  if (!(await getFlag(SETTING_KEYS.inviteOnlyPages))) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
  if (user?.isAdmin) return;
  if (await prisma.landingPage.findFirst({ where: { userId }, select: { id: true } })) return;
  const key = `invite:${userId}`;
  if (await prisma.systemSetting.findUnique({ where: { key } })) return;
  const given = String(code ?? '').trim();
  if (given && validCodes().includes(given)) {
    await prisma.systemSetting.upsert({ where: { key }, update: { value: 'true', updatedBy: userId }, create: { key, value: 'true', updatedBy: userId } });
    return;
  }
  throw new InviteRequiredError();
}
