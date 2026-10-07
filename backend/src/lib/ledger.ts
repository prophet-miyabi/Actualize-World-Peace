import type { Prisma, PrismaClient } from '@prisma/client';

// 複式簿記の台帳。お金が動く処理は必ずここを通し、借方合計＝貸方合計の取引としてまとめて記録する。
// 記録済みの取引は書き換えず、取り消しは逆仕訳で行う（あとから監査・会計処理ができるようにするため）

export const OWNER_SHARE_PERCENT = 78;

export const ACCOUNTS = {
  receivable: 'platform:receivable',
  revenue: 'platform:revenue',
  sales: 'platform:sales',
  userCash: (userId: string) => `user:${userId}:cash`
};

type Tx = Prisma.TransactionClient | PrismaClient;
type Line = { account: string; debit?: number; credit?: number };

// 端数はAWP側に寄せる（利用者の取り分は切り捨てで、合計は必ず元の金額と一致する）
export function splitRevenue(grossYen: number) {
  const ownerYen = Math.floor((grossYen * OWNER_SHARE_PERCENT) / 100);
  return { ownerYen, platformYen: grossYen - ownerYen };
}

function userIdOf(account: string): string | null {
  const m = /^user:([^:]+):cash$/.exec(account);
  return m ? m[1] : null;
}

export async function postTransaction(
  db: Tx,
  t: { kind: string; memo: string; refType?: string; refId?: string; createdBy?: string; lines: Line[] }
) {
  const lines = t.lines.map((l) => ({ account: l.account, debit: l.debit ?? 0, credit: l.credit ?? 0 }));
  for (const l of lines) {
    if (!Number.isInteger(l.debit) || !Number.isInteger(l.credit) || l.debit < 0 || l.credit < 0) throw new Error('ledger: 金額は0以上の整数');
  }
  const debit = lines.reduce((a, l) => a + l.debit, 0);
  const credit = lines.reduce((a, l) => a + l.credit, 0);
  if (debit !== credit || debit === 0) throw new Error('ledger: 借方と貸方が一致しません');
  return db.ledgerTransaction.create({
    data: {
      kind: t.kind, memo: t.memo, refType: t.refType, refId: t.refId, createdBy: t.createdBy,
      entries: { create: lines.filter((l) => l.debit || l.credit).map((l) => ({ ...l, userId: userIdOf(l.account) })) }
    },
    include: { entries: true }
  });
}

// 取引をそのまま打ち消す逆仕訳
export async function reverseTransaction(db: Tx, txId: string, memo: string, createdBy?: string) {
  const original = await db.ledgerTransaction.findUnique({ where: { id: txId }, include: { entries: true } });
  if (!original) throw new Error('ledger: 取引が見つかりません');
  return postTransaction(db, {
    kind: 'reversal', memo, refType: original.refType ?? undefined, refId: original.refId ?? undefined, createdBy,
    lines: original.entries.map((e) => ({ account: e.account, debit: e.credit, credit: e.debit }))
  });
}

export async function cashBalance(db: Tx, userId: string): Promise<number> {
  const agg = await db.ledgerEntry.aggregate({ where: { account: ACCOUNTS.userCash(userId) }, _sum: { credit: true, debit: true } });
  return (agg._sum.credit ?? 0) - (agg._sum.debit ?? 0);
}

export async function accountBalance(db: Tx, account: string): Promise<{ debit: number; credit: number }> {
  const agg = await db.ledgerEntry.aggregate({ where: { account }, _sum: { credit: true, debit: true } });
  return { debit: agg._sum.debit ?? 0, credit: agg._sum.credit ?? 0 };
}
