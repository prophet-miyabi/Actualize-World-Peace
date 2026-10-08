import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod/v4';
import { fetchWithRetry } from './cloudflareFetch';
import { aiClient, recordAiCost } from '../lib/aiUsage';

// ---------------------------------------------------------------------------
// デザインは「AIが自由にHTMLを書く」のではなく、検証済みの部品の組み合わせをAIが選ぶ方式。
// スマホでの崩れや、不正なスクリプトの混入を防ぎつつ、店ごとに異なる見た目を作る。
//   - Claude: 配色・書体・レイアウトの決定と、画像の指示文の作成
//   - Gemini: メイン画像（ヒーロー画像）の生成
//   - どちらも使えない／失敗した場合: 業種に合うプリセットを使う（見た目が崩れることはない）
// ---------------------------------------------------------------------------

export const FONTS = ['modern', 'elegant', 'friendly', 'bold'] as const;
export const CORNERS = ['sharp', 'soft', 'round'] as const;
export const HERO_LAYOUTS = ['centered', 'split', 'imageBackground'] as const;
export const STRENGTH_STYLES = ['cards', 'numbered', 'minimal'] as const;
export const OVERLAYS = ['none', 'light', 'medium', 'strong'] as const;

export type Design = {
  palette: { primary: string; onPrimary: string; background: string; surface: string; text: string };
  font: (typeof FONTS)[number];
  corner: (typeof CORNERS)[number];
  heroLayout: (typeof HERO_LAYOUTS)[number];
  strengthsStyle: (typeof STRENGTH_STYLES)[number];
  // 写真の上に文字を載せるときの暗幕の濃さ（画像を見たClaudeが決める）
  heroOverlay: (typeof OVERLAYS)[number];
  imagePrompt: string;
};

type DesignInput = { businessName: string; heroTitle: string; strengths: string[]; description?: string };

// Claudeへの出力形式。
// SDKは選択肢（enum）や正規表現をAPIに制約として送らず、受信後にまとめて検査するため、
// 1項目でも外れるとAIのデザイン全体が破棄されてしまう。そこで選択肢も文字列で受け取り、
// finalize() で項目ごとに照合して、外れた項目だけをプリセットの値で補う。
const oneOf = (list: readonly string[]) => `次のいずれか: ${list.join(' / ')}`;
const AiDesignSchema = z.object({
  primary: z.string().describe('ボタンや強調に使うメインカラー（#RRGGBB）'),
  background: z.string().describe('ページ全体の背景色（#RRGGBB）'),
  surface: z.string().describe('カードなどの面の色（#RRGGBB）'),
  text: z.string().describe('本文の文字色（#RRGGBB）'),
  font: z.string().describe(oneOf(FONTS)),
  corner: z.string().describe(oneOf(CORNERS)),
  heroLayout: z.string().describe(oneOf(HERO_LAYOUTS)),
  strengthsStyle: z.string().describe(oneOf(STRENGTH_STYLES)),
  imagePrompt: z.string().describe('メイン画像の英語の指示文。写真風、文字・ロゴなし')
});

// --- プリセット（AIが使えないときも、業種に合う洗練された見た目にする） --------------------

const PRESETS: Record<string, Omit<Design, 'palette' | 'heroOverlay'> & { palette: Omit<Design['palette'], 'onPrimary'> }> = {
  trust: {
    palette: { primary: '#1d4ed8', background: '#f8fafc', surface: '#ffffff', text: '#0f172a' },
    font: 'modern', corner: 'soft', heroLayout: 'split', strengthsStyle: 'cards',
    imagePrompt: 'bright modern small office interior with natural light, professional and trustworthy atmosphere'
  },
  elegant: {
    palette: { primary: '#9a6b2f', background: '#fbf8f3', surface: '#ffffff', text: '#1c1917' },
    font: 'elegant', corner: 'sharp', heroLayout: 'imageBackground', strengthsStyle: 'minimal',
    imagePrompt: 'elegant beauty salon interior with soft warm lighting, minimal and luxurious, shallow depth of field'
  },
  fresh: {
    palette: { primary: '#15803d', background: '#f6fbf7', surface: '#ffffff', text: '#14281d' },
    font: 'friendly', corner: 'round', heroLayout: 'centered', strengthsStyle: 'cards',
    imagePrompt: 'cozy neighborhood cafe with fresh food on a wooden table, warm morning light'
  },
  bold: {
    palette: { primary: '#e11d48', background: '#0c0a0f', surface: '#1c1a22', text: '#fafafa' },
    font: 'bold', corner: 'sharp', heroLayout: 'imageBackground', strengthsStyle: 'numbered',
    imagePrompt: 'dynamic modern fitness studio with dramatic lighting, energetic mood'
  },
  warm: {
    palette: { primary: '#c2410c', background: '#fff8f1', surface: '#ffffff', text: '#1f2937' },
    font: 'friendly', corner: 'round', heroLayout: 'split', strengthsStyle: 'numbered',
    imagePrompt: 'clean and friendly clinic reception with plants and soft daylight, welcoming atmosphere'
  },
  calm: {
    palette: { primary: '#0f766e', background: '#f2fbf9', surface: '#ffffff', text: '#123c38' },
    font: 'elegant', corner: 'soft', heroLayout: 'centered', strengthsStyle: 'minimal',
    imagePrompt: 'serene wellness spa room with natural materials, calm green tones, soft light'
  }
};

