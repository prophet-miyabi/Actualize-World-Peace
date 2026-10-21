import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod/v4';
import { fetchWithRetry } from './cloudflareFetch';
import { aiClient, recordAiCost } from '../lib/aiUsage';
import { runwayConfigured, runwayImage } from './runway';
import { classifyIndustryByRules, playbookBriefForDesign, type Playbook } from './playbook';
import { LEGACY_STYLE, STYLES, STYLE_KEYS, hueBucket, isHex, paletteFor, styleForIndustry, styleOf, type StyleSpec } from './styles';

// ---------------------------------------------------------------------------
// デザインは「AWPが自由にHTMLを書く」のではなく、検証済みの部品の組み合わせをAWPが選ぶ方式。
// スマホでの崩れや、不正なスクリプトの混入を防ぎつつ、店ごとに異なる見た目を作る。
//   - Claude: 配色・書体・レイアウトの決定と、画像の指示文の作成
//   - Gemini: メイン画像（ヒーロー画像）の生成
//   - どちらも使えない／失敗した場合: 業種に合うプリセットを使う（見た目が崩れることはない）
// ---------------------------------------------------------------------------

export const FONTS = ['modern', 'elegant', 'friendly', 'bold', 'editorial', 'grotesk'] as const;
export const CORNERS = ['sharp', 'soft', 'round'] as const;
export const HERO_LAYOUTS = ['centered', 'split', 'imageBackground', 'editorial', 'stage', 'glass', 'fullBleed'] as const;
export const STRENGTH_STYLES = ['cards', 'numbered', 'minimal'] as const;
export const OVERLAYS = ['none', 'light', 'medium', 'strong'] as const;
export const MOTIFS = ['rules', 'pills', 'cards', 'glass', 'none'] as const;

export type Design = {
  palette: { primary: string; onPrimary: string; background: string; surface: string; text: string };
  font: (typeof FONTS)[number];
  corner: (typeof CORNERS)[number];
  heroLayout: (typeof HERO_LAYOUTS)[number];
  strengthsStyle: (typeof STRENGTH_STYLES)[number];
  // 写真の上に文字を載せるときの暗幕の濃さ（画像を見たClaudeが決める）
  heroOverlay: (typeof OVERLAYS)[number];
  imagePrompt: string;
  // ページの型（styles.ts）・明暗・ユーザーが選んだメインカラー・飾り・特徴ストリップの有無
  style: string;
  mode: 'light' | 'dark';
  accent: string;
  motif: (typeof MOTIFS)[number];
  featureStrip: boolean;
  // ファーストビューの補助コピー（ユーザーが伝えた事実だけから作る）。無ければ画面側が既定の文言を使う
  // strengthLabels = 強みそれぞれの短い見出し（特徴ストリップと強みカードの見出しに使う）
  copy?: { eyebrow: string; subcopy: string; ctaLabel: string; secondaryCtaLabel: string; strengthLabels?: string[] };
  // 同業種の人気ページに合わせたセクションの並び（publicLpで並べ替えに使う）
  sectionOrder?: string[];
};

type DesignInput = { businessName: string; heroTitle: string; strengths: string[]; description?: string };

// Claudeへの出力形式。
// SDKは選択肢（enum）や正規表現をAPIに制約として送らず、受信後にまとめて検査するため、
// 1項目でも外れるとAWPのデザイン全体が破棄されてしまう。そこで選択肢も文字列で受け取り、
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
  imagePrompt: z.string().describe('メイン画像の英語の指示文。写真風、文字・ロゴなし'),
  eyebrow: z.string().describe('見出しの上に置く小さな一行（業種・地域・対象など、伝えられた事実だけで。16文字以内。作れなければ空文字）'),
  subcopy: z.string().describe('見出しの下の補足文（強みの中で最も差がつく1つを、お客様の得になる言い方で1〜2文・80文字以内。新しい事実・数字を足さない）'),
  ctaLabel: z.string().describe('主ボタンの文言（12文字以内。例: 予約・相談する）'),
  secondaryCtaLabel: z.string().describe('補助ボタンの文言（10文字以内。例: メニューを見る）'),
  strengthLabels: z.array(z.string()).describe('強みそれぞれの短い見出し（各8文字以内、強みと同じ順・同じ数。例: 「髪質に合わせる」「完全予約制」）。強みの文から要約するだけで、新しい事実は足さない')
});

// --- 型（スタイル）とメインカラーからの既定デザイン ----------------------------------------------
// intelligence が使えないときもこの既定で公開でき、使えるときは Claude がこれを土台に店らしく仕上げる

