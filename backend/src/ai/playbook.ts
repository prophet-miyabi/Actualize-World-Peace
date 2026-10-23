import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import prisma from '../prisma';
import { aiClient, describeAiError } from '../lib/aiUsage';
import { COMPANY_MODELS } from '../company/registry';
import { FEATURES } from '../features/catalog';

// ---------------------------------------------------------------------------
// 業種別「人気ページの手本」（IndustryPlaybook）
//
// ユーザーが入力した内容から業種を判定し、その業種で評価の高い日本のホームページ・LPを
// Claude が Web 検索で調べて、構成・見出しの型・信頼要素・CTA・配色・写真の傾向を手本としてまとめる。
// 手本はDBに保存して全ユーザーで共有し（業種ごとに1回作れば済む）、約60日で作り直す。
// デザイン（design.ts）・文章（sectionWriter.ts）・対話（builderAgent.ts）がこの手本を参照する。
//
// 守ること: 手本は「型」だけを借りる。他社の文章・実績・数字をユーザーのページに持ち込まない。
// ---------------------------------------------------------------------------

export type Industry = { key: string; label: string; preset: string; re: RegExp | null };

export const INDUSTRIES: Industry[] = [
  { key: 'hair_salon', label: '美容室・ヘアサロン', preset: 'elegant', re: /美容室|美容院|ヘアサロン|ヘアー?サロン|カット|カラー|パーマ|理容|バーバー|床屋|ヘッドスパ/ },
  { key: 'nail_eyelash', label: 'ネイル・まつげ・眉', preset: 'elegant', re: /ネイル|まつ毛|まつげ|マツエク|アイラッシュ|眉毛|アイブロウ/ },
  { key: 'esthetic', label: 'エステ・脱毛', preset: 'elegant', re: /エステ|脱毛|フェイシャル|痩身|美肌|小顔/ },
  { key: 'massage_seitai', label: '整体・マッサージ・リラクゼーション', preset: 'calm', re: /整体|マッサージ|リラクゼーション|もみほぐし|カイロ|骨盤|リフレ/ },
  { key: 'acupuncture', label: '鍼灸・接骨院', preset: 'calm', re: /鍼|針治療|灸|接骨|整骨|柔道整復/ },
  { key: 'yoga_pilates', label: 'ヨガ・ピラティス', preset: 'calm', re: /ヨガ|ピラティス|瞑想|マインドフルネス/ },
  { key: 'gym_fitness', label: 'ジム・パーソナルトレーニング', preset: 'bold', re: /ジム|フィットネス|トレーニング|パーソナル|ボクシング|格闘|キックボクシング|筋トレ/ },
  { key: 'dance_music_school', label: 'ダンス・音楽教室', preset: 'bold', re: /ダンス|音楽教室|ピアノ|ギター|ボーカル|ボイトレ|バレエ|ドラム|バイオリン/ },
  { key: 'cafe', label: 'カフェ・喫茶店', preset: 'fresh', re: /カフェ|喫茶|コーヒー|珈琲|cafe/i },
  { key: 'restaurant', label: 'レストラン・飲食店', preset: 'fresh', re: /レストラン|食堂|居酒屋|バル|イタリアン|フレンチ|焼肉|寿司|鮨|ラーメン|そば|蕎麦|うどん|定食|ビストロ|料理|焼き鳥|バー|割烹|中華|カレー|弁当/ },
  { key: 'bakery_sweets', label: 'パン・スイーツ', preset: 'fresh', re: /パン|ベーカリー|スイーツ|ケーキ|菓子|和菓子|洋菓子|クレープ|ドーナツ|チョコ|焼き菓子/ },
  { key: 'dental', label: '歯科医院', preset: 'warm', re: /歯科|歯医者|デンタル|矯正歯科/ },
  { key: 'clinic', label: 'クリニック・医院', preset: 'warm', re: /クリニック|医院|病院|診療所|内科|皮膚科|小児科|整形外科|眼科|耳鼻|心療|精神科|産婦人科/ },
  { key: 'childcare_school', label: '保育・学習塾・習い事', preset: 'warm', re: /保育|幼稚園|学童|塾|学習|英会話|英語教室|そろばん|習字|書道|プログラミング教室|家庭教師|受験|スクール|教室/ },
  { key: 'nursing_care', label: '介護・福祉', preset: 'warm', re: /介護|デイサービス|訪問看護|福祉|グループホーム|障が?い|就労支援|ケアマネ/ },
  { key: 'pet', label: 'ペット・トリミング', preset: 'warm', re: /ペット|トリミング|動物病院|犬|猫|ドッグ|キャット|ペットホテル/ },
  { key: 'photo_video', label: '写真・映像', preset: 'trust', re: /フォト|写真|撮影|カメラマン|映像|動画制作|ムービー/ },
  { key: 'design_creative', label: 'デザイン・イラスト・制作', preset: 'trust', re: /デザイン|イラスト|制作|クリエイター|Web制作|ロゴ|漫画|マンガ/ },
  { key: 'music_artist', label: '音楽・アーティスト活動', preset: 'bold', re: /音楽|バンド|アーティスト|シンガー|作曲|DJ|ライブ|ミュージシャン|歌手/ },
  { key: 'handmade_shop', label: 'ハンドメイド・雑貨・物販', preset: 'elegant', re: /ハンドメイド|雑貨|アクセサリー|物販|ショップ|販売|作家|工房|革|陶芸|キャンドル|古着|アパレル|セレクト/ },
  { key: 'flower_bridal', label: '花・ブライダル', preset: 'elegant', re: /フラワー|花屋|生花|ブライダル|ウェディング|結婚式|ブーケ/ },
  { key: 'professional', label: '士業・コンサル・専門サービス', preset: 'trust', re: /税理士|行政書士|司法書士|社労士|弁護士|コンサル|FP|ファイナンシャル|保険|不動産|会計|経営|コーチング|カウンセリング|占い|講師/ },
  { key: 'construction_repair', label: '建築・リフォーム・修理・清掃', preset: 'trust', re: /工務店|リフォーム|建築|塗装|電気工事|修理|水道|外構|ハウスクリーニング|清掃|エアコン|内装|大工|庭|造園|引っ越し|便利屋/ },
  { key: 'auto', label: '自動車・バイク', preset: 'bold', re: /自動車|車検|整備|バイク|カーショップ|中古車|板金|タイヤ|カー用品|洗車/ },
  { key: 'lodging', label: '宿泊・民泊・ゲストハウス', preset: 'calm', re: /民泊|ゲストハウス|旅館|ホテル|宿泊|宿|キャンプ場|グランピング/ },
  { key: 'agriculture', label: '農業・食品の直販', preset: 'fresh', re: /農園|農家|野菜|果物|果樹|直売|養蜂|はちみつ|漁|米|精米|食品/ },
  { key: 'other', label: 'その他の個人事業・お店', preset: 'trust', re: null }
];