const PRESET_KEYWORDS: [string, RegExp][] = [
  ['elegant', /美容|サロン|ネイル|エステ|まつ|ヘア|ブライダル|ジュエリー|着物|フラワー|花/],
  ['fresh', /カフェ|レストラン|食|パン|ベーカリー|居酒屋|料理|弁当|スイーツ|菓子|農|野菜|ラーメン|寿司/],
  ['bold', /ジム|フィットネス|トレーニング|格闘|ボクシング|ダンス|スポーツ|車|バイク|音楽|ライブ/],
  ['warm', /歯科|クリニック|病院|保育|塾|教室|介護|子ども|こども|家族|ペット|動物/],
  ['calm', /ヨガ|整体|マッサージ|スパ|鍼|針|接骨|カウンセリング|瞑想|ピラティス/]
];

export type PresetKey = keyof typeof PRESETS;
export const PRESET_KEYS = Object.keys(PRESETS) as PresetKey[];

// 完成例ギャラリー（見本一覧）の表示用ラベル。ここに載る文言だけが画面に出るため、誇張は書かない。
export const PRESET_META: Record<PresetKey, { label: string; description: string }> = {
  trust: { label: '信頼感のある', description: '誠実さが伝わる、落ち着いた定番スタイル' },
  elegant: { label: '上品な', description: '美容・サロンなど、質の高さを伝えたい業種向け' },
  fresh: { label: '親しみやすい', description: '飲食・カフェなど、あたたかい雰囲気を出したい業種向け' },
  bold: { label: '力強い', description: 'ジム・スポーツなど、エネルギッシュに見せたい業種向け' },
  warm: { label: 'あたたかい', description: 'クリニック・教室など、安心感を伝えたい業種向け' },
  calm: { label: '落ち着いた', description: 'ヨガ・整体など、静けさを伝えたい業種向け' }
};

function presetKeyFor(input: DesignInput): PresetKey {
  const text = [input.businessName, input.heroTitle, input.description ?? '', ...input.strengths].join(' ');
  return PRESET_KEYWORDS.find(([, re]) => re.test(text))?.[0] as PresetKey ?? 'trust';
}

// ユーザーが完成例ギャラリーで明示的に選んだテンプレートは、業種からの自動推測より優先する
function baseKeyFor(input: DesignInput, templateKey?: string | null): PresetKey {
  if (templateKey && (PRESET_KEYS as string[]).includes(templateKey)) return templateKey as PresetKey;
  return presetKeyFor(input);
}

// 外部から受け取ったデザインの値を検証・補正する（読みにくい配色の自動修正を含む）
export function normalizeDesign(raw: unknown, input: DesignInput, templateKey?: string | null): Design {
  return finalize(raw, PRESETS[baseKeyFor(input, templateKey)]);
}

export function presetDesign(input: DesignInput, templateKey?: string | null): Design {
  const preset = PRESETS[baseKeyFor(input, templateKey)];
  return finalize(preset, preset);
}

