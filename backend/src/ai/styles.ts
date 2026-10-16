// ---------------------------------------------------------------------------
// ページの「型」（スタイル）。ユーザーは画像（実際の見本）から型を選び、メインカラーを決める。
// 型は構成（ヒーローの組み方・書体・角・飾り・特徴ストリップ）を決め、色はユーザーのメインカラーから導く。
// 同じ型を選んでも、色・書体の組み合わせ・写真・文章で店ごとに違う仕上がりになる（designJob の重複回避も参照）。
// ---------------------------------------------------------------------------

export type Mode = 'light' | 'dark';
export type BgTint = 'hue' | 'neutral' | 'cream' | 'deep';

export type StyleSpec = {
  key: string;
  label: string;
  description: string;
  // 見本カードの説明に使う、向いている用途
  bestFor: string;
  mode: Mode;
  bgTint: BgTint;
  heroLayout: 'centered' | 'split' | 'imageBackground' | 'editorial' | 'stage' | 'glass' | 'fullBleed';
  font: 'modern' | 'elegant' | 'friendly' | 'bold' | 'editorial' | 'grotesk';
  corner: 'sharp' | 'soft' | 'round';
  strengthsStyle: 'cards' | 'numbered' | 'minimal';
  motif: 'rules' | 'pills' | 'cards' | 'glass' | 'none';
  featureStrip: boolean;
  defaultAccent: string;
  imagery: string;
  // この型と相性の良い業種（playbook の key）。業種から型を自動で選ぶときに使う
  industries: string[];
};

