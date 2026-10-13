import prisma from '../prisma';

// 参加の記録。将来の「参加配当」の根拠になる事実だけを残す（金額ではなく、何をいくつしたか）。
// 配り方（比率・均等部分）は会議室の未決。ここでは記録だけを行う
export const CONTRIBUTION_POINTS: Record<string, number> = {
  post: 2,              // 投稿した
  comment: 1,           // 返信した
  like_received: 1,     // 投稿・ページにいいねをもらった
  follow_received: 2,   // フォローされた
  page_published: 5,    // ページを公開した
  referral: 10,         // 紹介で登録があった
  order_completed: 5    // 注文を完了した（売り手）
};

export async function contribute(userId: string, kind: keyof typeof CONTRIBUTION_POINTS, refId?: string | null) {
  try {
    await prisma.contribution.create({ data: { userId, kind, points: CONTRIBUTION_POINTS[kind] ?? 1, refId: refId ?? null } });
  } catch (e: any) {
    console.error('contribution record failed', kind, e?.message);
  }
}

export async function contributionSummary(userId: string) {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [total, recent, byKind] = await Promise.all([
    prisma.contribution.aggregate({ where: { userId }, _sum: { points: true } }),
    prisma.contribution.aggregate({ where: { userId, createdAt: { gte: since30 } }, _sum: { points: true } }),
    prisma.contribution.groupBy({ by: ['kind'], where: { userId }, _sum: { points: true }, _count: { _all: true } })
  ]);
  return {
    totalPoints: total._sum.points ?? 0,
    last30Points: recent._sum.points ?? 0,
    byKind: byKind.map((k) => ({ kind: k.kind, points: k._sum.points ?? 0, count: k._count._all }))
  };
}