// --- 読みやすさの保証（WCAGのコントラスト基準） -----------------------------------------

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(value: unknown, fallback: string): string {
  const m = typeof value === 'string' ? value.trim().match(HEX) : null;
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const DARK = '#111827';
const LIGHT = '#ffffff';
const bestOn = (bg: string) => (contrast(LIGHT, bg) >= contrast(DARK, bg) ? LIGHT : DARK);

// AIやプリセットの値を検証し、読みにくい配色はサーバー側で自動補正する
function finalize(raw: any, preset: (typeof PRESETS)[string]): Design {
  const p = preset.palette;
  const background = normalizeHex(raw?.palette?.background ?? raw?.background, p.background);
  let surface = normalizeHex(raw?.palette?.surface ?? raw?.surface, p.surface);
  let text = normalizeHex(raw?.palette?.text ?? raw?.text, p.text);
  let primary = normalizeHex(raw?.palette?.primary ?? raw?.primary, p.primary);

  // 本文（通常サイズの文字）は4.5:1以上
  if (contrast(text, background) < 4.5) text = bestOn(background);
  if (contrast(text, surface) < 4.5) surface = background;
  // ボタン（太字・大きめの文字）は3:1以上。確保できない色なら業種プリセットの色に戻す
  if (Math.max(contrast(LIGHT, primary), contrast(DARK, primary)) < 3) primary = p.primary;
  // 背景の上でボタンが見分けられない場合もプリセットの色に戻す
  if (contrast(primary, background) < 1.5) primary = p.primary;

  const pick = <T extends readonly string[]>(list: T, v: unknown, fb: T[number]): T[number] =>
    (list as readonly string[]).includes(v as string) ? (v as T[number]) : fb;

  return {
    palette: { primary, onPrimary: bestOn(primary), background, surface, text },
    font: pick(FONTS, raw?.font, preset.font),
    corner: pick(CORNERS, raw?.corner, preset.corner),
    heroLayout: pick(HERO_LAYOUTS, raw?.heroLayout, preset.heroLayout),
    strengthsStyle: pick(STRENGTH_STYLES, raw?.strengthsStyle, preset.strengthsStyle),
    heroOverlay: pick(OVERLAYS, raw?.heroOverlay, 'medium'),
    imagePrompt: (typeof raw?.imagePrompt === 'string' && raw.imagePrompt.trim() ? raw.imagePrompt : preset.imagePrompt).slice(0, 500)
  };
}

// --- Claude: デザインの決定 --------------------------------------------------------------

const ART_DIRECTOR_PROMPT = [
  'あなたは、日本の中小事業者のランディングページを手がける一流のアートディレクターです。',
  '事業の内容と、想定される顧客の気持ちから、ブランドとして一貫した見た目を決めてください。',
  '守るべき原則:',
  '- 配色は「背景60%・面30%・メインカラー10%」の考え方で、メインカラーはボタンと要所だけに使う前提で選ぶ。',
  '- 原色どうしの組み合わせや、彩度の高い背景は避ける。背景はごく淡い色か、世界観に合う深い色にする。',
  '- 本文の読みやすさを最優先する（背景と文字の明暗差を大きく）。',
  '- 業種の信頼感と、その店らしい個性の両立を目指す。流行に寄せすぎない。',
  '- 書体: modern=すっきりしたゴシック / elegant=上品な明朝 / friendly=丸ゴシック / bold=力強い太字。',
  '- レイアウト: centered=中央揃えで静か / split=文章と写真を左右に並べる / imageBackground=写真全面に文字を重ねる（写真の雰囲気が強みになる業種向け）。',
  'imagePromptは、メイン画像を生成するための英語の指示文です。被写体・光・色調・構図を具体的に書き、',
  '人物の顔のアップ、文字、ロゴ、看板、特定の実在ブランドは含めないでください。'
].join('\n');

export async function designWithClaude(input: DesignInput, templateKey?: string | null): Promise<Design> {
  const client = aiClient();
  const response = await client.beta.messages.parse({
    model: process.env.CLAUDE_MODEL || 'claude-opus-5',
    max_tokens: 2048,
    // 安全上の理由で断られた場合に、別モデルで自動的に再実行する
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: ART_DIRECTOR_PROMPT,
    messages: [{
      role: 'user',
      content: [
        `事業名: ${input.businessName}`,
        `キャッチコピー: ${input.heroTitle}`,
        `強み: ${input.strengths.filter(Boolean).join(' / ')}`,
        input.description ? `事業内容: ${input.description}` : ''
      ].filter(Boolean).join('\n')
    }],
    output_config: { effort: 'low', format: betaZodOutputFormat(AiDesignSchema) }
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`design not produced (stop_reason=${response.stop_reason})`);
  }
  // AIの値が不正・読みにくい場合は、業種に合うプリセット（明示選択があればそれ）の値で補う
  return finalize(response.parsed_output, PRESETS[baseKeyFor(input, templateKey)]);
}

// --- Claude: Geminiの画像のレビューと、画像に合わせた配色の調整 ------------------------------

const ReviewSchema = z.object({
  acceptable: z.boolean().describe('公開して問題ない品質か'),
  issues: z.string().describe('問題点。再生成の指示としてそのまま使える英語で書く。問題がなければ空文字'),
  heroOverlay: z.string().describe(`この写真の上に白い文字を載せる場合に必要な暗幕の濃さ。${oneOf(OVERLAYS)}`),
  primary: z.string().describe('写真の色味と調和するメインカラー（#RRGGBB）。今のままで良ければ現在の色')
});

export type Review = { acceptable: boolean; issues: string; design: Design };

export async function reviewImageWithClaude(input: DesignInput, design: Design, image: { data: Buffer; mimeType: string }, templateKey?: string | null): Promise<Review> {
  const client = aiClient();
  const response = await client.beta.messages.parse({
    model: process.env.CLAUDE_MODEL || 'claude-opus-5',
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'あなたはWebサイトの品質管理を担当するアートディレクターです。別のAIが生成したメイン画像を厳しく確認してください。\n' +
      '不合格の条件: 画像内に文字・ロゴ・透かし・看板がある / 人体や物の形が不自然 / 事業の雰囲気と合わない / 画質が粗い。\n' +
      'あわせて、この写真と調和するメインカラーと、写真の上に文字を載せる際の暗幕の濃さを決めてください。',
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/webp', data: image.data.toString('base64') }
        },
        {
          type: 'text',
          text: [
            `事業名: ${input.businessName}`,
            `キャッチコピー: ${input.heroTitle}`,
            `画像の指示文: ${design.imagePrompt}`,
            `現在のメインカラー: ${design.palette.primary} / 背景色: ${design.palette.background}`
          ].join('\n')
        }
      ]
    }],
    output_config: { effort: 'low', format: betaZodOutputFormat(ReviewSchema) }
  });
  const r = response.parsed_output;
  if (response.stop_reason === 'refusal' || !r) throw new Error(`review not produced (stop_reason=${response.stop_reason})`);
  return {
    acceptable: r.acceptable,
    issues: r.issues,
    // 調整後も必ず読みやすさの検査を通す
    design: finalize({ ...design, palette: { ...design.palette, primary: r.primary }, heroOverlay: r.heroOverlay }, PRESETS[baseKeyFor(input, templateKey)])
  };
}