type Preset = Omit<Design, 'heroOverlay' | 'copy' | 'sectionOrder' | 'palette'> & {
  palette: Omit<Design['palette'], 'onPrimary'>;
  // ユーザーがメインカラーを選んだ場合は、AWPが別の色を返しても必ずその色を使う
  accentLocked: boolean;
};

function presetFor(style: StyleSpec, accent?: string | null): Preset {
  const a = isHex(accent) ? accent.toLowerCase() : style.defaultAccent;
  return {
    palette: paletteFor(a, style),
    font: style.font, corner: style.corner, heroLayout: style.heroLayout, strengthsStyle: style.strengthsStyle,
    imagePrompt: style.imagery,
    style: style.key, mode: style.mode, accent: a, motif: style.motif, featureStrip: style.featureStrip,
    accentLocked: isHex(accent)
  };
}

export type PresetKey = string;
// 画面から指定できる型のキー（新しい12種類＋以前の6種類の名前も受け付ける）
export const PRESET_KEYS: string[] = [...STYLE_KEYS, ...Object.keys(LEGACY_STYLE)];

// 見本一覧の表示用。ここに載る文言だけが画面に出るため、誇張は書かない
export const PRESET_META: Record<string, { label: string; description: string; bestFor: string; mode: 'light' | 'dark'; defaultAccent: string }> =
  Object.fromEntries(STYLES.map((st) => [st.key, { label: st.label, description: st.description, bestFor: st.bestFor, mode: st.mode, defaultAccent: st.defaultAccent }]));

// ユーザーが選んだ型を優先し、未選択なら入力文から業種を推定して相性の良い型にする
export function baseStyleFor(input: DesignInput, templateKey?: string | null): StyleSpec {
  if (templateKey && PRESET_KEYS.includes(templateKey)) return styleOf(templateKey);
  const text = [input.businessName, input.heroTitle, input.description ?? '', ...input.strengths].join(' ');
  return styleForIndustry(classifyIndustryByRules(text));
}

// 外部から受け取ったデザインの値を検証・補正する（読みにくい配色の自動修正を含む）
export function normalizeDesign(raw: unknown, input: DesignInput, templateKey?: string | null, accent?: string | null): Design {
  return finalize(raw, presetFor(baseStyleFor(input, templateKey), accent));
}