export const INDUSTRY_KEYS = INDUSTRIES.map((i) => i.key);
export const industryOf = (key: string | null | undefined): Industry => INDUSTRIES.find((i) => i.key === key) ?? INDUSTRIES[INDUSTRIES.length - 1];

// 文章から業種を推定する（まず辞書、決まらなければ速いモデルで判定。どちらも外れれば other）
export function classifyIndustryByRules(text: string): string | null {
  const t = text || '';
  for (const ind of INDUSTRIES) if (ind.re && ind.re.test(t)) return ind.key;
  return null;
}

const ClassifySchema = z.object({ key: z.string().describe(`業種のキー。次のいずれか: ${INDUSTRY_KEYS.join(' / ')}`) });

export async function classifyIndustry(text: string): Promise<string> {
  const byRule = classifyIndustryByRules(text);
  if (byRule) return byRule;
  if (!process.env.ANTHROPIC_API_KEY || !text.trim()) return 'other';
  try {
    const client = aiClient();
    const r = await client.beta.messages.parse({
      model: COMPANY_MODELS.fast,
      max_tokens: 200,
      system: '日本の個人事業・お店の説明文から、最も近い業種のキーを1つ選びます。判断できなければ other。',
      messages: [{ role: 'user', content: `${text.slice(0, 1200)}\n\n選択肢:\n${INDUSTRIES.map((i) => `- ${i.key}: ${i.label}`).join('\n')}` }],
      output_config: { format: betaZodOutputFormat(ClassifySchema) }
    });
    const key = r.parsed_output?.key;
    return key && INDUSTRY_KEYS.includes(key) ? key : 'other';
  } catch (e: any) {
    console.error('classifyIndustry failed', e?.message);
    return 'other';
  }
}

