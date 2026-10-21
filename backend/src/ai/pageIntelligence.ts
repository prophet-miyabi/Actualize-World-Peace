// AWP Page Intelligence — 業種適合のページ構成・画像選定。
//
// 流れ: 最小の質問（3〜6問）→ 業種の判定と手本（IndustryPlaybook）→ 目的別の調査スナップショット
//      → 構成案を必ず3つ提案 → ユーザーが1つ選ぶ → 各セクションの画像候補（役割・被写体・雰囲気・理由つき）
//      → 選択 → LandingPage / sections へ反映。
// 原則: 画像は「業種に関係がある」だけでは入れない。セクションの目的・想定顧客・世界観・文字の可読性・
//      スマホでのトリミングを理由に選ぶ。事実（実績・声・数字）はユーザーの入力にあるものだけ使う。
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod/v4';
import prisma from '../prisma';
import { aiClient } from '../lib/aiUsage';
import { COMPANY_MODELS } from '../company/registry';
import { classifyIndustry, getPlaybook, industryOf, playbookBriefForCopy, playbookBriefForDesign, type Playbook } from './playbook';
import { designWithClaude, generateImage, imageProvider, presetDesign, type Design } from './design';
import { isHex } from './styles';
import { FEATURES } from '../features/catalog';
import type { StoredSection } from './designJob';

// ---- 選択肢（画面と共有する定義。文言は日本語、キーは英字） -------------------------------------

export const GOALS = [
  { key: 'attract', label: '集客（来店・利用を増やす）' },
  { key: 'booking', label: '予約を受ける' },
  { key: 'purchase', label: '商品を買ってもらう' },
  { key: 'inquiry', label: '問い合わせ・相談を受ける' },
  { key: 'recruit', label: '採用・仲間集め' },
  { key: 'brand', label: 'ブランド・事業の紹介' },
  { key: 'portfolio', label: '作品・実績を見せる' },
  { key: 'event', label: 'イベント申込' }
] as const;
export const TONES = [
  { key: 'luxury', label: '高級感', style: 'editorial' },
  { key: 'friendly', label: '親しみやすさ', style: 'warmTable' },
  { key: 'modern', label: '先進性', style: 'glass' },
  { key: 'calm', label: '落ち着き', style: 'clinic' },
  { key: 'pop', label: 'ポップ', style: 'community' },
  { key: 'minimal', label: 'ミニマル', style: 'minimal' }
] as const;
export const REQUIRED = [
  { key: 'booking', label: '予約ボタン' },
  { key: 'contact', label: '問い合わせフォーム' },
  { key: 'map', label: '地図・アクセス' },
  { key: 'menu', label: 'メニュー' },
  { key: 'pricing', label: '料金表' },
  { key: 'proof', label: '実績' },
  { key: 'reviews', label: 'お客様の声' },
  { key: 'posts', label: 'SNS投稿' }
] as const;
export const INDUSTRY_CHOICES = [
  '美容室・理容室', 'ネイル・まつげ', 'エステ・リラクゼーション', '整体・鍼灸', 'ジム・ヨガ', '飲食店', 'カフェ・ベーカリー',
  '歯科・クリニック', '士業（税理士・行政書士など）', '学習塾・教室', '法人向けサービス・SaaS', 'EC・物販', 'ハンドメイド',
  'クリエイター（写真・デザイン・音楽）', 'イベント', '不動産・リフォーム', 'ペット', '宿泊', '農業・生産者', 'その他'
] as const;

export const SECTION_IDS = ['hero', 'strengths', 'menu', 'faq', 'access', 'about', 'flow', 'campaign', 'posts', 'tools', 'line'] as const;
export type SectionId = (typeof SECTION_IDS)[number];
const SECTION_NAMES: Record<SectionId, string> = {
  hero: 'ファーストビュー', strengths: '選ばれる理由', menu: 'メニュー・料金', faq: 'よくある質問', access: 'アクセス・営業時間',
  about: '私たちについて', flow: 'ご利用の流れ', campaign: 'キャンペーン', posts: 'AWPの投稿', tools: 'オンライン窓口', line: '最終CTA（LINE・問い合わせ）'
};
const IMAGE_ROLES = ['hero', 'service', 'testimonial', 'team', 'menu', 'product', 'before_after', 'background', 'icon', 'illustration', 'diagram', 'screenshot'] as const;

export type SessionInput = {
  industry: string;
  pageGoal: string;
  targetAudience?: { ageRange?: string; gender?: string; area?: string; segment?: string; stage?: string };
  tone?: string;
  valueProps?: { problems?: string; strengths?: string; priceBand?: string; proof?: string; services?: string };
  requiredSections?: string[];
  lpId?: string | null;
};

export type ProposalSection = {
  id: SectionId;
  name: string;
  purpose: string;
  heading: string;
  body: string;
  bullets: string[];
  image: { role: string; subject: string; mood: string; tone: string; aspect: string; placement: string; mediaType: string; prompt: string } | null;
  cta: { label: string } | null;
  mobilePriority: number;
  postsBlock: boolean;
};

const MODEL = COMPANY_MODELS.balanced;
const now = () => new Date().toISOString();

async function emit(type: string, actor: string, payload?: Record<string, unknown>) {
  await prisma.companyEvent.create({ data: { type, actor, payload: payload as any } }).catch(() => {});
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error(`${label} が ${Math.round(ms / 1000)} 秒以内に終わりませんでした`)), ms); })
  ]).finally(() => clearTimeout(t));
}

const labelOf = (list: readonly { key: string; label: string }[], key: string) => list.find((x) => x.key === key)?.label ?? key;

// ---- 1. 最小入力 → 仮設定（assumptions） ------------------------------------------------------

