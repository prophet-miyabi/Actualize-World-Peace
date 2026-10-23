'use client';
import { ACTION_LABEL, KIND_LABEL, type Action, type ActionType, type MessageSpec } from '@/lib/harness';

// 「送る内容」を組み立てる共通の部品（文章・画像・ボタン付き・カード・カルーセル・クイックリプライ）。スマホ幅で 1 列
type Refs = { scenarios: { id: string; name: string }[]; surveys: { id: string; name: string }[]; myPath: string };
type Props = { value: MessageSpec; onChange: (v: MessageSpec) => void; refs: Refs; compact?: boolean };

const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-base';
const small = 'rounded-full border px-3 py-1 text-xs font-bold';
const KINDS: MessageSpec['kind'][] = ['text', 'image', 'buttons', 'card', 'carousel'];

function ActionRow({ a, onChange, onRemove, refs }: { a: Action; onChange: (a: Action) => void; onRemove: () => void; refs: Refs }) {
  return (
    <div className="rounded-xl border border-gray-200 p-2 space-y-2">
      <div className="flex gap-2">
        <input className={input} value={a.label} maxLength={20} onChange={(e) => onChange({ ...a, label: e.target.value })} placeholder="ボタンの文字（20字まで）" />
        <select className={`${input} w-40 shrink-0`} value={a.type} onChange={(e) => onChange({ ...a, type: e.target.value as ActionType })}>{(Object.keys(ACTION_LABEL) as ActionType[]).map((t) => <option key={t} value={t}>{ACTION_LABEL[t]}</option>)}</select>
      </div>
      {a.type === 'uri' && <input className={input} value={a.uri ?? ''} onChange={(e) => onChange({ ...a, uri: e.target.value })} placeholder={`${refs.myPath || '/your-page'} または https://…（AWP 内なら顧客 ID が自動で付きます）`} />}
      {a.type === 'booking' && <input className={input} value={a.path ?? ''} onChange={(e) => onChange({ ...a, path: e.target.value })} placeholder={`${refs.myPath || '/your-page'}#reserve`} />}
      {a.type === 'tag' && <input className={input} value={a.tag ?? ''} onChange={(e) => onChange({ ...a, tag: e.target.value })} placeholder="付けるタグ（例: 興味あり）" />}
      {a.type === 'enroll' && <select className={input} value={a.scenarioId ?? ''} onChange={(e) => onChange({ ...a, scenarioId: e.target.value })}><option value="">シナリオを選ぶ</option>{refs.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      {a.type === 'survey' && <select className={input} value={a.surveyId ?? ''} onChange={(e) => onChange({ ...a, surveyId: e.target.value })}><option value="">アンケートを選ぶ</option>{refs.surveys.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
      {a.type === 'message' && <input className={input} value={a.text ?? ''} onChange={(e) => onChange({ ...a, text: e.target.value })} placeholder="押したときに送られる文字（省略でボタンの文字）" />}
      <button type="button" onClick={onRemove} className="text-xs text-red-600 underline">このボタンを消す</button>
    </div>
  );
}

function ActionList({ items, onChange, refs, max, label }: { items: Action[]; onChange: (a: Action[]) => void; refs: Refs; max: number; label: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-gray-600">{label}（{items.length}/{max}）</p>
      {items.map((a, i) => <ActionRow key={i} a={a} refs={refs} onChange={(na) => onChange(items.map((x, k) => (k === i ? na : x)))} onRemove={() => onChange(items.filter((_, k) => k !== i))} />)}
      {items.length < max && <button type="button" onClick={() => onChange([...items, { label: '', type: 'uri', uri: refs.myPath || '/' }])} className={small}>＋ {label}を足す</button>}
    </div>
  );
}

export default function MessageSpecEditor({ value, onChange, refs, compact }: Props) {
  const v = value;
  return (
    <div className="space-y-2">
      <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
        {KINDS.map((k) => <button key={k} type="button" onClick={() => onChange({ ...v, kind: k, buttons: v.buttons ?? [], cards: v.cards ?? (k === 'carousel' ? [{ text: '', buttons: [] }] : v.cards) })} className={`${small} shrink-0 ${v.kind === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600'}`}>{KIND_LABEL[k]}</button>)}
      </div>
      {(v.kind === 'buttons' || v.kind === 'card') && <input className={input} value={v.title ?? ''} maxLength={40} onChange={(e) => onChange({ ...v, title: e.target.value })} placeholder="見出し（任意）" />}
      {v.kind !== 'carousel' && <textarea className={`${input} ${compact ? 'min-h-[64px]' : 'min-h-[96px]'}`} value={v.text ?? ''} onChange={(e) => onChange({ ...v, text: e.target.value })} placeholder={v.kind === 'image' ? '画像に添える文章（任意）' : '文章。{{name}} さん / {{link}} / {こんにちは|はじめまして} が使えます'} />}
      {(v.kind === 'image' || v.kind === 'card') && <input className={input} value={v.imageUrl ?? ''} onChange={(e) => onChange({ ...v, imageUrl: e.target.value })} placeholder="画像の URL（https://…）。ページに入れた写真の URL をそのまま使えます" />}
      {(v.kind === 'buttons' || v.kind === 'card') && <ActionList items={v.buttons ?? []} onChange={(b) => onChange({ ...v, buttons: b })} refs={refs} max={4} label="ボタン" />}
      {v.kind === 'carousel' && (
        <div className="space-y-3">
          {(v.cards ?? []).map((c, i) => (
            <div key={i} className="rounded-2xl border-2 border-gray-200 p-3 space-y-2">
              <p className="text-xs font-bold">カード {i + 1}</p>
              <input className={input} value={c.title ?? ''} maxLength={40} onChange={(e) => onChange({ ...v, cards: v.cards!.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} placeholder="見出し" />
              <textarea className={`${input} min-h-[64px]`} value={c.text} onChange={(e) => onChange({ ...v, cards: v.cards!.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })} placeholder="文章" />
              <input className={input} value={c.imageUrl ?? ''} onChange={(e) => onChange({ ...v, cards: v.cards!.map((x, k) => (k === i ? { ...x, imageUrl: e.target.value } : x)) })} placeholder="画像の URL（任意）" />
              <ActionList items={c.buttons} onChange={(b) => onChange({ ...v, cards: v.cards!.map((x, k) => (k === i ? { ...x, buttons: b } : x)) })} refs={refs} max={3} label="ボタン" />
              <button type="button" onClick={() => onChange({ ...v, cards: v.cards!.filter((_, k) => k !== i) })} className="text-xs text-red-600 underline">このカードを消す</button>
            </div>
          ))}
          {(v.cards?.length ?? 0) < 10 && <button type="button" onClick={() => onChange({ ...v, cards: [...(v.cards ?? []), { text: '', buttons: [] }] })} className={small}>＋ カードを足す</button>}
        </div>
      )}
      <details className="rounded-xl bg-gray-50 p-2">
        <summary className="text-xs font-bold text-gray-600 cursor-pointer">画面下の選択肢（クイックリプライ・{v.quickReplies?.length ?? 0}）</summary>
        <div className="mt-2"><ActionList items={v.quickReplies ?? []} onChange={(q) => onChange({ ...v, quickReplies: q })} refs={refs} max={13} label="選択肢" /></div>
      </details>
    </div>
  );
}