// --- 手本の形 ----------------------------------------------------------------------------

import { benchmarkBrief } from '../automation/awpDataAssetEngine';

const SECTION_IDS = ['hero', 'strengths', ...FEATURES.map((f) => f.id), 'tools', 'line'] as const;

const PlaybookSchema = z.object({
  summary: z.string().describe('この業種のお客様が、ページのどこを見て決めるか（2〜3文）'),
  audience: z.string().describe('典型的な来店・依頼の動機と不安（1〜2文）'),
  decisionFactors: z.array(z.string()).describe('決め手になる要素（3〜6個、短い語句）'),
  sectionOrder: z.array(z.string()).describe(`人気ページに共通するセクションの並び。次のIDだけを使う: ${SECTION_IDS.join(' / ')}。hero を先頭に、line を末尾に`),
  recommendedFeatures: z.array(z.object({
    id: z.string().describe(`追加をすすめる機能のID。次のいずれか: ${FEATURES.map((f) => f.id).join(' / ')}`),
    reason: z.string().describe('なぜ人気ページに必ずあるのか（1文、店主向けの言葉）')
  })).describe('重要な順に3〜5個'),
  hero: z.object({
    eyebrowGuide: z.string().describe('見出しの上の小さな一行（業種・地域・対象）の作り方'),
    headlineGuide: z.string().describe('人気ページに共通する見出しの型（例: 「悩み→結果」「誰のための何」）。具体例を1つ、事実を含まない形で'),
    subcopyGuide: z.string().describe('見出しの下の1〜2文で何を伝えるか'),
    ctaLabel: z.string().describe('この業種で最も自然な主ボタンの文言（12文字以内）'),
    secondaryCtaLabel: z.string().describe('補助ボタンの文言（10文字以内、例: メニューを見る）')
  }),
  tone: z.string().describe('文章のトーン（敬体／距離感／語彙の方向）を1〜2文で'),
  trustElements: z.array(z.string()).describe('人気ページが必ず載せている信頼の要素（資格・写真・料金の明示・流れ・Q&Aなど）。店主が事実として用意できるもの'),
  writingRules: z.array(z.string()).describe('この業種の文章で守ると良いこと（4〜6個、短く）'),
  mustAvoid: z.array(z.string()).describe('この業種で避けるべき表現・設計（法規制を含む。例: 医療広告ガイドライン、景表法）'),
  visual: z.object({
    mood: z.string().describe('見た目の世界観を1文で'),
    imagery: z.string().describe('メイン写真の方向性（英語、生成用。人物の顔のアップ・文字・ロゴなし）'),
    primary: z.string().describe('人気ページに多いメインカラーの一例（#RRGGBB）'),
    background: z.string().describe('背景色の一例（#RRGGBB）'),
    font: z.string().describe('modern / elegant / friendly / bold のいずれか'),
    corner: z.string().describe('sharp / soft / round のいずれか'),
    heroLayout: z.string().describe('centered / split / imageBackground のいずれか'),
    strengthsStyle: z.string().describe('cards / numbered / minimal のいずれか')
  }),
  conversationHints: z.array(z.string()).describe('ページ作成の対話で、この業種なら必ず聞いておくべきこと（3〜5個）'),
  references: z.array(z.object({
    name: z.string(),
    url: z.string(),
    note: z.string().describe('何を参考にしたか（1文）')
  })).describe('調べた実在ページ（運営者の確認用。ユーザーのページには出さない）')
});

export type Playbook = z.infer<typeof PlaybookSchema> & { key: string; label: string; generatedAt: string; source: 'web' | 'model' | 'fallback'; benchmark?: string | null };

const FRESH_MS = 60 * 24 * 3600_000;
// 「作成中」のまま止まったもの（デプロイでサーバーが再起動した等）は、この時間を過ぎたら作り直してよい
const STUCK_MS = 15 * 60_000;
const isStuck = (row: { status: string; updatedAt: Date }) => row.status === 'generating' && Date.now() - row.updatedAt.getTime() > STUCK_MS;
const memory = new Map<string, { pb: Playbook; until: number }>();
const building = new Map<string, Promise<Playbook>>();

