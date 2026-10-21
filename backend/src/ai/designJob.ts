import prisma from '../prisma';
import { Prisma } from '@prisma/client';
import { describeUsedCombos, designWithClaude, generateHeroImage, presetDesign, reviewImageWithClaude, type Design } from './design';
import { classifyIndustry, getPlaybook, type Playbook } from './playbook';

const hasImageAi = () => !!(process.env.RUNWAYML_API_SECRET || (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) || process.env.GEMINI_API_KEY);

// 生成中のまま止まった場合（サーバー再起動など）に、再実行できるようにする時間
const STALE_MS = 3 * 60 * 1000;

export function isGenerating(lp: { designStatus: string | null; designUpdatedAt: Date | null }) {
  return lp.designStatus === 'generating' && !!lp.designUpdatedAt && Date.now() - lp.designUpdatedAt.getTime() < STALE_MS;
}

// LPのデザインを作成（または作り直し）する。時間がかかるため、呼び出し側は待たずに実行する。
// どの段階で失敗しても、最終的にはプリセットのデザインで「完成」状態にする。
export async function runDesignJob(lpId: string, description?: string) {
  const lp = await prisma.landingPage.findUnique({ where: { id: lpId } });
  if (!lp) return;
  await prisma.landingPage.update({
    where: { id: lpId },
    data: { designStatus: 'generating', designUpdatedAt: new Date() }
  });

  const input = { businessName: lp.businessName, heroTitle: lp.heroTitle, strengths: lp.strengths, description };
  const templateKey = lp.templateKey;

  // 業種を判定し、同業種の人気ページの手本（構成・見せ方・文言の型）を取り出す。
  // 手本が未作成の業種は、ここで作る（最初の1人だけ時間がかかり、以後は全ユーザーで共有される）
  let playbook: Playbook | null = null;
  try {
    let industryKey = lp.industryKey;
    if (!industryKey) {
      industryKey = await classifyIndustry([lp.businessName, lp.heroTitle, description ?? '', ...lp.strengths].join(' '));
      await prisma.landingPage.update({ where: { id: lpId }, data: { industryKey } });
    }
    playbook = await getPlaybook(industryKey, { wait: true });
  } catch (e: any) {
    console.error('playbook lookup failed, designing without it', lpId, e?.message);
  }

  // 似たページだらけにならないように、最近のページの「型×色×書体」の偏りを AWP に伝える
  const recent = await prisma.landingPage.findMany({
    where: { design: { not: Prisma.DbNull }, id: { not: lpId } }, orderBy: { createdAt: 'desc' }, take: 200, select: { design: true }
  }).catch(() => [] as { design: unknown }[]);
  const avoid = describeUsedCombos(recent.map((r) => r.design));

  let design: Design;
  let source = 'ai';
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      design = await designWithClaude(input, templateKey, playbook, { accent: lp.accent, avoid });
    } catch (e: any) {
      console.error('Claude design failed, using preset', lpId, e?.message);
      design = presetDesign(input, templateKey, playbook, lp.accent);
      source = 'preset';
    }
  } else {
    design = presetDesign(input, templateKey, playbook, lp.accent);
    source = 'preset';
  }

  // 画像生成 intelligence（Cloudflare Workers AWPを優先、なければGemini）が画像を作り、
  // Claudeが実際に画像を見て審査・配色を調整する。
  // 不合格なら指摘を添えて1回だけ作り直し、それでも不合格なら画像は使わない（質の低い画像を公開しない）。
  let image: { data: Buffer; mimeType: string } | null = null;
  if (hasImageAi()) {
    try {
      const first = await generateHeroImage(design.imagePrompt);
      if (!process.env.ANTHROPIC_API_KEY || source !== 'ai') {
        image = first;
      } else {
        const review = await reviewImageWithClaude(input, design, first, templateKey, !!lp.accent).catch((e) => {
          console.error('Claude review failed, accepting image as is', lpId, e?.message);
          return null;
        });
        if (!review || review.acceptable) {
          image = first;
          if (review) design = { ...review.design, copy: design.copy, sectionOrder: design.sectionOrder };
        } else {
          console.log('Hero image rejected by review, regenerating once', lpId, review.issues);
          const second = await generateHeroImage(design.imagePrompt, review.issues);
          const review2 = await reviewImageWithClaude(input, design, second, templateKey, !!lp.accent).catch(() => null);
          if (review2?.acceptable) {
            image = second;
            design = { ...review2.design, copy: design.copy, sectionOrder: design.sectionOrder };
          } else {
            console.log('Hero image rejected twice, publishing without image', lpId);
          }
        }
      }
    } catch (e: any) {
      console.error('Hero image generation failed, continuing without image', lpId, e?.message);
    }
  }

  // 写真が無いのに「写真全面に文字を重ねる」レイアウトだと、単色の背景に文字だけの貧相な見た目になる。
  // 画像が用意できなかった（今回も前回も無い）場合は、写真なしでも成立するレイアウトに切り替える
  if (!image && !lp.heroImage && (design.heroLayout === 'imageBackground' || design.heroLayout === 'fullBleed')) design.heroLayout = 'centered';

  await prisma.landingPage.update({
    where: { id: lpId },
    data: {
      design: design as any,
      designSource: source,
      designStatus: 'ready',
      designUpdatedAt: new Date(),
      // 画像の生成に失敗した場合は、前回の画像を残す（消さない）
      ...(image ? { heroImage: image.data, heroImageType: image.mimeType } : {})
    }
  });
}

export type StoredSection = {
  feature: string;
  content: Record<string, unknown>;
  inputs: Record<string, string>;
  promptBy: 'gemini' | 'template';
  updatedAt: string;
};

export function storedSections(lp: { sections: unknown }): StoredSection[] {
  return Array.isArray(lp.sections) ? (lp.sections as StoredSection[]) : [];
}

// 公開ページ用: 画像のバイナリと店主の回答（inputs）は含めず、デザインが未作成ならプリセットを付けて返す
export function publicLp<T extends {
  slug: string; businessName: string; heroTitle: string; strengths: string[];
  design: unknown; heroImage: Uint8Array | null; designUpdatedAt: Date | null; sections: unknown;
  templateKey?: string | null; accent?: string | null;
}>(lp: T) {
  const { heroImage, sections, ...rest } = lp;
  const design = (lp.design as Design | null) ?? presetDesign({ businessName: lp.businessName, heroTitle: lp.heroTitle, strengths: lp.strengths }, lp.templateKey, null, lp.accent ?? null);
  return {
    ...rest,
    design,
    hasImage: !!heroImage,
    imageVersion: lp.designUpdatedAt ? lp.designUpdatedAt.getTime() : 0,
    sections: orderSections(storedSections({ sections }), design.sectionOrder).map(({ feature, content }) => ({ feature, content }))
  };
}

// 同業種の人気ページの並び（design.sectionOrder）に合わせてセクションを並べ替える。並びに無いものは元の順で後ろに
export function orderSections<T extends { feature: string }>(sections: T[], order?: string[] | null): T[] {
  if (!order?.length) return sections;
  const rank = (f: string) => { const i = order.indexOf(f); return i < 0 ? 1000 : i; };
  return [...sections].sort((a, b) => rank(a.feature) - rank(b.feature));
}
