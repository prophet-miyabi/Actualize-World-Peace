import { z } from 'zod/v4';

// ページに追加できる機能（セクション）の一覧。
// 画面（Web・アプリ）はこの定義から質問フォームを自動で組み立てるため、機能の追加はここだけで済む。
// guide はGeminiが指示文を設計するときの「このセクションの目的」、rules はClaudeが必ず守る事実の扱い。

export type FeatureField = {
  key: string;
  label: string;
  type: 'text' | 'textarea';
  required?: boolean;
  placeholder?: string;
  help?: string;
};

export type Feature = {
  id: string;
  name: string;
  description: string;
  fields: FeatureField[];
  guide: string;
  rules: string;
  schema: z.ZodObject<any>;
};

export const FEATURES: Feature[] = [
  {
    id: 'menu',
    name: 'メニュー・料金表',
    description: 'サービスや商品と料金を、見やすい一覧で掲載します。',
    fields: [
      { key: 'items', label: 'メニューと料金', type: 'textarea', required: true, placeholder: 'カット / 4,400円 / シャンプー・ブロー込み\nカラー / 6,600円〜', help: '1行に1つ。「名前 / 料金 / 説明（任意）」の形で入力してください' },
      { key: 'note', label: '補足（任意）', type: 'text', placeholder: '表示価格はすべて税込です' }
    ],
    guide: '初めてのお客様が、料金に不安を感じず申し込めるようにする。各メニューの魅力を短い説明で伝える。',
    rules: '料金は入力された金額をそのまま使い、計算・変更・追加をしない。入力にないメニューは作らない。',
    schema: z.object({
      heading: z.string(),
      intro: z.string().describe('一覧の前に置く1〜2文'),
      items: z.array(z.object({ name: z.string(), price: z.string(), description: z.string() })),
      note: z.string().describe('補足。なければ空文字')
    })
  },
  {
    id: 'faq',
    name: 'よくある質問',
    description: 'お客様が申し込み前に気にする疑問に、先回りして答えます。',
    fields: [
      { key: 'facts', label: 'お客様に伝えたい事実', type: 'textarea', required: true, placeholder: '予約はLINEで24時間受付\n駐車場はありません（近くにコインパーキングあり）\n支払いは現金・カード・PayPay', help: '営業時間、予約方法、支払い方法、駐車場、キャンセル規定など' },
      { key: 'questions', label: '実際によく聞かれる質問（任意）', type: 'textarea', placeholder: '子ども連れでも大丈夫？' }
    ],
    guide: '申し込みをためらう理由（不安・手間・費用）を解消し、問い合わせの手間も減らす。',
    rules: '回答は入力された事実だけを根拠にする。事実から答えられない質問は載せない。',
    schema: z.object({
      heading: z.string(),
      items: z.array(z.object({ question: z.string(), answer: z.string() }))
    })
  },
  {
    id: 'access',
    name: 'アクセス・営業時間',
    description: '住所・営業時間・行き方を掲載し、地図へのリンクを付けます。',
    fields: [
      { key: 'address', label: '住所', type: 'text', required: true, placeholder: '東京都渋谷区〇〇1-2-3 〇〇ビル2F' },
      { key: 'hours', label: '営業時間', type: 'text', required: true, placeholder: '10:00〜19:00' },
      { key: 'closed', label: '定休日（任意）', type: 'text', placeholder: '毎週火曜日' },
      { key: 'station', label: '最寄り駅と行き方（任意）', type: 'text', placeholder: '渋谷駅 ハチ公口から徒歩5分' },
      { key: 'parking', label: '駐車場（任意）', type: 'text', placeholder: 'なし（近隣にコインパーキングあり）' }
    ],
    guide: '初めて来るお客様が迷わず到着できるようにする。',
    rules: '住所・時間・日付は入力どおりに書き、推測で補わない。',
    schema: z.object({
      heading: z.string(),
      directions: z.string().describe('行き方の案内文。情報がなければ空文字'),
      rows: z.array(z.object({ label: z.string(), value: z.string() }))
    })
  },
  {
    id: 'about',
    name: '私たちについて',
    description: '始めたきっかけや想いを伝え、お店の人柄で選ばれるようにします。',
    fields: [
      { key: 'story', label: '始めたきっかけ・大切にしていること', type: 'textarea', required: true, placeholder: '地元の人が気軽に通えるお店を作りたくて、2018年に独立しました…' },
      { key: 'owner', label: '代表者名（任意）', type: 'text', placeholder: '山田 花子' }
    ],
    guide: '読み手が「この人にお願いしたい」と感じる、温かく誠実な文章にする。',
    rules: '入力にない経歴・年数・受賞・人数などの事実を加えない。',
    schema: z.object({
      heading: z.string(),
      body: z.array(z.string()).describe('段落ごとの本文（2〜3段落）'),
      signature: z.string().describe('署名。代表者名がなければ空文字')
    })
  },
  {
    id: 'flow',
    name: 'ご利用の流れ',
    description: '申し込みから利用までの手順を、ステップで分かりやすく示します。',
    fields: [
      { key: 'steps', label: '申し込みから利用までの手順', type: 'textarea', required: true, placeholder: 'LINEで予約\n当日カウンセリング\n施術\nお会計' }
    ],
    guide: '初めての人の「何をすればいいか分からない」不安をなくす。',
    rules: '入力にない手順を追加しない。所要時間などは入力にある場合だけ書く。',
    schema: z.object({
      heading: z.string(),
      steps: z.array(z.object({ title: z.string(), description: z.string() }))
    })
  },
  {
    id: 'campaign',
    name: 'キャンペーン・特典',
    description: '実施中のキャンペーンや特典を目立たせて掲載します。',
    fields: [
      { key: 'offer', label: '特典の内容', type: 'text', required: true, placeholder: '初回カット20%オフ' },
      { key: 'conditions', label: '対象・条件', type: 'text', required: true, placeholder: '初めてご来店の方。LINEからのご予約限定' },
      { key: 'deadline', label: '期限（任意）', type: 'text', placeholder: '2026年12月31日まで' }
    ],
    guide: '特典の魅力が一目で伝わり、今申し込む理由になるようにする。',
    rules: '特典の内容・条件・期限は入力どおりに書く。入力にない限定性（先着・残りわずか等）や割引率を作らない。',
    schema: z.object({
      heading: z.string(),
      title: z.string(),
      description: z.string(),
      conditions: z.string(),
      deadline: z.string().describe('期限。なければ空文字')
    })
  }
];

export function getFeature(id: string) {
  return FEATURES.find((f) => f.id === id);
}

// 画面に渡す形（Zodのスキーマなど内部情報は含めない）
export function publicCatalog() {
  return FEATURES.map(({ id, name, description, fields }) => ({ id, name, description, fields }));
}