export function presetDesign(input: DesignInput, templateKey?: string | null, playbook?: Playbook | null, accent?: string | null): Design {
  const preset = presetFor(baseStyleFor(input, templateKey), accent);
  const d = finalize(preset, preset);
  if (playbook) {
    d.sectionOrder = playbook.sectionOrder;
    d.copy = { eyebrow: '', subcopy: '', ctaLabel: playbook.hero.ctaLabel, secondaryCtaLabel: playbook.hero.secondaryCtaLabel };
  }
  return d;
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

// AWPやプリセットの値を検証し、読みにくい配色はサーバー側で自動補正する
function finalize(raw: any, preset: Preset): Design {
  const p = preset.palette;
  const background = normalizeHex(raw?.palette?.background ?? raw?.background, p.background);
  let surface = normalizeHex(raw?.palette?.surface ?? raw?.surface, p.surface);
  let text = normalizeHex(raw?.palette?.text ?? raw?.text, p.text);
  let primary = preset.accentLocked ? p.primary : normalizeHex(raw?.palette?.primary ?? raw?.primary, p.primary);

  // 本文（通常サイズの文字）は4.5:1以上
  if (contrast(text, background) < 4.5) text = bestOn(background);
  if (contrast(text, surface) < 4.5) surface = background;
  // ボタン（太字・大きめの文字）は3:1以上。確保できない色なら業種プリセットの色に戻す
  if (Math.max(contrast(LIGHT, primary), contrast(DARK, primary)) < 3) primary = p.primary;
  // 背景の上でボタンが見分けられない場合もプリセットの色に戻す
  if (contrast(primary, background) < 1.5) primary = p.primary;

  const pick = <T extends readonly string[]>(list: T, v: unknown, fb: T[number]): T[number] =>
    (list as readonly string[]).includes(v as string) ? (v as T[number]) : fb;

  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const rawCopy = raw?.copy ?? raw;
  const strengthLabels = Array.isArray(rawCopy?.strengthLabels)
    ? (rawCopy.strengthLabels as unknown[]).map((v) => clean(v, 10)).filter(Boolean).slice(0, 4)
    : [];
  const copy = {
    eyebrow: clean(rawCopy?.eyebrow, 20),
    subcopy: clean(rawCopy?.subcopy, 100),
    ctaLabel: clean(rawCopy?.ctaLabel, 14),
    secondaryCtaLabel: clean(rawCopy?.secondaryCtaLabel, 12),
    ...(strengthLabels.length ? { strengthLabels } : {})
  };
  const sectionOrder = Array.isArray(raw?.sectionOrder) ? (raw.sectionOrder as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 20) : undefined;

  return {
    palette: { primary, onPrimary: bestOn(primary), background, surface, text },
    font: pick(FONTS, raw?.font, preset.font),
    corner: pick(CORNERS, raw?.corner, preset.corner),
    heroLayout: pick(HERO_LAYOUTS, raw?.heroLayout, preset.heroLayout),
    strengthsStyle: pick(STRENGTH_STYLES, raw?.strengthsStyle, preset.strengthsStyle),
    heroOverlay: pick(OVERLAYS, raw?.heroOverlay, 'medium'),
    imagePrompt: (typeof raw?.imagePrompt === 'string' && raw.imagePrompt.trim() ? raw.imagePrompt : preset.imagePrompt).slice(0, 500),
    style: preset.style,
    mode: preset.mode,
    accent: primary,
    motif: pick(MOTIFS, raw?.motif, preset.motif),
    featureStrip: typeof raw?.featureStrip === 'boolean' ? raw.featureStrip : preset.featureStrip,
    ...(copy.eyebrow || copy.subcopy || copy.ctaLabel || copy.strengthLabels ? { copy } : {}),
    ...(sectionOrder?.length ? { sectionOrder } : {})
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
  '人物の顔のアップ、文字、ロゴ、看板、特定の実在ブランドは含めないでください。',
  '「同業種の人気ページに共通する型」が渡されたら、その型（構成・見せ方・配色の方向）を土台にしつつ、この店らしさを加えて仕上げてください。',
  '型はあくまで手本です。他社の文章や数字は使わず、eyebrow / subcopy / strengthLabels はユーザーが伝えた事実（事業名・キャッチコピー・強み・事業内容）だけから作ってください。',
  '「ページの型」が指定されたら、ヒーローの組み方・書体・角はその型に従い、配色と写真と言葉でこの店らしさを出します。',
  '「メインカラー（固定）」が指定されたら primary はその色のまま。背景・面・文字はその色と型の明暗（light/dark）に調和させてください。',
  '「最近のページに多い組み合わせ」が渡されたら、同じ見た目にならないよう、書体・強みの見せ方・写真の被写体・言葉のトーンのいずれかで差をつけてください。'
].join('\n');

export type DesignOptions = { accent?: string | null; avoid?: string | null };

export async function designWithClaude(input: DesignInput, templateKey?: string | null, playbook?: Playbook | null, opts: DesignOptions = {}): Promise<Design> {
  const client = aiClient();
  const style = baseStyleFor(input, templateKey);
  const preset = presetFor(style, opts.accent);
  const styleBrief = [
    `【ページの型: ${style.label}（${style.key}）】${style.description}`,
    `明暗: ${style.mode} / ヒーロー: ${style.heroLayout} / 書体: ${style.font} / 角: ${style.corner} / 強み: ${style.strengthsStyle} / 飾り: ${style.motif} / 特徴ストリップ: ${style.featureStrip ? 'あり' : 'なし'}`,
    `写真の方向: ${style.imagery}`,
    preset.accentLocked ? `【メインカラー（固定）】${preset.palette.primary}` : `メインカラーの候補: ${preset.palette.primary}（業種と店らしさでより良い色があれば変えてよい）`,
    `既定の配色（土台）: 背景 ${preset.palette.background} / 面 ${preset.palette.surface} / 文字 ${preset.palette.text}`
  ].join('\n');
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
        input.description ? `事業内容: ${input.description}` : '',
        `\n${styleBrief}`,
        opts.avoid ? `\n【最近のページに多い組み合わせ（同じ見た目を避ける）】\n${opts.avoid}` : '',
        playbook ? `\n${playbookBriefForDesign(playbook)}` : ''
      ].filter(Boolean).join('\n')
    }],
    output_config: { effort: playbook ? 'medium' : 'low', format: betaZodOutputFormat(AiDesignSchema) }
  });
  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`design not produced (stop_reason=${response.stop_reason})`);
  }
  // AWPの値が不正・読みにくい場合は、型（明示選択があればそれ）の既定値で補う。型のヒーロー・書体・角は固定
  const design = finalize({ ...response.parsed_output, heroLayout: style.heroLayout, font: response.parsed_output.font || style.font, corner: style.corner }, preset);
  if (playbook) design.sectionOrder = playbook.sectionOrder;
  return design;
}