// intelligence が使えないときの手本（業種の一般的な型。検索結果が入るまでのつなぎ）
export function fallbackPlaybook(key: string): Playbook {
  const ind = industryOf(key);
  const service = /salon|nail|esthetic|massage|acupuncture|yoga|gym|dental|clinic|pet|lodging/.test(ind.key);
  const food = /cafe|restaurant|bakery|agriculture/.test(ind.key);
  const creator = /photo|design|music|handmade/.test(ind.key);
  return {
    key: ind.key,
    label: ind.label,
    generatedAt: new Date(0).toISOString(),
    source: 'fallback',
    summary: `${ind.label}のお客様は、最初の画面で「自分向けか」「安心できるか」を数秒で判断し、次に料金・流れ・場所を確かめます。`,
    audience: '初めての利用で失敗したくない、という不安を持っています。',
    decisionFactors: service ? ['雰囲気が合うか', '料金が明確か', '予約のしやすさ', '施術者・担当者の顔', '口コミや実例'] : food ? ['写真のおいしさ', 'メニューと価格', '場所と営業時間', 'お店の雰囲気'] : creator ? ['作品の質', '世界観', '依頼・購入の方法', '人柄'] : ['何をしてくれるか', '料金の目安', '信頼できるか', '相談のしやすさ'],
    sectionOrder: service ? ['hero', 'strengths', 'menu', 'flow', 'about', 'faq', 'access', 'campaign', 'tools', 'line'] : food ? ['hero', 'strengths', 'menu', 'about', 'access', 'faq', 'campaign', 'tools', 'line'] : creator ? ['hero', 'strengths', 'about', 'menu', 'flow', 'faq', 'tools', 'line'] : ['hero', 'strengths', 'flow', 'menu', 'about', 'faq', 'access', 'campaign', 'tools', 'line'],
    recommendedFeatures: service
      ? [{ id: 'menu', reason: '料金が見えないと予約に進めない人が多いため' }, { id: 'flow', reason: '初めての人の不安を「流れ」が解消するため' }, { id: 'faq', reason: '予約前の疑問に先回りして答えるため' }, { id: 'access', reason: '場所と営業時間は必ず確認されるため' }]
      : food
        ? [{ id: 'menu', reason: 'メニューと価格は来店前に必ず見られるため' }, { id: 'access', reason: '場所と営業時間が決め手になるため' }, { id: 'about', reason: 'お店の想いが常連を作るため' }]
        : creator
          ? [{ id: 'about', reason: '人柄と世界観が依頼の決め手になるため' }, { id: 'menu', reason: '依頼・購入の目安があると相談しやすいため' }, { id: 'faq', reason: '納期や依頼方法の疑問に答えるため' }]
          : [{ id: 'flow', reason: '依頼までの手順が分かると相談しやすいため' }, { id: 'menu', reason: '料金の目安が信頼につながるため' }, { id: 'faq', reason: '不安を先回りして解消するため' }],
    hero: {
      eyebrowGuide: '地域＋業種＋対象（例: 「〇〇駅徒歩5分の美容室」）を14文字程度で',
      headlineGuide: '「誰のための、どんな結果か」を1行で。抽象語より具体的な場面',
      subcopyGuide: '強みのうち最も差がつく1つを、お客様の得になる言い方で1〜2文',
      ctaLabel: service ? '予約・相談する' : food ? 'メニューを見る' : creator ? '依頼・購入はこちら' : 'まずは相談する',
      secondaryCtaLabel: service || food ? 'メニューを見る' : '詳しく見る'
    },
    tone: '丁寧だが堅すぎない敬体。短い文で、専門用語は言い換える。',
    trustElements: ['料金の明示', '担当者・店主の紹介', '利用の流れ', 'よくある質問', '場所と営業時間'],
    writingRules: ['見出しは20文字以内', '1文は40文字前後', '数字・実績は事実のみ', 'お客様の得になる言い方にする'],
    mustAvoid: ['日本一・絶対・必ず などの断定', '根拠のない実績・口コミ', '長い自己紹介で始める', '医療・美容は効果の断定（医療広告ガイドライン・薬機法）'],
    visual: { mood: `${ind.label}らしい清潔感と個性`, imagery: 'clean, well-lit interior or product detail, natural light, calm composition', primary: '#1d4ed8', background: '#f8fafc', font: 'modern', corner: 'soft', heroLayout: 'split', strengthsStyle: 'cards' },
    conversationHints: ['どんな人に一番来てほしいか', '料金の目安', '予約・問い合わせの方法', '場所と営業時間'],
    references: []
  };
}