export function inferDefaults(input: SessionInput) {
  const assumptions: { field: string; value: string; reason: string }[] = [];
  const goal = GOALS.some((g) => g.key === input.pageGoal) ? input.pageGoal : 'attract';
  if (goal !== input.pageGoal) assumptions.push({ field: 'pageGoal', value: labelOf(GOALS, goal), reason: '目的が未指定のため、最も一般的な「集客」で仮置き' });

  const ind = input.industry;
  const local = /美容|ネイル|エステ|整体|ジム|飲食|カフェ|歯科|塾|教室|不動産|ペット|宿泊/.test(ind);
  const b2b = /法人|SaaS|士業/.test(ind);
  const ta = { ...(input.targetAudience ?? {}) };
  if (!ta.segment) { ta.segment = b2b ? 'b2b' : 'b2c'; assumptions.push({ field: 'targetAudience.segment', value: ta.segment === 'b2b' ? '法人のお客様' : '個人のお客様', reason: `業種「${ind}」から想定` }); }
  if (!ta.area && local) { ta.area = '店舗の近隣'; assumptions.push({ field: 'targetAudience.area', value: '店舗の近隣', reason: '来店型の業種のため、地域のお客様を想定' }); }
  if (!ta.ageRange) { ta.ageRange = b2b ? '担当者（30〜50代）' : '20〜50代'; assumptions.push({ field: 'targetAudience.ageRange', value: ta.ageRange, reason: '未指定のため広めに想定' }); }

  let tone = TONES.some((t) => t.key === input.tone) ? input.tone! : '';
  if (!tone) {
    tone = /美容|ネイル|エステ|宿泊|不動産/.test(ind) ? 'luxury' : /士業|歯科|クリニック|法人|SaaS/.test(ind) ? 'calm' : /カフェ|ハンドメイド|ペット|農業|教室/.test(ind) ? 'friendly' : /クリエイター|イベント/.test(ind) ? 'modern' : 'calm';
    assumptions.push({ field: 'tone', value: labelOf(TONES, tone), reason: `業種「${ind}」で選ばれやすい雰囲気` });
  }

  const req = new Set((input.requiredSections ?? []).filter((k) => REQUIRED.some((r) => r.key === k)));
  if (req.size === 0) {
    const d = goal === 'booking' ? ['booking', 'menu', 'map'] : goal === 'purchase' ? ['pricing', 'proof'] : goal === 'inquiry' ? ['contact', 'proof'] : goal === 'portfolio' ? ['posts', 'proof'] : goal === 'event' ? ['contact', 'map'] : local ? ['map', 'menu'] : ['contact'];
    d.forEach((k) => req.add(k));
    assumptions.push({ field: 'requiredSections', value: d.map((k) => labelOf(REQUIRED, k)).join('・'), reason: `目的「${labelOf(GOALS, goal)}」で欠かせない要素を仮置き` });
  }
  return { goal, targetAudience: ta, tone, requiredSections: [...req], assumptions };
}

// ---- 2. 業種別の調査（スナップショット。業種×目的で60日共有） ------------------------------------

const SNAPSHOT_FRESH_MS = 60 * 24 * 3600_000;

const SnapshotSchema = z.object({
  patterns: z.array(z.string()).describe('この業種×目的の人気ページに共通する構成パターン（4〜6個、1文ずつ）'),
  commonSections: z.array(z.object({ id: z.string().describe(`次のいずれか: ${SECTION_IDS.join(' / ')}`), purpose: z.string() })).describe('人気ページに共通するセクションの並び（上から順）'),
  commonCta: z.array(z.string()).describe('この目的で成果が出やすい主ボタンの文言（3〜5個、12文字以内）'),
  trustElements: z.array(z.string()).describe('信頼を作る要素（事業者が事実として用意できるもの）'),
  imagePatterns: z.array(z.object({
    sectionId: z.string(),
    role: z.string().describe(`次のいずれか: ${IMAGE_ROLES.join(' / ')}`),
    subject: z.string().describe('人気ページで多い被写体（日本語）'),
    mood: z.string().describe('光・色調・構図の傾向')
  })).describe('セクションごとの画像の傾向'),
  mobileNotes: z.array(z.string()).describe('スマホでの読みやすさ・CTA到達のために人気ページがしていること（3〜4個）'),
  differentiators: z.array(z.string()).describe('競合が繰り返す型に対して、AWPのページで差をつけられる点（3〜4個）'),
  sourceSummary: z.string().describe('何を根拠にしたかの要約（2〜3文）')
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

function fallbackSnapshot(pb: Playbook, goal: string): Snapshot {
  return {
    patterns: [pb.summary, `決め手: ${pb.decisionFactors.join(' / ')}`],
    commonSections: pb.sectionOrder.map((id) => ({ id, purpose: SECTION_NAMES[id as SectionId] ?? id })),
    commonCta: [pb.hero.ctaLabel, pb.hero.secondaryCtaLabel],
    trustElements: pb.trustElements,
    imagePatterns: [{ sectionId: 'hero', role: 'hero', subject: pb.visual.imagery, mood: pb.visual.mood }],
    mobileNotes: ['ファーストビューに主ボタンを置く', '画面下に追従ボタンを置く', '1画面1メッセージで縦に並べる'],
    differentiators: ['投稿（SNS）をページに自動で載せ、更新され続けるページにする', 'ユーザーごとに型×色×写真を変え、同業で似た見た目にしない'],
    sourceSummary: `同業種（${pb.label}）の手本をもとにした一般的な型（目的: ${goal}）。`
  };
}

export async function researchSnapshot(industryKey: string, goal: string, region?: string | null) {
  const ind = industryOf(industryKey);
  const row = await prisma.pageResearchSnapshot.findFirst({ where: { industryKey: ind.key, goal }, orderBy: { researchedAt: 'desc' } });
  if (row && Date.now() - row.researchedAt.getTime() < SNAPSHOT_FRESH_MS) return row;
  const pb = await getPlaybook(ind.key, { wait: true });
  let snap: Snapshot;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await withTimeout(aiClient().beta.messages.parse({
        model: MODEL,
        max_tokens: 2500,
        system: [
          'あなたは日本の中小事業者のウェブページを数多く分析してきたリサーチャーです。',
          '渡された「同業種の人気ページの型」を根拠に、指定の目的（集客・予約・購入など）に合わせて、人気ページに共通する構成・CTA・信頼要素・画像の傾向を整理します。',
          '事実を作らず、一般論と型から言えることだけを書きます。英字2文字の略語（人工知能を指す語）は使わず「AWP」「intelligence」と書きます。'
        ].join('\n'),
        messages: [{ role: 'user', content: [`業種: ${pb.label}`, `ページの目的: ${labelOf(GOALS, goal)}`, region ? `地域: ${region}` : '', '', playbookBriefForDesign(pb), '', playbookBriefForCopy(pb), '', `人気ページの並び: ${pb.sectionOrder.join(' → ')}`, `おすすめ機能: ${pb.recommendedFeatures.map((f) => `${f.id}（${f.reason}）`).join(' / ')}`].filter(Boolean).join('\n') }],
        output_config: { effort: 'low', format: betaZodOutputFormat(SnapshotSchema) }
      }), 90_000, '調査');
      if (!r.parsed_output) throw new Error('no output');
      snap = r.parsed_output;
    } catch (e: any) {
      console.error('page intelligence research failed, using playbook fallback', ind.key, goal, e?.message);
      snap = fallbackSnapshot(pb, goal);
    }
  } else {
    snap = fallbackSnapshot(pb, goal);
  }
  return prisma.pageResearchSnapshot.create({
    data: {
      industryKey: ind.key, goal, region: region ?? null,
      patterns: snap.patterns as any, commonSections: snap.commonSections as any, commonCta: snap.commonCta as any,
      trustElements: snap.trustElements as any, imagePatterns: snap.imagePatterns as any,
      differentiators: [...snap.differentiators, ...snap.mobileNotes.map((n) => `スマホ: ${n}`)] as any,
      sourceSummary: snap.sourceSummary
    }
  });
}