// --- メイン画像の生成 -----------------------------------------------------------------------
// Gemini（無料枠だと画像生成は1日0回のことが多い）に加えて、
// Cloudflare Workers AI（1日10,000 Neuronsまで無料。FLUXの画像1枚は数Neuron程度）にも対応する。
// どちらを使うかは設定されている環境変数で自動判定する（generateHeroImage参照）。

function buildImagePrompt(imagePrompt: string, fixInstructions?: string): string {
  return (
    'A high-quality photograph for the hero section of a small business website. ' +
    `${imagePrompt}. Wide composition with calm negative space. ` +
    'No text, no letters, no logos, no watermarks, no signage.' +
    (fixInstructions ? ` Fix these problems from the previous attempt: ${fixInstructions}` : '')
  );
}

// Geminiに、そのままの指示文で画像を1枚作らせる（店主のLP用にも、アプリ自体の装飾用にも使う）
async function imageFromGemini(prompt: string): Promise<{ data: Buffer; mimeType: string }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const interaction = await ai.interactions.create({
    model: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
    input: prompt,
    response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: '1K' }
  });
  const image = interaction.output_image;
  if (!image?.data) throw new Error('Gemini returned no image');
  // 画像1枚あたりの見積もり（GEMINI_IMAGE_COST_USD で変更可）。利用者の操作から始まった場合だけ記録される
  void recordAiCost('gemini-image', process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image', Number(process.env.GEMINI_IMAGE_COST_USD || 0.04));
  return { data: Buffer.from(image.data, 'base64'), mimeType: image.mime_type || 'image/jpeg' };
}

// Cloudflare Workers AI（FLUX.1 [schnell]）に、そのままの指示文で画像を1枚作らせる
async function imageFromWorkersAI(prompt: string): Promise<{ data: Buffer; mimeType: string }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN が未設定です');

  const res = await fetchWithRetry(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 8 })
    }
  );
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.success || !body?.result?.image) {
    throw new Error(`Workers AI returned no image: ${JSON.stringify(body?.errors || res.statusText)}`);
  }
  return { data: Buffer.from(body.result.image, 'base64'), mimeType: 'image/jpeg' };
}

export async function heroImageWithGemini(imagePrompt: string, fixInstructions?: string) {
  return imageFromGemini(buildImagePrompt(imagePrompt, fixInstructions));
}

export async function heroImageWithWorkersAI(imagePrompt: string, fixInstructions?: string) {
  return imageFromWorkersAI(buildImagePrompt(imagePrompt, fixInstructions));
}

// どのAIで画像を作るかを、設定済みの環境変数から自動選択する
// （Cloudflareの方が無料枠が大きいため優先。どちらも未設定なら画像なしで公開する）
export async function generateHeroImage(imagePrompt: string, fixInstructions?: string): Promise<{ data: Buffer; mimeType: string }> {
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    return heroImageWithWorkersAI(imagePrompt, fixInstructions);
  }
  return heroImageWithGemini(imagePrompt, fixInstructions);
}

// アプリ自体の外装（マーケティングLP・ウィザードなどの装飾画像）用。
// 店主のLP画像とは違い、指示文をそのまま使う（「小規模事業のヒーロー画像」という前提を付けない）
export async function generateImage(prompt: string): Promise<{ data: Buffer; mimeType: string }> {
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) {
    return imageFromWorkersAI(prompt.slice(0, 2000));
  }
  return imageFromGemini(prompt.slice(0, 2000));
}