// 似たページだらけにならないための材料: 最近のページで多い「型×色相×書体」の組み合わせを文章にする
export function describeUsedCombos(designs: unknown[]): string | null {
  const count = new Map<string, number>();
  for (const d of designs as Partial<Design>[]) {
    if (!d?.palette?.primary) continue;
    const key = `${d.style ?? '?'} × 色相${hueBucket(d.palette.primary)} × ${d.font ?? '?'} × 強み${d.strengthsStyle ?? '?'}`;
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  const top = [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return top.length ? top.map(([k, n]) => `- ${k}（${n}ページ）`).join('\n') : null;
}

// --- Claude: Geminiの画像のレビューと、画像に合わせた配色の調整 ------------------------------

const ReviewSchema = z.object({
  acceptable: z.boolean().describe('公開して問題ない品質か'),
  issues: z.string().describe('問題点。再生成の指示としてそのまま使える英語で書く。問題がなければ空文字'),
  heroOverlay: z.string().describe(`この写真の上に白い文字を載せる場合に必要な暗幕の濃さ。${oneOf(OVERLAYS)}`),
  primary: z.string().describe('写真の色味と調和するメインカラー（#RRGGBB）。今のままで良ければ現在の色')
});

export type Review = { acceptable: boolean; issues: string; design: Design };

export async function reviewImageWithClaude(input: DesignInput, design: Design, image: { data: Buffer; mimeType: string }, templateKey?: string | null, lockAccent = false): Promise<Review> {
  const client = aiClient();
  const response = await client.beta.messages.parse({
    model: process.env.CLAUDE_MODEL || 'claude-opus-5',
    max_tokens: 2048,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system:
      'あなたはWebサイトの品質管理を担当するアートディレクターです。別のAWPが生成したメイン画像を厳しく確認してください。\n' +
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
    design: finalize({ ...design, palette: { ...design.palette, primary: r.primary }, heroOverlay: r.heroOverlay }, { ...presetFor(baseStyleFor(input, templateKey), design.accent), accentLocked: lockAccent })
  };
}

// --- メイン画像の生成 -----------------------------------------------------------------------
// Gemini（無料枠だと画像生成は1日0回のことが多い）に加えて、
// Cloudflare Workers AWP（1日10,000 Neuronsまで無料。FLUXの画像1枚は数Neuron程度）にも対応する。
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

// Cloudflare Workers AWP（FLUX.1 [schnell]）に、そのままの指示文で画像を1枚作らせる
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

// どの画像生成を使うか。IMAGE_PROVIDER（runway / cloudflare / gemini）で明示でき、未指定なら
// 品質の高い順に Runway → Cloudflare Workers（無料枠）→ Gemini の中から設定済みのものを選ぶ
export type ImageProvider = 'runway' | 'cloudflare' | 'gemini' | null;
export function imageProvider(): ImageProvider {
  const forced = (process.env.IMAGE_PROVIDER || '').toLowerCase();
  if (forced === 'runway' && runwayConfigured()) return 'runway';
  if (forced === 'cloudflare' && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) return 'cloudflare';
  if (forced === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (runwayConfigured()) return 'runway';
  if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) return 'cloudflare';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}

export async function generateHeroImage(imagePrompt: string, fixInstructions?: string): Promise<{ data: Buffer; mimeType: string }> {
  const p = imageProvider();
  if (p === 'runway') return runwayImage(buildImagePrompt(imagePrompt, fixInstructions), { ratio: 'landscape' });
  if (p === 'cloudflare') return heroImageWithWorkersAI(imagePrompt, fixInstructions);
  return heroImageWithGemini(imagePrompt, fixInstructions);
}

// アプリ自体の外装（マーケティングLP・ウィザードなどの装飾画像）用。
// 店主のLP画像とは違い、指示文をそのまま使う（「小規模事業のヒーロー画像」という前提を付けない）
export async function generateImage(prompt: string, opts: { ratio?: 'landscape' | 'portrait' | 'square' } = {}): Promise<{ data: Buffer; mimeType: string }> {
  const p = imageProvider();
  if (p === 'runway') return runwayImage(prompt.slice(0, 1000), { ratio: opts.ratio || 'landscape' });
  if (p === 'cloudflare') return imageFromWorkersAI(prompt.slice(0, 2000));
  return imageFromGemini(prompt.slice(0, 2000));
}