// ---- 3. 構成案（必ず3案） -----------------------------------------------------------------------

const ImageSpecSchema = z.object({
  role: z.string().describe(`画像の役割。次のいずれか: ${IMAGE_ROLES.join(' / ')}`),
  subject: z.string().describe('被写体の説明（日本語、具体的に。人物の顔のアップは避ける）'),
  mood: z.string().describe('雰囲気（光・構図・余白）'),
  tone: z.string().describe('色調（メインカラーとの関係を含む）'),
  aspect: z.string().describe('推奨アスペクト比。16:9 / 4:3 / 1:1 / 4:5 のいずれか'),
  placement: z.string().describe('配置と、スマホでトリミングされても主題が残るための方針（1文）'),
  mediaType: z.string().describe('photo / illustration / diagram / screenshot / video のいずれか'),
  prompt: z.string().describe('画像を生成するための英語の指示文（被写体・光・色調・構図・余白。no text, no logos, no close-up faces を含める）')
});
const SectionSchema = z.object({
  id: z.string().describe(`セクションID。次のいずれか: ${SECTION_IDS.join(' / ')}`),
  name: z.string().describe('セクション名（日本語）'),
  purpose: z.string().describe('このセクションの目的（1文）'),
  heading: z.string().describe('見出し案（30文字以内）'),
  body: z.string().describe('本文案（1〜3文）。入力にない実績・数字・声は書かない'),
  bullets: z.array(z.string()).describe('箇条書き案（0〜5）。strengths=短い強み3つ / menu=「名前｜料金｜説明」（料金が入力に無ければ「要確認」）/ faq=「質問｜答え」/ flow=「手順名｜説明」/ access=「項目｜内容」/ それ以外は補足'),
  image: ImageSpecSchema.nullable().describe('必要な画像。文字だけで十分なセクション（faq など）は null'),
  cta: z.object({ label: z.string().describe('ボタン文言（12文字以内）') }).nullable(),
  mobilePriority: z.number().describe('スマホでの優先表示順（1が最上位）'),
  postsBlock: z.boolean().describe('この位置に AWP 内の投稿ブロックを埋め込むか')
});
const ProposalsSchema = z.object({
  proposals: z.array(z.object({
    name: z.string().describe('案の名前（12文字以内。例: 信頼で選ばれる構成）'),
    concept: z.string().describe('狙いを1文で'),
    whyItWorks: z.string().describe('この業種・目的・想定顧客に効く理由（2〜3文）'),
    imageDirection: z.string().describe('この案の画像の方針を1〜2文で（被写体の系統・色調・写真/イラストの別）'),
    sections: z.array(SectionSchema).describe('上から順に6〜9個。hero を先頭、line を末尾に'),
    confidence: z.number().describe('この案が目的達成に効く確信度 0〜1')
  })).describe('互いに方向性の異なる3案（例: 信頼重視 / 行動までの最短 / 世界観で惹きつける）')
});

type SessionRow = NonNullable<Awaited<ReturnType<typeof prisma.pageIntelligenceSession.findUnique>>>;

function describeSession(s: SessionRow) {
  const ta = (s.targetAudience ?? {}) as Record<string, string>;
  const vp = (s.valueProps ?? {}) as Record<string, string>;
  return [
    `業種: ${s.industry}`,
    `ページの目的: ${labelOf(GOALS, s.pageGoal)}`,
    `想定顧客: ${[ta.segment === 'b2b' ? '法人' : '個人', ta.ageRange, ta.gender, ta.area, ta.stage].filter(Boolean).join(' / ')}`,
    `好みの雰囲気: ${labelOf(TONES, s.tone ?? '')}`,
    `必須要素: ${s.requiredSections.map((k) => labelOf(REQUIRED, k)).join('・') || 'なし'}`,
    vp.services ? `提供サービス: ${vp.services}` : '',
    vp.problems ? `解決できる課題: ${vp.problems}` : '',
    vp.strengths ? `強み: ${vp.strengths}` : '',
    vp.priceBand ? `価格帯: ${vp.priceBand}` : '',
    vp.proof ? `実績（事実として入力されたもの）: ${vp.proof}` : '実績: 入力なし（実績・数字・声は書かない）'
  ].filter(Boolean).join('\n');
}

function normalizeSection(raw: z.infer<typeof SectionSchema>): ProposalSection | null {
  if (!(SECTION_IDS as readonly string[]).includes(raw.id)) return null;
  const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const img = raw.image;
  return {
    id: raw.id as SectionId,
    name: clean(raw.name, 20) || SECTION_NAMES[raw.id as SectionId],
    purpose: clean(raw.purpose, 80),
    heading: clean(raw.heading, 40),
    body: clean(raw.body, 300),
    bullets: (raw.bullets ?? []).map((b) => clean(b, 120)).filter(Boolean).slice(0, 6),
    image: img ? {
      role: (IMAGE_ROLES as readonly string[]).includes(img.role) ? img.role : 'service',
      subject: clean(img.subject, 120), mood: clean(img.mood, 80), tone: clean(img.tone, 80),
      aspect: ['16:9', '4:3', '1:1', '4:5'].includes(img.aspect) ? img.aspect : raw.id === 'hero' ? '16:9' : '4:3',
      placement: clean(img.placement, 120), mediaType: clean(img.mediaType, 20) || 'photo', prompt: clean(img.prompt, 600)
    } : null,
    cta: raw.cta?.label ? { label: clean(raw.cta.label, 14) } : null,
    mobilePriority: Number.isFinite(raw.mobilePriority) ? Math.max(1, Math.round(raw.mobilePriority)) : 9,
    postsBlock: !!raw.postsBlock
  };
}

function ensureRequired(sections: ProposalSection[], required: string[]): ProposalSection[] {
  const has = (id: SectionId) => sections.some((s) => s.id === id);
  const add = (id: SectionId, heading: string, purpose: string) => { if (!has(id)) sections.splice(Math.max(1, sections.length - 1), 0, { id, name: SECTION_NAMES[id], purpose, heading, body: '', bullets: [], image: null, cta: null, mobilePriority: 8, postsBlock: id === 'posts' }); };
  if (!has('hero')) sections.unshift({ id: 'hero', name: SECTION_NAMES.hero, purpose: '3秒で誰向けの何かを伝える', heading: '', body: '', bullets: [], image: null, cta: { label: '相談する' }, mobilePriority: 1, postsBlock: false });
  if (required.includes('menu') || required.includes('pricing')) add('menu', 'メニューと料金', '料金の不安をなくす');
  if (required.includes('map')) add('access', 'アクセス', '迷わず来てもらう');
  if (required.includes('posts')) add('posts', '最近の投稿', '更新され続けている安心感');
  if (!has('line')) sections.push({ id: 'line', name: SECTION_NAMES.line, purpose: '最後の一押し', heading: 'お気軽にご相談ください', body: '', bullets: [], image: null, cta: { label: 'LINEで相談' }, mobilePriority: 2, postsBlock: false });
  // 同じIDは最初の1つだけ。スマホで長くなりすぎないよう最大9個（必須でないものから外す）
  const seen = new Set<string>();
  const out = sections.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  const removable = ['tools', 'campaign', 'faq', 'flow', 'about', 'strengths'].filter((id) => !(id === 'posts' && required.includes('posts')));
  for (const id of removable) {
    if (out.length <= 9) break;
    const i = out.findIndex((s) => s.id === id);
    if (i > 0 && i < out.length - 1) out.splice(i, 1);
  }
  return out.slice(0, 9);
}

