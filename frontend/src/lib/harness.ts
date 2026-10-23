// AWP Harness の共通の型とラベル（画面側）。バックエンドの line/messages.ts の MessageSpec と同じ形
export type ActionType = 'uri' | 'tag' | 'enroll' | 'survey' | 'message' | 'booking';
export type Action = { label: string; type: ActionType; uri?: string | null; tag?: string | null; scenarioId?: string | null; surveyId?: string | null; text?: string | null; path?: string | null };
export type Card = { title?: string | null; text: string; imageUrl?: string | null; buttons: Action[] };
export type MessageSpec = { kind: 'text' | 'image' | 'buttons' | 'card' | 'carousel' | 'survey'; text?: string | null; imageUrl?: string | null; title?: string | null; buttons?: Action[] | null; cards?: Card[] | null; surveyId?: string | null; quickReplies?: Action[] | null };
export type Condition = { hasTag?: string | null; notTag?: string | null; minScore?: number | null; stages?: string[] | null; answered?: { surveyId: string; key: string; value?: string | null } | null; field?: { key: string; value: string } | null };
export type Audience = { all?: boolean; tags?: string[] | null; excludeTags?: string[] | null; stages?: string[] | null; minScore?: number | null; source?: string | null; field?: { key: string; value: string } | null; lineAccountId?: string | null };

export const KIND_LABEL: Record<MessageSpec['kind'], string> = { text: '文章', image: '画像', buttons: 'ボタン付き', card: 'カード', carousel: 'カルーセル', survey: 'アンケート' };
export const ACTION_LABEL: Record<ActionType, string> = { uri: 'リンクを開く', booking: '予約フォームを開く', tag: 'タグを付ける', enroll: 'シナリオを始める', survey: 'アンケートを始める', message: '文字を送る' };
export const STAGE_LABEL: Record<string, string> = { lead: '見込み', engaged: '反応あり', booked: '予約済み', customer: 'お客様', lost: '離脱' };
export const emptySpec = (): MessageSpec => ({ kind: 'text', text: '' });
export const specSummary = (s: MessageSpec | null | undefined) => !s ? '' : s.kind === 'carousel' ? `カルーセル ${s.cards?.length ?? 0} 枚` : `${KIND_LABEL[s.kind]}: ${(s.title || s.text || s.imageUrl || '').slice(0, 60)}`;
