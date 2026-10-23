// リマインダー: 予約の希望日時（またはシナリオ登録日時）から ±N 分の時点で LINE に送る。
// 毎分の処理で「送る時刻を過ぎていて、まだ送っていない」ものを拾う。同じ予約には 1 回だけ（CrmReminderSend の一意制約）。
import prisma from '../prisma';
import { pushSpec } from '../line/send';
import type { MessageSpec } from '../line/messages';

const WINDOW_MS = 6 * 3600_000; // 送る時刻から 6 時間以内なら送る（サーバー停止の取りこぼし救済。それ以上古いものは送らない）

const fmt = (d: Date) => d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', weekday: 'short' });

export async function processDueReminders() {
  const reminders = await prisma.crmReminder.findMany({ where: { active: true } });
  let sent = 0;
  const now = Date.now();
  for (const r of reminders) {
    const offset = r.offsetMinutes * 60_000;
    // 基準時刻 t に対して送信時刻 = t + offset。いま送るべきは t + offset ∈ [now - WINDOW, now]
    const tMin = new Date(now - WINDOW_MS - offset);
    const tMax = new Date(now - offset);
    if (r.basis === 'booking') {
      const lps = await prisma.landingPage.findMany({ where: { userId: r.ownerId }, select: { id: true, businessName: true } });
      const bookings = await prisma.booking.findMany({ where: { lpId: { in: lps.map((l) => l.id) }, contactId: { not: null }, status: { in: ['requested', 'confirmed'] }, requestedAt: { gte: tMin, lte: tMax } }, take: 200 });
      for (const b of bookings) {
        const already = await prisma.crmReminderSend.findUnique({ where: { reminderId_refKey: { reminderId: r.id, refKey: b.id } } });
        if (already) continue;
        const contact = await prisma.crmContact.findUnique({ where: { id: b.contactId! } });
        if (!contact) continue;
        const lp = lps.find((l) => l.id === b.lpId);
        const res = await pushSpec(r.ownerId, contact, r.message as MessageSpec, { kind: 'reminder', refId: r.id, accountId: r.lineAccountId, vars: { extra: { date: fmt(b.requestedAt), menu: b.menu ?? '', shop: lp?.businessName ?? '', code: b.code } } });
        await prisma.crmReminderSend.create({ data: { reminderId: r.id, contactId: contact.id, refKey: b.id } }).catch(() => {});
        if (res.ok) sent++;
      }
    } else if (r.basis === 'enrollment' && r.basisRef) {
      const ens = await prisma.crmScenarioEnrollment.findMany({ where: { scenarioId: r.basisRef, createdAt: { gte: tMin, lte: tMax } }, include: { contact: true }, take: 200 });
      for (const en of ens) {
        const already = await prisma.crmReminderSend.findUnique({ where: { reminderId_refKey: { reminderId: r.id, refKey: en.id } } });
        if (already) continue;
        const res = await pushSpec(r.ownerId, en.contact, r.message as MessageSpec, { kind: 'reminder', refId: r.id, accountId: r.lineAccountId });
        await prisma.crmReminderSend.create({ data: { reminderId: r.id, contactId: en.contactId, refKey: en.id } }).catch(() => {});
        if (res.ok) sent++;
      }
    }
    if (sent) await prisma.crmReminder.update({ where: { id: r.id }, data: { sentCount: { increment: sent } } });
  }
  return sent;
}