function fallbackProposals(s: SessionRow, pb: Playbook): { name: string; concept: string; whyItWorks: string; imageDirection: string; sections: ProposalSection[]; confidence: number }[] {
  const base = (variant: 'trust' | 'fast' | 'mood'): ProposalSection[] => {
    const order = variant === 'fast' ? ['hero', 'menu', 'flow', 'faq', 'access', 'line'] : variant === 'mood' ? ['hero', 'about', 'strengths', 'posts', 'menu', 'line'] : pb.sectionOrder.filter((id) => (SECTION_IDS as readonly string[]).includes(id));
    return order.map((id, i) => ({
      id: id as SectionId, name: SECTION_NAMES[id as SectionId], purpose: '', heading: '', body: '', bullets: [],
      image: id === 'hero'
        ? { role: 'hero', subject: `${pb.label}らしい明るい空間、または商品・仕上がりの寄り（自然光）`, mood: pb.visual.mood, tone: 'メインカラーに調和する落ち着いた色調', aspect: '16:9', placement: '中央に主題。左右が切れても成立', mediaType: 'photo', prompt: pb.visual.imagery }
        : id === 'about'
          ? { role: 'team', subject: '仕事の場の雰囲気（道具・手元・空間）', mood: '自然光', tone: '温かみのある色調', aspect: '4:3', placement: '文章の横', mediaType: 'photo', prompt: 'calm workplace interior with tools and natural light, no people faces, no text' }
          : null,
      cta: id === 'hero' || id === 'line' ? { label: pb.hero.ctaLabel } : null, mobilePriority: i + 1, postsBlock: id === 'posts'
    }));
  };
  return [
    { name: '信頼で選ばれる構成', concept: '不安を先に消して、安心して申し込める流れ', whyItWorks: `${pb.label}のお客様は「${pb.decisionFactors.slice(0, 2).join('」「')}」で決めます。信頼要素を前半に置きます。`, imageDirection: '実際の場・道具・仕上がりを自然光で。人物の顔は出さない', sections: ensureRequired(base('trust'), s.requiredSections), confidence: 0.6 },
    { name: '行動までの最短構成', concept: 'メニューと流れを先に見せ、迷いなく予約・問い合わせへ', whyItWorks: 'スマホでは最初の2画面で決まります。料金と手順を早く見せ、ボタンを常に届く位置に置きます。', imageDirection: '商品・メニューのクローズアップ中心。余白を多く', sections: ensureRequired(base('fast'), s.requiredSections), confidence: 0.55 },
    { name: '世界観で惹きつける構成', concept: '想いと日々の投稿で「この人に頼みたい」を作る', whyItWorks: '価格で比べられにくくするには、人柄と空気感を先に伝えるのが有効です。投稿ブロックで更新感を出します。', imageDirection: '空間・手元・素材のディテール。色調をメインカラーに寄せる', sections: ensureRequired(base('mood'), s.requiredSections), confidence: 0.5 }
  ];
}

export async function generateProposals(sessionId: string) {
  const s = await prisma.pageIntelligenceSession.findUnique({ where: { id: sessionId } });
  if (!s) throw new Error('セッションがありません');
  const pb = await getPlaybook(s.industryKey, { wait: false });
  const snap = s.researchSnapshotId ? await prisma.pageResearchSnapshot.findUnique({ where: { id: s.researchSnapshotId } }) : null;
  let proposals: { name: string; concept: string; whyItWorks: string; imageDirection: string; sections: ProposalSection[]; confidence: number }[];
  let sourceSummary = snap?.sourceSummary ?? `同業種（${pb.label}）の手本`;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await withTimeout(aiClient().beta.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        system: [
          'あなたは日本の中小事業者のランディングページを設計する一流のディレクターです。',
          '与えられた最小限の入力と、同業種の人気ページの型・調査結果から、互いに方向性の異なる構成案を必ず3つ作ります。',
          '守ること:',
          '- 各セクションに「目的・見出し案・本文案・必要な画像の役割と被写体と雰囲気・CTA・スマホでの優先順」を必ず入れる。',
          '- 画像は「業種に関係がある」だけで入れない。そのセクションの目的に効く被写体を具体的に書き、汎用的なストック写真（握手・笑顔の集合・ビジネスマンのシルエット）は禁止。文字だけで十分なセクションは image を null にする。',
          '- 事実（実績・数字・お客様の声・受賞）は入力にあるものだけ使う。無ければ書かない。',
          '- 必須要素（menu / pricing → menu、map → access、posts → posts、booking / contact → line の CTA）を必ず含める。',
          '- hero を先頭、line を末尾に。セクションは6〜9個。',
          '- 英字2文字の略語（人工知能を指す語）は使わず「AWP」「intelligence」と書く。',
          '- 3案の例: A 信頼で選ばれる（不安の解消を前半に） / B 行動までの最短（料金・流れを先に） / C 世界観で惹きつける（想いと投稿）。業種・目的に合わせて名前と中身を変えてよい。'
        ].join('\n'),
        messages: [{ role: 'user', content: [describeSession(s), '', `【仮置きした前提】${JSON.stringify(s.assumptions ?? [])}`, '', playbookBriefForDesign(pb), '', playbookBriefForCopy(pb), snap ? `\n【目的別の調査】\n構成パターン: ${JSON.stringify(snap.patterns)}\n共通セクション: ${JSON.stringify(snap.commonSections)}\nCTA: ${JSON.stringify(snap.commonCta)}\n信頼要素: ${JSON.stringify(snap.trustElements)}\n画像の傾向: ${JSON.stringify(snap.imagePatterns)}\n差別化: ${JSON.stringify(snap.differentiators)}` : ''].join('\n') }],
        output_config: { effort: 'medium', format: betaZodOutputFormat(ProposalsSchema) }
      }), 150_000, '構成案の作成');
      if (!r.parsed_output?.proposals?.length) throw new Error('no proposals');
      proposals = r.parsed_output.proposals.slice(0, 3).map((p) => ({
        name: p.name.slice(0, 20), concept: p.concept.slice(0, 120), whyItWorks: p.whyItWorks.slice(0, 400), imageDirection: p.imageDirection.slice(0, 200),
        sections: ensureRequired(p.sections.map(normalizeSection).filter((x): x is ProposalSection => !!x), s.requiredSections),
        confidence: Math.min(1, Math.max(0, p.confidence))
      }));
      while (proposals.length < 3) proposals.push(fallbackProposals(s, pb)[proposals.length]);
    } catch (e: any) {
      console.error('page intelligence proposals failed, using fallback', sessionId, e?.message);
      await emit('page_intelligence.error', 'page-intelligence', { sessionId, stage: 'structure', error: String(e?.message ?? e) });
      proposals = fallbackProposals(s, pb);
      sourceSummary += '（intelligence が応答しなかったため一般的な型で作成）';
    }
  } else {
    proposals = fallbackProposals(s, pb);
  }
  await prisma.pageStructureSuggestion.deleteMany({ where: { sessionId, status: 'proposed' } });
  const rows = [];
  for (const p of proposals) {
    rows.push(await prisma.pageStructureSuggestion.create({
      data: { sessionId, landingPageId: s.lpId, industry: s.industry, goal: s.pageGoal, name: p.name, concept: p.concept, whyItWorks: `${p.whyItWorks}\n画像の方針: ${p.imageDirection}`, sections: p.sections as any, confidence: p.confidence, sourceSummary }
    }));
  }
  await prisma.pageIntelligenceSession.update({ where: { id: sessionId }, data: { status: 'structured', selectedProposalId: null } });
  await emit('page_intelligence.structure', 'page-intelligence', { sessionId, proposals: rows.map((r) => r.name) });
  return rows;
}

