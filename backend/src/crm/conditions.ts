// ステップ配信・配信対象の条件評価（タグ・スコア・段階・アンケートの回答・カスタム項目）
import { z } from 'zod/v4';
import prisma from '../prisma';

export const ConditionSchema = z.object({
  hasTag: z.string().trim().max(30).optional().nullable(),
  notTag: z.string().trim().max(30).optional().nullable(),
  minScore: z.number().int().min(0).max(100).optional().nullable(),
  stages: z.array(z.enum(['lead', 'engaged', 'booked', 'customer', 'lost'])).max(5).optional().nullable(),
  answered: z.object({ surveyId: z.string(), key: z.string().max(40), value: z.string().max(100).optional().nullable() }).optional().nullable(),
  field: z.object({ key: z.string().max(40), value: z.string().max(200) }).optional().nullable()
});
export type Condition = z.infer<typeof ConditionSchema>;

export const AudienceSchema = z.object({
  all: z.boolean().optional(),
  tags: z.array(z.string().trim().max(30)).max(20).optional().nullable(),
  excludeTags: z.array(z.string().trim().max(30)).max(20).optional().nullable(),
  stages: z.array(z.enum(['lead', 'engaged', 'booked', 'customer', 'lost'])).max(5).optional().nullable(),
  minScore: z.number().int().min(0).max(100).optional().nullable(),
  source: z.string().trim().max(20).optional().nullable(),
  field: z.object({ key: z.string().max(40), value: z.string().max(200) }).optional().nullable(),
  lineAccountId: z.string().optional().nullable()
});
export type Audience = z.infer<typeof AudienceSchema>;

type ContactLike = { id: string; leadScore: number; stage: string; fields: unknown; tags: { tag: { name: string } }[] };

export async function evaluateCondition(c: ContactLike, cond: Condition | null | undefined): Promise<boolean> {
  if (!cond) return true;
  const tags = new Set(c.tags.map((t) => t.tag.name));
  if (cond.hasTag && !tags.has(cond.hasTag)) return false;
  if (cond.notTag && tags.has(cond.notTag)) return false;
  if (typeof cond.minScore === 'number' && c.leadScore < cond.minScore) return false;
  if (cond.stages?.length && !cond.stages.includes(c.stage as any)) return false;
  const fields = (c.fields ?? {}) as Record<string, unknown>;
  if (cond.field && String(fields[cond.field.key] ?? '') !== cond.field.value) return false;
  if (cond.answered) {
    const a = await prisma.crmSurveyAnswer.findUnique({ where: { surveyId_contactId: { surveyId: cond.answered.surveyId, contactId: c.id } } });
    if (!a) return false;
    const answers = (a.answers ?? {}) as Record<string, unknown>;
    if (!(cond.answered.key in answers)) return false;
    if (cond.answered.value != null && String(answers[cond.answered.key]) !== cond.answered.value) return false;
  }
  return true;
}

// 配信対象の顧客（LINE で送れる人だけ）
export async function resolveAudience(ownerId: string, a: Audience) {
  const where: any = { ownerId, lineUserId: { not: null }, blocked: false };
  if (a.stages?.length) where.stage = { in: a.stages };
  if (typeof a.minScore === 'number') where.leadScore = { gte: a.minScore };
  if (a.source) where.source = a.source;
  if (a.lineAccountId) where.lineAccountId = a.lineAccountId;
  if (a.tags?.length) where.tags = { some: { tag: { name: { in: a.tags } } } };
  if (a.excludeTags?.length) where.NOT = { tags: { some: { tag: { name: { in: a.excludeTags } } } } };
  const rows = await prisma.crmContact.findMany({ where, select: { id: true, cid: true, lineUserId: true, displayName: true, blocked: true, fields: true } });
  return a.field ? rows.filter((r) => String(((r.fields ?? {}) as Record<string, unknown>)[a.field!.key] ?? '') === a.field!.value) : rows;
}