export const STYLES: StyleSpec[] = [
  {
    key: 'editorial', label: '雑誌のような', description: '大きな見出しと写真を重ねる、編集デザイン。明朝体で品よく',
    bestFor: 'クリエイター・サロン・物販', mode: 'light', bgTint: 'neutral', heroLayout: 'editorial', font: 'editorial', corner: 'sharp',
    strengthsStyle: 'minimal', motif: 'rules', featureStrip: false, defaultAccent: '#1f2937',
    imagery: 'editorial photograph with generous negative space, soft natural light, muted tones, one clear subject',
    industries: ['hair_salon', 'nail_eyelash', 'handmade_shop', 'design_creative', 'photo_video', 'flower_bridal']
  },
  {
    key: 'gallery', label: '作品を主役に', description: '暗い背景に写真を全面で。文字は細く、作品を引き立てる',
    bestFor: 'クリエイター・写真・音楽', mode: 'dark', bgTint: 'deep', heroLayout: 'fullBleed', font: 'grotesk', corner: 'sharp',
    strengthsStyle: 'minimal', motif: 'none', featureStrip: false, defaultAccent: '#e11d48',
    imagery: 'dramatic portrait-less creative scene, deep shadows, cinematic color grading, high contrast',
    industries: ['photo_video', 'music_artist', 'design_creative', 'dance_music_school']
  },
  {
    key: 'stage', label: '商品を舞台に', description: 'ニュートラルな背景に商品や写真を置き、特徴を一列に。上質な物販向け',
    bestFor: '物販・雑貨・ブランド', mode: 'light', bgTint: 'neutral', heroLayout: 'stage', font: 'elegant', corner: 'sharp',
    strengthsStyle: 'cards', motif: 'rules', featureStrip: true, defaultAccent: '#44403c',
    imagery: 'single product on a neutral stone or paper backdrop, studio softbox light, minimal, warm grey tones',
    industries: ['handmade_shop', 'bakery_sweets', 'agriculture', 'flower_bridal']
  },
  {
    key: 'glass', label: '夜のグラデーション', description: '深い色のグラデーションに、ガラスのようなカード。サービス・アプリ向け',
    bestFor: 'サービス・教室・コンサル', mode: 'dark', bgTint: 'hue', heroLayout: 'glass', font: 'grotesk', corner: 'soft',
    strengthsStyle: 'cards', motif: 'glass', featureStrip: true, defaultAccent: '#7c3aed',
    imagery: 'abstract glowing gradient shapes, depth of field, deep navy and violet, premium tech atmosphere',
    industries: ['professional', 'childcare_school', 'gym_fitness', 'other']
  },
  {
    key: 'corporate', label: '信頼の紺', description: '写真の上に白い見出し、角のない誠実なつくり。士業・企業向け',
    bestFor: '士業・不動産・企業', mode: 'light', bgTint: 'neutral', heroLayout: 'imageBackground', font: 'elegant', corner: 'sharp',
    strengthsStyle: 'cards', motif: 'rules', featureStrip: true, defaultAccent: '#1e3a8a',
    imagery: 'city skyline or clean office at dusk, calm blue hour, professional and trustworthy',
    industries: ['professional', 'construction_repair', 'auto', 'nursing_care']
  },
  {
    key: 'warmTable', label: '食卓の温度', description: 'クリーム色の背景に、料理の写真と明朝の見出し。あたたかい飲食店向け',
    bestFor: '飲食・カフェ・パン', mode: 'light', bgTint: 'cream', heroLayout: 'split', font: 'elegant', corner: 'round',
    strengthsStyle: 'numbered', motif: 'pills', featureStrip: false, defaultAccent: '#b45309',
    imagery: 'beautifully plated dish or fresh bread on a wooden table, warm window light, shallow depth of field',
    industries: ['restaurant', 'cafe', 'bakery_sweets', 'agriculture', 'lodging']
  },
  {
    key: 'clinic', label: '清潔な安心', description: '白と淡い色、やさしい角丸とアイコンの導線。医療・ケア向け',
    bestFor: 'クリニック・歯科・介護', mode: 'light', bgTint: 'hue', heroLayout: 'split', font: 'modern', corner: 'soft',
    strengthsStyle: 'cards', motif: 'cards', featureStrip: true, defaultAccent: '#0284c7',
    imagery: 'bright clean reception or treatment room with plants, soft daylight, calm and hygienic',
    industries: ['clinic', 'dental', 'nursing_care', 'acupuncture', 'massage_seitai']
  },
  {
    key: 'studio', label: '力強いコントラスト', description: '黒にアクセントカラー、太い見出し。ジム・スタジオ向け',
    bestFor: 'ジム・ダンス・車', mode: 'dark', bgTint: 'deep', heroLayout: 'imageBackground', font: 'bold', corner: 'sharp',
    strengthsStyle: 'numbered', motif: 'none', featureStrip: true, defaultAccent: '#f59e0b',
    imagery: 'dynamic training or workshop scene, dramatic side light, high contrast, energetic',
    industries: ['gym_fitness', 'dance_music_school', 'auto', 'music_artist']
  },
  {
    key: 'soft', label: 'やわらかい余白', description: '淡い色と丸み、親しみやすい雰囲気。家族・ペット・習い事向け',
    bestFor: 'ペット・保育・習い事', mode: 'light', bgTint: 'hue', heroLayout: 'centered', font: 'friendly', corner: 'round',
    strengthsStyle: 'cards', motif: 'pills', featureStrip: false, defaultAccent: '#f472b6',
    imagery: 'cheerful pastel scene, soft rounded shapes, gentle daylight, friendly and warm',
    industries: ['pet', 'childcare_school', 'yoga_pilates', 'soft']
  },
  {
    key: 'craft', label: '手仕事の質感', description: '生成りの背景に細い罫線、落ち着いた明朝。工房・作家向け',
    bestFor: '工房・作家・花', mode: 'light', bgTint: 'cream', heroLayout: 'split', font: 'editorial', corner: 'sharp',
    strengthsStyle: 'minimal', motif: 'rules', featureStrip: false, defaultAccent: '#78716c',
    imagery: 'handmade objects on linen, natural textures, soft shadow, earthy palette',
    industries: ['handmade_shop', 'flower_bridal', 'agriculture', 'lodging']
  },
  {
    key: 'community', label: 'つながりを見せる', description: '人と投稿を前面に。カードが並ぶ、SNSらしいつくり',
    bestFor: 'コミュニティ・イベント・個人', mode: 'light', bgTint: 'hue', heroLayout: 'centered', font: 'modern', corner: 'round',
    strengthsStyle: 'cards', motif: 'cards', featureStrip: true, defaultAccent: '#6d28d9',
    imagery: 'people gathering in a bright community space, candid, lively colors, no faces in close-up',
    industries: ['other', 'music_artist', 'dance_music_school']
  },
  {
    key: 'minimal', label: '余白と一文', description: '白い背景に一文。文字だけでも美しく成立する最小の型',
    bestFor: 'なんにでも', mode: 'light', bgTint: 'neutral', heroLayout: 'centered', font: 'modern', corner: 'soft',
    strengthsStyle: 'minimal', motif: 'none', featureStrip: false, defaultAccent: '#111827',
    imagery: 'minimal still life, lots of white space, soft shadow, calm',
    industries: ['other', 'professional', 'design_creative']
  }
];