// ---- 4. 画像候補 ----------------------------------------------------------------------------------

const MAX_GENERATED_PER_RUN = 4;
const ratioOf = (aspect: string): 'landscape' | 'portrait' | 'square' => (aspect === '1:1' ? 'square' : aspect === '4:5' ? 'portrait' : 'landscape');

// JPEG / PNG / WebP のヘッダから幅と高さを読む（レイアウト崩れ防止のため width/height を必ず出す）
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    }
  } catch { /* 不明 */ }
  return null;
}

function altFor(sec: ProposalSection, businessName?: string) {
  const subj = sec.image?.subject ?? sec.name;
  return `${businessName ? businessName + 'の' : ''}${subj}`.slice(0, 120);
}

function cropPolicyFor(aspect: string, placement: string) {
  return placement || (aspect === '16:9' ? 'スマホでは左右を切って中央を見せる。主題は中央1/2に収める' : '主題を中央に置き、上下左右どちらを切っても成立させる');
}

async function createCandidate(opts: { sessionId: string; proposalId: string; sec: ProposalSection; businessName?: string; generate: boolean; moodOverride?: string }) {
  const { sec } = opts;
  const img = sec.image!;
  const prompt = [img.prompt || `${img.subject}, ${img.mood}`, opts.moodOverride ? `Mood change: ${opts.moodOverride}.` : '', 'no text, no letters, no logos, no watermarks, no close-up faces, photorealistic, high detail'].filter(Boolean).join('. ').slice(0, 1000);
  const base = {
    sessionId: opts.sessionId, proposalId: opts.proposalId, sectionId: sec.id, role: img.role,
    subject: opts.moodOverride ? `${img.subject}（雰囲気: ${opts.moodOverride}）` : img.subject, tone: img.tone || img.mood, aspectRatio: img.aspect,
    cropPolicy: cropPolicyFor(img.aspect, img.placement), prompt,
    reason: `${sec.purpose || sec.name}のために「${img.subject}」を置きます。${img.mood ? `雰囲気は${img.mood}。` : ''}${img.placement ? img.placement : ''}`.slice(0, 300),
    alternatives: [{ subject: `${img.subject}を別の角度・引きで`, tone: img.tone }, { subject: 'ユーザーが撮った実物の写真', tone: '自然光で明るく' }] as any,
    altText: altFor(sec, opts.businessName)
  };
  if (!opts.generate) {
    return prisma.pageImageSuggestion.create({ data: { ...base, source: 'none', licenseInfo: '未生成（指示書のみ）', status: 'pending', reason: base.reason + ' 画像はあとから生成または自分の写真に差し替えられます。' } });
  }
  try {
    const out = await withTimeout(generateImage(prompt, { ratio: ratioOf(img.aspect) }), 120_000, '画像生成');
    const size = imageSize(out.data);
    return prisma.pageImageSuggestion.create({ data: { ...base, source: 'generated', licenseInfo: `AWP が生成（${imageProvider()}）。商用利用可・第三者の権利を含まない指示で生成`, data: out.data, mimeType: out.mimeType, width: size?.width ?? null, height: size?.height ?? null } });
  } catch (e: any) {
    console.error('page intelligence image failed', sec.id, e?.message);
    await emit('page_intelligence.error', 'page-intelligence', { sessionId: opts.sessionId, stage: 'image', sectionId: sec.id, error: String(e?.message ?? e) });
    return prisma.pageImageSuggestion.create({ data: { ...base, source: 'none', licenseInfo: '生成に失敗', status: 'failed', reason: base.reason + ' 生成に失敗したため、別の候補を試すか写真をアップロードしてください。' } });
  }
}

export async function suggestImages(sessionId: string, proposalId: string) {
  const s = await prisma.pageIntelligenceSession.findUnique({ where: { id: sessionId } });
  const p = await prisma.pageStructureSuggestion.findFirst({ where: { id: proposalId, sessionId } });
  if (!s || !p) throw new Error('構成案がありません');
  const sections = p.sections as unknown as ProposalSection[];
  const sel = (s.selections ?? {}) as Record<string, unknown>;
  const businessName = typeof sel.businessName === 'string' ? sel.businessName : undefined;
  await prisma.pageStructureSuggestion.updateMany({ where: { sessionId }, data: { status: 'proposed' } });
  await prisma.pageStructureSuggestion.update({ where: { id: p.id }, data: { status: 'selected' } });
  await prisma.pageIntelligenceSession.update({ where: { id: sessionId }, data: { selectedProposalId: p.id } });

  // ユーザーが既にアップロードした写真を最優先の候補として並べる（ページがある場合）
  const uploads = s.lpId ? await prisma.photo.findMany({ where: { lpId: s.lpId, isLogo: false }, orderBy: { position: 'asc' }, take: 6, select: { id: true, originalType: true } }) : [];
  const withImage = sections.filter((x) => x.image).sort((a, b) => (a.id === 'hero' ? -1 : b.id === 'hero' ? 1 : a.mobilePriority - b.mobilePriority));
  const existing = await prisma.pageImageSuggestion.findMany({ where: { sessionId, proposalId }, select: { sectionId: true } });
  const done = new Set(existing.map((e) => e.sectionId));
  const canGenerate = !!imageProvider();
  let generated = 0;
  const created: { id: string; sectionId: string }[] = [];
  for (const sec of withImage) {
    if (done.has(sec.id)) continue;
    if (uploads.length && sec.id !== 'hero') {
      const u = uploads[(created.length) % uploads.length];
      created.push(await prisma.pageImageSuggestion.create({ data: {
        sessionId, proposalId, sectionId: sec.id, role: sec.image!.role, subject: 'あなたがアップロードした写真', tone: '実物', aspectRatio: sec.image!.aspect,
        cropPolicy: cropPolicyFor(sec.image!.aspect, ''), uploadId: u.id, mimeType: u.originalType, source: 'upload', licenseInfo: 'ユーザー所有の写真', reason: '実物の写真は生成画像より信頼されます。被写体が合えば最優先で使います。', altText: altFor(sec, businessName), status: 'candidate'
      } }));
    }
    const gen = canGenerate && generated < MAX_GENERATED_PER_RUN;
    created.push(await createCandidate({ sessionId, proposalId: p.id, sec, businessName, generate: gen }));
    if (gen) generated++;
  }
  await prisma.pageIntelligenceSession.update({ where: { id: sessionId }, data: { status: 'imaged' } });
  await emit('page_intelligence.images', 'page-intelligence', { sessionId, proposalId, created: created.length, generated, provider: imageProvider() });
  return created;
}

