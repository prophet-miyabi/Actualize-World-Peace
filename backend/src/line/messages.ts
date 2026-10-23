// MessageSpec: AWP の画面で組み立てる「送る内容」の共通の形。LINE の公式メッセージ（text / image / Flex / クイックリプライ）に変換する。
// - text:     文章（Spintax・{{name}}・{{link}} 可）
// - image:    画像（https の URL）
// - buttons:  文章 ＋ ボタン（URL を開く / タグを付ける / シナリオを始める / アンケートを始める / 文字を送る）
// - card:     画像 ＋ 見出し ＋ 文章 ＋ ボタン（1 枚）
// - carousel: card を横に並べる（最大 10）
// - survey:   アンケート（質問はサーバー側で 1 問ずつクイックリプライとして送る）
// quickReplies はどの種類にも付けられる（画面下に出る選択肢。アンケート形式のボタン選択に使う）
import { z } from 'zod/v4';
import type { messagingApi } from '@line/bot-sdk';
import { renderTrackedMessage } from '../automation/awpDataAssetEngine';

const short = (n: number) => z.string().trim().max(n);
const HttpsUrl = z.string().trim().url().refine((u) => u.startsWith('https://'), 'https の URL にしてください').max(1000);

export const ActionSchema = z.object({
  label: short(20).min(1),
  type: z.enum(['uri', 'tag', 'enroll', 'survey', 'message', 'booking']),
  uri: short(1000).optional().nullable(),        // type=uri: 開く URL（AWP 内のパスなら awp_cid を付ける）
  tag: short(30).optional().nullable(),           // type=tag
  scenarioId: z.string().optional().nullable(),   // type=enroll
  surveyId: z.string().optional().nullable(),     // type=survey
  text: short(300).optional().nullable(),         // type=message: 送る文字 / tag・enroll のとき返す一言
  path: short(300).optional().nullable()          // type=booking: 予約フォームのパス（例: /slug#reserve）
});
export type Action = z.infer<typeof ActionSchema>;

export const CardSchema = z.object({ title: short(40).optional().nullable(), text: short(300).min(1), imageUrl: HttpsUrl.optional().nullable(), buttons: z.array(ActionSchema).max(4).default([]) });

export const MessageSpecSchema = z.object({
  kind: z.enum(['text', 'image', 'buttons', 'card', 'carousel', 'survey']).default('text'),
  text: short(2000).optional().nullable(),
  imageUrl: HttpsUrl.optional().nullable(),
  title: short(40).optional().nullable(),
  buttons: z.array(ActionSchema).max(4).optional().nullable(),
  cards: z.array(CardSchema).max(10).optional().nullable(),
  surveyId: z.string().optional().nullable(),
  quickReplies: z.array(ActionSchema).max(13).optional().nullable()
});
export type MessageSpec = z.infer<typeof MessageSpecSchema>;

export type RenderVars = { name?: string; link?: string; cid: string; front: string; extra?: Record<string, string> };
export type Rendered = { messages: messagingApi.Message[]; text: string; templateHash: string; chosenVariants: string[] };

const esc = (s: string) => s.replace(/[\u0000-\u001f]/g, ' ');

function withCid(url: string, v: RenderVars, extra: Record<string, string>) {
  try {
    const u = new URL(url.startsWith('http') ? url : `${v.front}${url.startsWith('/') ? url : `/${url}`}`);
    if (u.origin === v.front) {
      u.searchParams.set('awp_cid', v.cid);
      for (const [k, val] of Object.entries(extra)) u.searchParams.set(k, val);
    }
    return u.toString();
  } catch { return url; }
}

// ボタン・クイックリプライの動作。postback の data は awp:<type>:<ref> の形で Webhook が解釈する
export function toLineAction(a: Action, v: RenderVars): messagingApi.Action {
  const label = esc(a.label).slice(0, 20);
  switch (a.type) {
    case 'uri': return { type: 'uri', label, uri: withCid(a.uri || '/', v, { utm_source: 'line', utm_medium: 'button' }) };
    case 'booking': return { type: 'uri', label, uri: withCid(a.path || '/', v, { utm_source: 'line', utm_medium: 'booking' }) };
    case 'tag': return { type: 'postback', label, data: `awp:tag:${a.tag ?? ''}`, displayText: label };
    case 'enroll': return { type: 'postback', label, data: `awp:enroll:${a.scenarioId ?? ''}`, displayText: label };
    case 'survey': return { type: 'postback', label, data: `awp:survey:${a.surveyId ?? ''}:start`, displayText: label };
    case 'message': default: return { type: 'message', label, text: (a.text || a.label).slice(0, 300) };
  }
}

