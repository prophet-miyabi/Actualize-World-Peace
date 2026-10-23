// アンケート形式のボタン選択: 質問を 1 問ずつクイックリプライで送り、回答をカスタム項目・タグ・シナリオに結びつける。
// 回答は LINE の postback（awp:survey:<id>:<問番号>:<選択肢番号>）で受け取る。
import { z } from 'zod/v4';
import prisma from '../prisma';
import { MessageSpecSchema, surveyQuestionMessage, type MessageSpec } from '../line/messages';
import { lineClient, pickLineAccount, pushSpec } from '../line/send';

export const SurveyOptionSchema = z.object({ label: z.string().trim().min(1).max(20), value: z.string().trim().min(1).max(100), tag: z.string().trim().max(30).optional().nullable(), scenarioId: z.string().optional().nullable() });
export const SurveyQuestionSchema = z.object({ key: z.string().trim().min(1).max(40), text: z.string().trim().min(1).max(500), options: z.array(SurveyOptionSchema).min(1).max(13) });
export const SurveySchema = z.object({
  name: z.string().trim().min(1).max(60),
  questions: z.array(SurveyQuestionSchema).min(1).max(10),
  onComplete: z.object({ replyMessage: MessageSpecSchema.optional().nullable(), tag: z.string().trim().max(30).optional().nullable(), scenarioId: z.string().optional().nullable(), linkPath: z.string().trim().max(300).optional().nullable() }).optional().nullable(),
  active: z.boolean().default(true)
});
export type SurveyQuestion = z.infer<typeof SurveyQuestionSchema>;

type Contact = { id: string; cid: string; lineUserId: string | null; displayName: string | null; blocked?: boolean };
type Hooks = { addTag: (ownerId: string, contactId: string, name: string) => Promise<void>; enroll: (scenarioId: string, contactId: string) => Promise<unknown>; touch: (contactId: string, type: string, payload?: Record<string, unknown>, score?: number) => Promise<void> };

async function sendQuestion(ownerId: string, contact: Contact, surveyId: string, idx: number, q: SurveyQuestion, replyToken?: string | null, accountId?: string | null) {
  const msg = surveyQuestionMessage(surveyId, idx, q);
  const account = await pickLineAccount(ownerId, accountId);
  if (!account || !contact.lineUserId) return false;
  try {
    if (replyToken) await lineClient(account).replyMessage({ replyToken, messages: [msg] });
    else await lineClient(account).pushMessage({ to: contact.lineUserId, messages: [msg] });
  } catch {
    if (!replyToken) return false;
    try { await lineClient(account).pushMessage({ to: contact.lineUserId, messages: [msg] }); } catch { return false; }
  }
  await prisma.crmMessage.create({ data: { ownerId, contactId: contact.id, lineAccountId: account.id, direction: 'out', kind: 'survey', text: q.text, payload: { surveyId, idx, options: q.options.map((o) => o.label) } as any, source: 'survey', status: 'sent' } }).catch(() => {});
  return true;
}

// アンケートを始める（1 問目を送る）
export async function startSurvey(ownerId: string, surveyId: string, contact: Contact, replyToken?: string | null, hooks?: Hooks) {
  const s = await prisma.crmSurvey.findFirst({ where: { id: surveyId, ownerId, active: true } });
  if (!s) return false;
  const questions = s.questions as SurveyQuestion[];
  await prisma.crmSurveyAnswer.upsert({ where: { surveyId_contactId: { surveyId, contactId: contact.id } }, update: { answers: {}, currentIdx: 0, completedAt: null }, create: { surveyId, contactId: contact.id, answers: {}, currentIdx: 0 } });
  await prisma.crmSurvey.update({ where: { id: surveyId }, data: { starts: { increment: 1 } } });
  if (hooks) await hooks.touch(contact.id, 'survey_start', { surveyId }, 3);
  return sendQuestion(ownerId, contact, surveyId, 0, questions[0], replyToken);
}

// 回答を受け取る → 保存 → 次の質問 or 完了処理
export async function answerSurvey(ownerId: string, surveyId: string, idx: number, optionIdx: number, contact: Contact, replyToken: string | null, hooks: Hooks) {
  const s = await prisma.crmSurvey.findFirst({ where: { id: surveyId, ownerId } });
  if (!s) return { ok: false as const };
  const questions = s.questions as SurveyQuestion[];
  const q = questions[idx];
  const opt = q?.options[optionIdx];
  if (!q || !opt) return { ok: false as const };
  const row = await prisma.crmSurveyAnswer.findUnique({ where: { surveyId_contactId: { surveyId, contactId: contact.id } } });
  const answers = { ...((row?.answers ?? {}) as Record<string, unknown>), [q.key]: opt.value };
  const contactRow = await prisma.crmContact.findUnique({ where: { id: contact.id }, select: { fields: true } });
  await prisma.crmContact.update({ where: { id: contact.id }, data: { fields: { ...((contactRow?.fields ?? {}) as Record<string, unknown>), [q.key]: opt.value } as any } });
  await prisma.crmMessage.create({ data: { ownerId, contactId: contact.id, direction: 'in', kind: 'postback', text: opt.label, payload: { surveyId, key: q.key, value: opt.value } as any, status: 'received' } }).catch(() => {});
  if (opt.tag) await hooks.addTag(ownerId, contact.id, opt.tag);
  if (opt.scenarioId) await hooks.enroll(opt.scenarioId, contact.id).catch(() => {});
  const next = questions[idx + 1];
  if (next) {
    await prisma.crmSurveyAnswer.upsert({ where: { surveyId_contactId: { surveyId, contactId: contact.id } }, update: { answers: answers as any, currentIdx: idx + 1 }, create: { surveyId, contactId: contact.id, answers: answers as any, currentIdx: idx + 1 } });
    await sendQuestion(ownerId, contact, surveyId, idx + 1, next, replyToken);
    return { ok: true as const, done: false };
  }
  await prisma.crmSurveyAnswer.upsert({ where: { surveyId_contactId: { surveyId, contactId: contact.id } }, update: { answers: answers as any, currentIdx: idx + 1, completedAt: new Date() }, create: { surveyId, contactId: contact.id, answers: answers as any, currentIdx: idx + 1, completedAt: new Date() } });
  await prisma.crmSurvey.update({ where: { id: surveyId }, data: { completes: { increment: 1 } } });
  await hooks.touch(contact.id, 'survey_done', { surveyId, answers }, 8);
  const done = (s.onComplete ?? {}) as { replyMessage?: MessageSpec | null; tag?: string | null; scenarioId?: string | null; linkPath?: string | null };
  if (done.tag) await hooks.addTag(ownerId, contact.id, done.tag);
  if (done.scenarioId) await hooks.enroll(done.scenarioId, contact.id).catch(() => {});
  const reply: MessageSpec = done.replyMessage ?? { kind: 'text', text: 'ご回答ありがとうございました。' };
  await pushSpec(ownerId, contact, reply, { kind: 'survey', refId: surveyId, vars: done.linkPath ? { link: `${(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || 'https://awp-frontend-bf17.onrender.com').replace(/\/$/, '')}${done.linkPath.startsWith('/') ? done.linkPath : `/${done.linkPath}`}?awp_cid=${contact.cid}&utm_source=line&utm_medium=survey` } : undefined });
  return { ok: true as const, done: true, answers };
}