export async function alternativeImage(sessionId: string, imageId: string, mood?: string) {
  const s = await prisma.pageIntelligenceSession.findUnique({ where: { id: sessionId } });
  const cur = await prisma.pageImageSuggestion.findFirst({ where: { id: imageId, sessionId } });
  if (!s || !cur || !cur.proposalId) throw new Error('候補がありません');
  const p = await prisma.pageStructureSuggestion.findUnique({ where: { id: cur.proposalId } });
  const sec = (p?.sections as unknown as ProposalSection[] | undefined)?.find((x) => x.id === cur.sectionId);
  if (!sec?.image) throw new Error('このセクションには画像の指定がありません');
  const sel = (s.selections ?? {}) as Record<string, unknown>;
  const businessName = typeof sel.businessName === 'string' ? sel.businessName : undefined;
  return createCandidate({ sessionId, proposalId: cur.proposalId, sec, businessName, generate: !!imageProvider(), moodOverride: mood?.slice(0, 80) });
}

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;
export async function uploadCandidate(sessionId: string, sectionId: string, dataUrl: string) {
  const s = await prisma.pageIntelligenceSession.findUnique({ where: { id: sessionId } });
  if (!s || !s.selectedProposalId) throw new Error('先に構成案を選んでください');
  const m = DATA_URL_RE.exec(dataUrl || '');
  if (!m) throw new Error('対応していない画像形式です（JPEG/PNG/WebPのみ）');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw new Error('画像サイズは8MBまでにしてください');
  const p = await prisma.pageStructureSuggestion.findUnique({ where: { id: s.selectedProposalId } });
  const sec = (p?.sections as unknown as ProposalSection[] | undefined)?.find((x) => x.id === sectionId);
  const size = imageSize(buf);
  const sel = (s.selections ?? {}) as Record<string, unknown>;
  const row = await prisma.pageImageSuggestion.create({ data: {
    sessionId, proposalId: s.selectedProposalId, sectionId, role: sec?.image?.role ?? 'service', subject: 'あなたがアップロードした写真', tone: '実物',
    aspectRatio: sec?.image?.aspect ?? '4:3', cropPolicy: cropPolicyFor(sec?.image?.aspect ?? '4:3', ''), data: buf, mimeType: m[1], width: size?.width ?? null, height: size?.height ?? null,
    source: 'upload', licenseInfo: 'ユーザー所有の写真（本人の責任で権利を確認）', reason: '実物の写真は、生成画像より信頼されます。', altText: altFor(sec ?? { id: sectionId as SectionId, name: SECTION_NAMES[sectionId as SectionId] ?? sectionId, purpose: '', heading: '', body: '', bullets: [], image: null, cta: null, mobilePriority: 9, postsBlock: false }, typeof sel.businessName === 'string' ? sel.businessName : undefined), status: 'selected'
  } });
  // アップロードしたものは自動でそのセクションの選択にする
  const images = { ...((sel.images as Record<string, string>) ?? {}), [sectionId]: row.id };
  await prisma.pageIntelligenceSession.update({ where: { id: sessionId }, data: { selections: { ...sel, images } as any } });
  return row;
}

// ---- 5. 反映（LandingPage / sections） ----------------------------------------------------------

const split = (b: string) => b.split(/[｜|]/).map((x) => x.trim());

function contentFor(sec: ProposalSection, imageUrl: { url: string; alt: string; width: number | null; height: number | null } | null): Record<string, unknown> | null {
  const img = imageUrl ? { image: imageUrl } : {};
  switch (sec.id) {
    case 'menu':
      return { heading: sec.heading || 'メニュー・料金', intro: sec.body, items: sec.bullets.map((b) => { const [name = '', price = '', description = ''] = split(b); return { name, price, description }; }).filter((i) => i.name), note: '', ...img };
    case 'faq':
      return { heading: sec.heading || 'よくある質問', items: sec.bullets.map((b) => { const [question = '', answer = ''] = split(b); return { question, answer }; }).filter((i) => i.question && i.answer) };
    case 'access':
      return { heading: sec.heading || 'アクセス', directions: sec.body, rows: sec.bullets.map((b) => { const [label = '', value = ''] = split(b); return { label, value }; }).filter((r) => r.label), mapUrl: '', ...img };
    case 'about':
      return { heading: sec.heading || '私たちについて', body: [sec.body, ...sec.bullets].filter(Boolean), signature: '', ...img };
    case 'flow':
      return { heading: sec.heading || 'ご利用の流れ', steps: sec.bullets.map((b) => { const [title = '', description = ''] = split(b); return { title, description }; }).filter((x) => x.title) };
    case 'campaign':
      return { heading: sec.heading || 'キャンペーン', title: sec.bullets[0] ?? sec.heading, description: sec.body, conditions: sec.bullets[1] ?? '', deadline: '', ...img };
    default:
      return null;
  }
}