export const STYLE_KEYS = STYLES.map((s) => s.key);

// 以前の6種類の見本（trust / elegant / fresh / bold / warm / calm）を新しい型に対応づける
export const LEGACY_STYLE: Record<string, string> = {
  trust: 'corporate', elegant: 'editorial', fresh: 'warmTable', bold: 'studio', warm: 'clinic', calm: 'soft'
};

export function styleOf(key: string | null | undefined): StyleSpec {
  const k = key && LEGACY_STYLE[key] ? LEGACY_STYLE[key] : key;
  return STYLES.find((s) => s.key === k) ?? STYLES.find((s) => s.key === 'minimal')!;
}

// 業種に最も合う型（ユーザーが選ばなかったときの既定）
export function styleForIndustry(industryKey: string | null | undefined): StyleSpec {
  if (!industryKey) return styleOf('minimal');
  return STYLES.find((s) => s.industries.includes(industryKey)) ?? styleOf('minimal');
}

// --- 色の導出（メインカラー → 背景・面・文字） ------------------------------------------------

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

// 色相を12分割した番号（似た色のページがどれだけあるかを数えるときに使う）
export function hueBucket(hex: string): number {
  const { h, s } = hexToHsl(hex);
  return s < 0.12 ? -1 : Math.round(h / 30) % 12;
}

export function paletteFor(accent: string, style: StyleSpec): { primary: string; background: string; surface: string; text: string } {
  const { h, s } = hexToHsl(accent);
  const tinted = s >= 0.12;
  if (style.mode === 'dark') {
    const bgH = style.bgTint === 'hue' && tinted ? h : h;
    const bgS = style.bgTint === 'deep' ? 0.08 : tinted ? 0.35 : 0.05;
    return {
      primary: accent,
      background: hslToHex(bgH, bgS, style.bgTint === 'deep' ? 0.06 : 0.09),
      surface: hslToHex(bgH, bgS * 0.8, style.bgTint === 'deep' ? 0.11 : 0.14),
      text: hslToHex(bgH, 0.15, 0.96)
    };
  }
  if (style.bgTint === 'cream') {
    return { primary: accent, background: '#fbf7f0', surface: '#ffffff', text: '#2b2520' };
  }
  if (style.bgTint === 'neutral') {
    return { primary: accent, background: '#fafaf9', surface: '#ffffff', text: '#1c1917' };
  }
  // hue: メインカラーをごく薄くした背景
  return {
    primary: accent,
    background: tinted ? hslToHex(h, 0.45, 0.975) : '#f8fafc',
    surface: '#ffffff',
    text: tinted ? hslToHex(h, 0.3, 0.12) : '#0f172a'
  };
}

// ユーザーが選べるメインカラーの候補（自由入力も可）
export const ACCENT_SWATCHES: { hex: string; label: string }[] = [
  { hex: '#1e3a8a', label: '紺' }, { hex: '#0284c7', label: '空' }, { hex: '#0f766e', label: '深緑' }, { hex: '#15803d', label: '緑' },
  { hex: '#b45309', label: '琥珀' }, { hex: '#c2410c', label: 'テラコッタ' }, { hex: '#e11d48', label: '紅' }, { hex: '#be185d', label: 'ローズ' },
  { hex: '#7c3aed', label: '紫' }, { hex: '#9a6b2f', label: '金茶' }, { hex: '#44403c', label: '墨' }, { hex: '#111827', label: '黒' }
];

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