function quickReply(items: Action[] | null | undefined, v: RenderVars): messagingApi.QuickReply | undefined {
  if (!items?.length) return undefined;
  return { items: items.slice(0, 13).map((a) => ({ type: 'action', action: toLineAction(a, v) })) };
}

function bubble(c: { title?: string | null; text: string; imageUrl?: string | null; buttons?: Action[] | null }, v: RenderVars): messagingApi.FlexBubble {
  const body: messagingApi.FlexComponent[] = [];
  if (c.title) body.push({ type: 'text', text: esc(c.title), weight: 'bold', size: 'lg', wrap: true });
  body.push({ type: 'text', text: esc(c.text), wrap: true, size: 'sm', color: '#333333' });
  const footer: messagingApi.FlexComponent[] = (c.buttons ?? []).slice(0, 4).map((b, i) => ({ type: 'button', style: i === 0 ? 'primary' : 'secondary', height: 'sm', action: toLineAction(b, v) }));
  return {
    type: 'bubble',
    ...(c.imageUrl ? { hero: { type: 'image', url: c.imageUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } } : {}),
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: body },
    ...(footer.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer } } : {})
  };
}

// MessageSpec → LINE メッセージ配列。文章は Spintax と変数を展開する
export function renderSpec(spec: MessageSpec, v: RenderVars): Rendered {
  const vars = { name: v.name ?? '', link: v.link ?? '', ...(v.extra ?? {}) };
  const r = renderTrackedMessage(spec.text ?? '', vars);
  const text = v.link && spec.text && !spec.text.includes('{{link}}') && spec.kind === 'text' ? `${r.text}\n${v.link}` : r.text;
  const qr = quickReply(spec.quickReplies, v);
  let messages: messagingApi.Message[] = [];
  switch (spec.kind) {
    case 'image':
      if (spec.imageUrl) messages.push({ type: 'image', originalContentUrl: spec.imageUrl, previewImageUrl: spec.imageUrl });
      if (text) messages.push({ type: 'text', text });
      break;
    case 'buttons':
      messages.push({ type: 'flex', altText: (spec.title || text || 'ご案内').slice(0, 400), contents: bubble({ title: spec.title, text: text || ' ', buttons: spec.buttons }, v) });
      break;
    case 'card':
      messages.push({ type: 'flex', altText: (spec.title || text || 'ご案内').slice(0, 400), contents: bubble({ title: spec.title, text: text || ' ', imageUrl: spec.imageUrl, buttons: spec.buttons }, v) });
      break;
    case 'carousel': {
      const cards = (spec.cards ?? []).slice(0, 10);
      if (cards.length) messages.push({ type: 'flex', altText: (spec.title || cards[0].title || cards[0].text).slice(0, 400), contents: { type: 'carousel', contents: cards.map((c) => bubble({ ...c, text: renderTrackedMessage(c.text, vars).text }, v)) } });
      if (text) messages.unshift({ type: 'text', text });
      break;
    }
    case 'survey':
      // アンケート本体は surveys.ts が 1 問ずつ送る。ここでは導入文だけ
      if (text) messages.push({ type: 'text', text });
      break;
    case 'text':
    default:
      messages.push({ type: 'text', text: text || ' ' });
  }
  if (!messages.length) messages.push({ type: 'text', text: text || ' ' });
  if (qr) (messages[messages.length - 1] as any).quickReply = qr;
  return { messages: messages.slice(0, 5), text, templateHash: r.templateHash, chosenVariants: r.chosenVariants };
}

// 文章だけの旧テンプレート（CrmScenarioStep.template / EngagementGate.replyTemplate）を MessageSpec に
export const textSpec = (text: string): MessageSpec => ({ kind: 'text', text });

// アンケートの 1 問をクイックリプライで
export function surveyQuestionMessage(surveyId: string, idx: number, q: { text: string; options: { label: string; value: string }[] }): messagingApi.Message {
  return {
    type: 'text', text: esc(q.text).slice(0, 2000),
    quickReply: { items: q.options.slice(0, 13).map((o, i) => ({ type: 'action', action: { type: 'postback', label: esc(o.label).slice(0, 20), data: `awp:survey:${surveyId}:${idx}:${i}`, displayText: esc(o.label).slice(0, 20) } })) }
  };
}