export async function applySession(sessionId: string, userId: string, opts: { businessName: string; slug?: string; purpose?: 'business' | 'creator'; lineAddUrl?: string | null }) {
  const s = await prisma.pageIntelligenceSession.findUnique({ where: { id: sessionId } });
  if (!s || s.userId !== userId) throw new Error('セッションがありません');
  if (!s.selectedProposalId) throw new Error('先に構成案を選んでください');
  const p = await prisma.pageStructureSuggestion.findUnique({ where: { id: s.selectedProposalId } });
  if (!p) throw new Error('構成案がありません');
  const sections = p.sections as unknown as ProposalSection[];
  const sel = (s.selections ?? {}) as { images?: Record<string, string> };
  const picked = sel.images ?? {};
  const cands = await prisma.pageImageSuggestion.findMany({ where: { sessionId, proposalId: p.id }, select: { id: true, sectionId: true, source: true, uploadId: true, mimeType: true, width: true, height: true, altText: true, status: true, data: true } });
  const chosen = (sectionId: string) => {
    const id = picked[sectionId];
    if (id === 'none') return null;
    const c = id ? cands.find((x) => x.id === id) : cands.find((x) => x.sectionId === sectionId && (x.source === 'generated' || x.source === 'upload') && x.status !== 'rejected');
    return c && (c.data || c.uploadId) ? c : null;
  };

  const hero = sections.find((x) => x.id === 'hero');
  const strengthsSec = sections.find((x) => x.id === 'strengths');
  const vp = (s.valueProps ?? {}) as Record<string, string>;
  const strengths = (strengthsSec?.bullets?.length ? strengthsSec.bullets : (vp.strengths ?? '').split(/[、,\n/／]/).map((x) => x.trim()).filter(Boolean)).slice(0, 3);
  while (strengths.length < 3) strengths.push(['丁寧なカウンセリング', '分かりやすい料金', '通いやすい立地'][strengths.length]);
  const heroTitle = (hero?.heading || `${opts.businessName}へようこそ`).slice(0, 60);
  const toneStyle = TONES.find((t) => t.key === s.tone)?.style ?? null;
  const pb = await getPlaybook(s.industryKey, { wait: false }).catch(() => null);

  // ページの作成または更新
  let lpId = s.lpId;
  if (!lpId) {
    if (!opts.slug) throw new Error('公開用URLを指定してください');
    const lp = await prisma.landingPage.create({ data: {
      userId, businessName: opts.businessName, heroTitle, strengths, slug: opts.slug, siteType: 'lp', templateKey: toneStyle, industryKey: s.industryKey,
      purpose: opts.purpose ?? (/クリエイター|ハンドメイド/.test(s.industry) ? 'creator' : 'business'), lineAddUrl: opts.lineAddUrl ?? null,
      postsPlacement: sections.findIndex((x) => x.id === 'posts') >= 0 && sections.findIndex((x) => x.id === 'posts') <= 3 ? 'top' : 'bottom'
    } });
    lpId = lp.id;
  }
  const lp = await prisma.landingPage.findUnique({ where: { id: lpId } });
  if (!lp || lp.userId !== userId) throw new Error('ページが見つかりません');

  // デザイン: 型は雰囲気から、色はユーザー指定があればそれ、並びは選んだ案
  const input = { businessName: opts.businessName, heroTitle, strengths, description: [vp.services, vp.problems].filter(Boolean).join('。') || undefined };
  let design: Design;
  let designSource = 'preset';
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('no key');
    design = await withTimeout(designWithClaude(input, lp.templateKey ?? toneStyle, pb, { accent: lp.accent }), 60_000, 'デザイン');
    designSource = 'ai';
  } catch {
    design = presetDesign(input, lp.templateKey ?? toneStyle, pb, lp.accent);
  }
  const ctaLabel = hero?.cta?.label || design.copy?.ctaLabel || '';
  design.copy = { eyebrow: (design.copy?.eyebrow ?? '').slice(0, 20), subcopy: (hero?.body || design.copy?.subcopy || '').slice(0, 100), ctaLabel: ctaLabel.slice(0, 14), secondaryCtaLabel: design.copy?.secondaryCtaLabel ?? '', ...(design.copy?.strengthLabels ? { strengthLabels: design.copy.strengthLabels } : {}) };
  design.sectionOrder = sections.map((x) => x.id);

  // 画像: hero は LandingPage.heroImage、それ以外は sections[].content.image
  const heroPick = chosen('hero');
  let heroImage: { data: Buffer; mimeType: string } | null = null;
  if (heroPick) {
    if (heroPick.data) heroImage = { data: Buffer.from(heroPick.data), mimeType: heroPick.mimeType || 'image/jpeg' };
    else if (heroPick.uploadId) { const ph = await prisma.photo.findUnique({ where: { id: heroPick.uploadId }, select: { original: true, originalType: true } }); if (ph) heroImage = { data: Buffer.from(ph.original), mimeType: ph.originalType }; }
  }
  if (!heroImage && !lp.heroImage && (design.heroLayout === 'imageBackground' || design.heroLayout === 'fullBleed')) design.heroLayout = 'centered';

  const existing = Array.isArray(lp.sections) ? (lp.sections as StoredSection[]) : [];
  const featureIds = new Set(FEATURES.map((f) => f.id));
  const next: StoredSection[] = [];
  for (const sec of sections) {
    if (!featureIds.has(sec.id)) continue;
    const pick = chosen(sec.id);
    const imageUrl = pick ? { url: pick.data ? `/api/page-intelligence/images/${pick.id}` : `/api/page-intelligence/photos/${pick.uploadId}`, alt: pick.altText, width: pick.width, height: pick.height } : null;
    const prev = existing.find((e) => e.feature === sec.id);
    // 既にユーザーが作った内容があればそれを残し、画像だけ足す
    const content = prev ? { ...prev.content, ...(imageUrl ? { image: imageUrl } : {}) } : contentFor(sec, imageUrl);
    if (!content) continue;
    next.push({ feature: sec.id, content, inputs: prev?.inputs ?? {}, promptBy: prev?.promptBy ?? 'template', updatedAt: now() });
  }
  for (const e of existing) if (!next.some((n) => n.feature === e.feature)) next.push(e);

  await prisma.landingPage.update({ where: { id: lpId }, data: {
    heroTitle, strengths, industryKey: s.industryKey ?? lp.industryKey, templateKey: lp.templateKey ?? toneStyle,
    design: design as any, designSource, designStatus: 'ready', designUpdatedAt: new Date(),
    sections: next as any,
    postsEnabled: sections.some((x) => x.id === 'posts' || x.postsBlock) ? true : lp.postsEnabled,
    ...(heroImage ? { heroImage: heroImage.data, heroImageType: heroImage.mimeType } : {})
  } });
  await prisma.pageImageSuggestion.updateMany({ where: { id: { in: Object.values(picked).filter((v) => v !== 'none') } }, data: { status: 'applied' } });
  await prisma.pageStructureSuggestion.update({ where: { id: p.id }, data: { status: 'applied', landingPageId: lpId } });
  await prisma.pageIntelligenceSession.update({ where: { id: sessionId }, data: { lpId, status: 'applied', selections: { ...(s.selections as object ?? {}), businessName: opts.businessName, slug: lp.slug } as any } });
  await emit('page_intelligence.apply', 'page-intelligence', { sessionId, lpId, slug: lp.slug, proposal: p.name, images: Object.keys(picked).length, designSource });
  return { lpId, slug: lp.slug };
}