function rowToPlaybook(row: { key: string; label: string; content: unknown; updatedAt: Date }): Playbook {
  const c = (row.content ?? {}) as Partial<Playbook>;
  const fb = fallbackPlaybook(row.key);
  return { ...fb, ...c, key: row.key, label: row.label, generatedAt: row.updatedAt.toISOString(), source: (c.source as Playbook['source']) ?? 'model' };
}

// --- 手本の作成（Web検索で調べる → 構造化） ----------------------------------------------------

async function researchMemo(ind: Industry): Promise<{ memo: string; usedWeb: boolean }> {
  const client = aiClient();
  const useWeb = process.env.PLAYBOOK_WEB_SEARCH !== 'false';
  const tools: any[] = useWeb ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }] : [];
  const res = await client.beta.messages.create({
    model: COMPANY_MODELS.balanced,
    max_tokens: 4000,
    system: [
      'あなたは日本の中小事業者向けWebサイトを数多く分析してきたリサーチャーです。',
      '指定された業種について、日本で人気・高評価のホームページやランディングページ（検索上位、ポータルの人気店、受賞サイト、制作会社の実績として紹介される事例など）を調べ、',
      '共通する「型」を分析メモにまとめてください。個別サイトの文章や数字を写すのではなく、構成・見出しの作り方・信頼要素・ボタン文言・配色・写真の傾向という「型」を抽出します。',
      '調べた実在ページは名前とURLを必ず記録してください。法規制（医療広告ガイドライン・薬機法・景品表示法など）に触れる業種はその注意点も書いてください。',
      '出力は日本語のメモ（見出し付き）。'
    ].join('\n'),
    messages: [{ role: 'user', content: `業種: ${ind.label}（キー: ${ind.key}）\n\n調べる観点: 1) ページの構成と順番 2) ファーストビュー（見出し上の一行・見出しの型・補足文・ボタン文言） 3) 必ずある信頼要素 4) 料金・流れ・Q&A・アクセスの見せ方 5) 配色と書体の傾向 6) 写真の傾向 7) 避けるべき表現 8) 参考にした実在ページ（名前・URL・何が良いか）` }],
    tools
  } as any);
  const memo = (res.content as any[]).filter((b) => b.type === 'text').map((b) => b.text as string).join('\n').trim();
  const usedWeb = (res.content as any[]).some((b) => b.type === 'web_search_tool_result' || b.type === 'server_tool_use');
  if (!memo) throw new Error('research memo empty');
  return { memo: memo.slice(0, 20000), usedWeb };
}

async function structurePlaybook(ind: Industry, memo: string) {
  const client = aiClient();
  const r = await client.beta.messages.parse({
    model: COMPANY_MODELS.balanced,
    max_tokens: 4000,
    system: [
      'あなたは一流のWebディレクターです。リサーチメモをもとに、この業種のページ作成の「手本」を所定の形式にまとめます。',
      '手本は別のAWPがユーザーのページを作るときの指示として使います。他社の固有名詞・文章・数字を手本に入れないでください（references を除く）。',
      'ユーザーが事実として伝えていない実績・数字・口コミを作らせる指示は書かないでください。'
    ].join('\n'),
    messages: [{ role: 'user', content: `業種: ${ind.label}\n\n＜リサーチメモ＞\n${memo}\n＜/リサーチメモ＞` }],
    output_config: { effort: 'medium', format: betaZodOutputFormat(PlaybookSchema) }
  });
  if (!r.parsed_output) throw new Error(`playbook not produced (stop_reason=${r.stop_reason})`);
  return r.parsed_output;
}