// ---- 6. 公開前チェック ----------------------------------------------------------------------------

export async function checkSession(sessionId: string) {
  const s = await prisma.pageIntelligenceSession.findUnique({ where: { id: sessionId } });
  if (!s) throw new Error('セッションがありません');
  const p = s.selectedProposalId ? await prisma.pageStructureSuggestion.findUnique({ where: { id: s.selectedProposalId } }) : null;
  const sections = (p?.sections as unknown as ProposalSection[] | undefined) ?? [];
  const cands = await prisma.pageImageSuggestion.findMany({ where: { sessionId, proposalId: p?.id ?? '' }, select: { sectionId: true, source: true, status: true, altText: true, aspectRatio: true } });
  const picked = ((s.selections as { images?: Record<string, string> } | null)?.images) ?? {};
  const pb = await getPlaybook(s.industryKey, { wait: false }).catch(() => null);
  const items: { key: string; label: string; ok: boolean; note: string }[] = [];

  const rec = pb?.recommendedFeatures.map((f) => f.id) ?? [];
  const missingRec = rec.filter((id) => !sections.some((x) => x.id === id));
  items.push({ key: 'industryFit', label: '業種適合性', ok: !!p && missingRec.length <= 1, note: p ? (missingRec.length ? `同業種の人気ページにある「${missingRec.map((id) => SECTION_NAMES[id as SectionId] ?? id).join('・')}」がありません` : `同業種（${pb?.label ?? s.industry}）の人気ページの要素を含んでいます`) : '構成案が未選択です' });

  const slots = sections.filter((x) => x.image);
  const unresolved = slots.filter((x) => { const id = picked[x.id]; if (id === 'none') return false; const c = cands.filter((c) => c.sectionId === x.id); return !c.some((c) => (c.source === 'generated' || c.source === 'upload') && c.status !== 'rejected'); });
  items.push({ key: 'imageRoles', label: '画像の役割', ok: unresolved.length === 0, note: slots.length ? (unresolved.length ? `${unresolved.map((x) => x.name).join('・')}の画像が未確定です（候補を生成するか、写真をアップロードするか、「画像なし」を選んでください）` : `${slots.length}か所すべてに役割・代替テキスト付きの画像があります`) : '画像を使わない構成です' });

  const heroCta = sections.find((x) => x.id === 'hero')?.cta?.label;
  const lastCta = sections[sections.length - 1]?.cta?.label;
  items.push({ key: 'ctaPlacement', label: 'CTA配置', ok: !!heroCta && !!lastCta, note: heroCta && lastCta ? `最初（${heroCta}）と最後（${lastCta}）にボタンがあり、スマホでは下部に追従します` : '最初か最後のボタンがありません' });

  const longHeading = sections.find((x) => x.heading.length > 32);
  const tooMany = sections.length > 9;
  items.push({ key: 'mobile', label: 'モバイル表示', ok: !longHeading && !tooMany, note: tooMany ? 'セクションが多すぎます（9個まで）' : longHeading ? `「${longHeading.heading}」は長く、スマホで3行を超えます` : '375px 基準で見出しとセクション数が適切です' });
  return items;
}

// ---- 7. プレビュー用の払い出し ----------------------------------------------------------------------

export async function previewPayload(token: string, proposalId?: string | null) {
  const s = await prisma.pageIntelligenceSession.findUnique({ where: { previewToken: token } });
  if (!s) return null;
  const p = proposalId ? await prisma.pageStructureSuggestion.findFirst({ where: { id: proposalId, sessionId: s.id } }) : s.selectedProposalId ? await prisma.pageStructureSuggestion.findUnique({ where: { id: s.selectedProposalId } }) : null;
  if (!p) return null;
  const sections = p.sections as unknown as ProposalSection[];
  const sel = (s.selections ?? {}) as { images?: Record<string, string>; businessName?: string };
  const cands = await prisma.pageImageSuggestion.findMany({ where: { sessionId: s.id, proposalId: p.id, source: { in: ['generated', 'upload'] } }, select: { id: true, sectionId: true, uploadId: true, altText: true, width: true, height: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  const pick = (id: string) => { const chosenId = sel.images?.[id]; if (chosenId === 'none') return null; return (chosenId ? cands.find((c) => c.id === chosenId) : cands.find((c) => c.sectionId === id)) ?? null; };
  const url = (c: { id: string; uploadId: string | null }) => (c.uploadId ? `/api/page-intelligence/photos/${c.uploadId}` : `/api/page-intelligence/images/${c.id}`);
  const vp = (s.valueProps ?? {}) as Record<string, string>;
  const hero = sections.find((x) => x.id === 'hero');
  const strengthsSec = sections.find((x) => x.id === 'strengths');
  const strengths = (strengthsSec?.bullets?.length ? strengthsSec.bullets : (vp.strengths ?? '').split(/[、,\n/／]/).map((x) => x.trim()).filter(Boolean)).slice(0, 3);
  const businessName = sel.businessName || s.industry;
  const toneStyle = TONES.find((t) => t.key === s.tone)?.style ?? null;
  const design = presetDesign({ businessName, heroTitle: hero?.heading || '', strengths }, toneStyle, null, null);
  design.copy = { eyebrow: '', subcopy: (hero?.body ?? '').slice(0, 100), ctaLabel: (hero?.cta?.label ?? '').slice(0, 14), secondaryCtaLabel: '' };
  design.sectionOrder = sections.map((x) => x.id);
  const heroPick = pick('hero');
  if (!heroPick && (design.heroLayout === 'imageBackground' || design.heroLayout === 'fullBleed')) design.heroLayout = 'centered';
  return {
    businessName, heroTitle: hero?.heading || businessName, strengths: strengths.length ? strengths : ['強み1', '強み2', '強み3'],
    purpose: /クリエイター|ハンドメイド/.test(s.industry) ? 'creator' : 'business', design,
    heroImageUrl: heroPick ? url(heroPick) : null,
    sections: sections.filter((x) => FEATURES.some((f) => f.id === x.id)).map((x) => { const c = pick(x.id); return { feature: x.id, content: contentFor(x, c ? { url: url(c), alt: c.altText, width: c.width, height: c.height } : null) }; }).filter((x) => x.content),
    postsIndex: sections.findIndex((x) => x.id === 'posts'),
    lineCta: sections.find((x) => x.id === 'line') ?? null
  };
}

export function publicSession(s: SessionRow & { proposals?: unknown[]; images?: unknown[] }) {
  const { previewToken, ...rest } = s;
  return { ...rest, previewToken };
}

export function toneStyleOf(tone: string | null | undefined) { return TONES.find((t) => t.key === tone)?.style ?? null; }
export { isHex };