function sanitize(pb: z.infer<typeof PlaybookSchema>, ind: Industry): z.infer<typeof PlaybookSchema> {
  const featureIds = FEATURES.map((f) => f.id);
  const order = pb.sectionOrder.filter((s, i, a) => (SECTION_IDS as readonly string[]).includes(s) && a.indexOf(s) === i);
  if (!order.includes('hero')) order.unshift('hero');
  if (!order.includes('strengths')) order.splice(1, 0, 'strengths');
  for (const id of ['tools', 'line']) if (!order.includes(id)) order.push(id);
  // ページ全体の並びは hero → strengths を固定（最初の画面で判断されるため）
  const fixed = ['hero', 'strengths', ...order.filter((s) => s !== 'hero' && s !== 'strengths' && s !== 'line'), 'line'];
  return {
    ...pb,
    sectionOrder: fixed,
    recommendedFeatures: pb.recommendedFeatures.filter((f) => featureIds.includes(f.id)).slice(0, 5),
    references: pb.references.filter((r) => /^https?:\/\//.test(r.url)).slice(0, 10),
    hero: { ...pb.hero, ctaLabel: pb.hero.ctaLabel.slice(0, 14) || fallbackPlaybook(ind.key).hero.ctaLabel, secondaryCtaLabel: pb.hero.secondaryCtaLabel.slice(0, 12) }
  };
}

export async function buildPlaybook(key: string): Promise<Playbook> {
  const ind = industryOf(key);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const inflight = building.get(ind.key);
  if (inflight) return inflight;
  const p = (async () => {
    await prisma.industryPlaybook.upsert({
      where: { key: ind.key },
      update: { status: 'generating', error: null },
      create: { key: ind.key, label: ind.label, content: fallbackPlaybook(ind.key) as any, status: 'generating' }
    });
    try {
      let memo = '';
      let source: Playbook['source'] = 'model';
      try {
        const r = await researchMemo(ind);
        memo = r.memo;
        source = r.usedWeb ? 'web' : 'model';
      } catch (e: any) {
        console.error('playbook research failed, using model knowledge', ind.key, e?.message);
        memo = '（Web検索は使えませんでした。あなたの知識の範囲で、この業種の人気ページの型をまとめてください。references は空でかまいません）';
      }
      const structured = sanitize(await structurePlaybook(ind, memo), ind);
      const content = { ...structured, source };
      const row = await prisma.industryPlaybook.update({
        where: { key: ind.key },
        data: { content: content as any, status: 'ready', error: null, model: COMPANY_MODELS.balanced }
      });
      const pb = rowToPlaybook(row);
      memory.set(ind.key, { pb, until: Date.now() + FRESH_MS });
      return pb;
    } catch (e: any) {
      await prisma.industryPlaybook.update({ where: { key: ind.key }, data: { status: 'failed', error: describeAiError(e).slice(0, 500) } }).catch(() => {});
      throw e;
    } finally {
      building.delete(ind.key);
    }
  })();
  building.set(ind.key, p);
  return p;
}

// 手本を取り出す。wait=true なら未作成のとき作成を待つ（デザイン作成など裏で動く処理向け）。
// wait=false なら今あるもの（なければ一般的な型）をすぐ返し、作成は裏で始める（画面の応答を止めない）。
// 手本に「AWP 全体の実測（業種別の勝ちパターン）」を添える。実測はデータレイクの集計で、10分ごとに引き直す
const benchmarkMemory = new Map<string, { text: string | null; until: number }>();
export async function getPlaybook(key: string | null | undefined, opts: { wait?: boolean } = {}): Promise<Playbook> {
  const pb = await loadPlaybook(key, opts);
  const hit = benchmarkMemory.get(pb.key);
  let text = hit && hit.until > Date.now() ? hit.text : null;
  if (!hit || hit.until <= Date.now()) {
    text = await benchmarkBrief(pb.key).catch(() => null);
    benchmarkMemory.set(pb.key, { text, until: Date.now() + 10 * 60_000 });
  }
  return text ? { ...pb, benchmark: text } : pb;
}

async function loadPlaybook(key: string | null | undefined, opts: { wait?: boolean } = {}): Promise<Playbook> {
  const ind = industryOf(key);
  const hit = memory.get(ind.key);
  if (hit && hit.until > Date.now()) return hit.pb;
  const row = await prisma.industryPlaybook.findUnique({ where: { key: ind.key } }).catch(() => null);
  const fresh = row && row.status === 'ready' && Date.now() - row.updatedAt.getTime() < FRESH_MS;
  if (row && fresh) {
    const pb = rowToPlaybook(row);
    memory.set(ind.key, { pb, until: row.updatedAt.getTime() + FRESH_MS });
    return pb;
  }
  const stale = row && (row.status !== 'generating' || isStuck(row)) ? rowToPlaybook(row) : null;
  if (!process.env.ANTHROPIC_API_KEY) return stale ?? fallbackPlaybook(ind.key);
  if (opts.wait) {
    try { return await buildPlaybook(ind.key); } catch { return stale ?? fallbackPlaybook(ind.key); }
  }
  if (!building.has(ind.key) && (row?.status !== 'generating' || isStuck(row))) {
    buildPlaybook(ind.key).catch((e) => console.error('playbook build failed', ind.key, e?.message));
  }
  return stale ?? fallbackPlaybook(ind.key);
}

// --- プロンプト用の要約 ---------------------------------------------------------------------

const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');

export function playbookBriefForDesign(pb: Playbook) {
  return [
    `【同業種（${pb.label}）の人気ページに共通する型】`,
    `お客様の見方: ${pb.summary}`,
    `決め手: ${pb.decisionFactors.join(' / ')}`,
    `見た目の世界観: ${pb.visual.mood}`,
    `よくある配色の例: メイン ${pb.visual.primary} / 背景 ${pb.visual.background}（そのまま使う必要はない。この店らしく調整する）`,
    `書体・角・レイアウトの傾向: ${pb.visual.font} / ${pb.visual.corner} / ${pb.visual.heroLayout} / 強み ${pb.visual.strengthsStyle}`,
    `写真の傾向: ${pb.visual.imagery}`,
    `ファーストビュー: 上の一行=${pb.hero.eyebrowGuide} / 見出し=${pb.hero.headlineGuide} / 補足=${pb.hero.subcopyGuide} / 主ボタン=「${pb.hero.ctaLabel}」`,
    `避けること:\n${bullets(pb.mustAvoid)}`,
    pb.benchmark ? `\n${pb.benchmark}\n（実測で反応の良かった流入チャネルと言葉を、主ボタンと冒頭の訴求に優先して使う）` : ''
  ].filter(Boolean).join('\n');
}

export function playbookBriefForCopy(pb: Playbook) {
  return [
    `【同業種（${pb.label}）の人気ページの書き方】`,
    `トーン: ${pb.tone}`,
    `お客様の不安と動機: ${pb.audience}`,
    `文章で守ること:\n${bullets(pb.writingRules)}`,
    `信頼の要素（預かった情報にあるものだけ使う）: ${pb.trustElements.join(' / ')}`,
    `避けること:\n${bullets(pb.mustAvoid)}`,
    pb.benchmark ? `\n${pb.benchmark}\n（実測で成約に結びついた言葉は、事実の範囲で見出しや CTA に活かす。数値そのものはページに書かない）` : ''
  ].filter(Boolean).join('\n');
}

export function playbookBriefForConversation(pb: Playbook) {
  return [
    `【この業種（${pb.label}）で聞いておくと良いこと】`,
    bullets(pb.conversationHints),
    `お客様の決め手: ${pb.decisionFactors.join(' / ')}`
  ].join('\n');
}

// 業種ごとの手本の一覧（運営者画面用）
export async function listPlaybooks() {
  const rows = await prisma.industryPlaybook.findMany({ orderBy: { key: 'asc' } });
  const pages = await prisma.landingPage.groupBy({ by: ['industryKey'], _count: { _all: true } }).catch(() => [] as { industryKey: string | null; _count: { _all: number } }[]);
  const count = new Map(pages.map((p) => [p.industryKey ?? 'other', p._count._all]));
  return INDUSTRIES.map((ind) => {
    const row = rows.find((r) => r.key === ind.key);
    const pb = row ? rowToPlaybook(row) : null;
    return {
      key: ind.key,
      label: ind.label,
      status: row ? (isStuck(row) ? 'failed' : row.status) : 'missing',
      error: row ? (isStuck(row) ? '作成中のまま止まりました（サーバー再起動の可能性）。作り直してください' : row.error) : null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      stale: row ? Date.now() - row.updatedAt.getTime() > FRESH_MS : true,
      source: pb?.source ?? null,
      pages: count.get(ind.key) ?? 0,
      playbook: pb
    };
  });
}
