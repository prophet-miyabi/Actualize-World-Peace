import prisma from '../prisma';
import { designWithClaude, generateHeroImage, presetDesign, reviewImageWithClaude, type Design } from './design';

const hasImageAi = () => !!((process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN) || process.env.GEMINI_API_KEY);

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

  let design: Design;
  let source = 'ai';
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      design = await designWithClaude(input, templateKey);
    } catch (e: any) {
      console.error('Claude design failed, using preset', lpId, e?.message);
      design = presetDesign(input, templateKey);
      source = 'preset';
    }
  } else {
    design = presetDesign(input, templateKey);
    source = 'preset';
  }

  // 画像生成AI（Cloudflare Workers AIを優先、なければGemini）が画像を作り、
  // Claudeが実際に画像を見て審査・配色を調整する。
  // 不合格なら指摘を添えて1回だけ作り直し、それでも不合格なら画像は使わない（質の低い画像を公開しない）。
  let image: { data: Buffer; mimeType: string } | null = null;
  if (hasImageAi()) {
    try {
      const first = await generateHeroImage(design.imagePrompt);
      if (!process.env.ANTHROPIC_API_KEY || source !== 'ai') {
        image = first;
      } else {
        const review = await reviewImageWithClaude(input, design, first, templateKey).catch((e) => {
          console.error('Claude review failed, accepting image as is', lpId, e?.message);
          return null;
        });
        if (!review || review.acceptable) {
          image = first;
          if (review) design = review.design;
        } else {
          console.log('Hero image rejected by review, regenerating once', lpId, review.issues);
          const second = await generateHeroImage(design.imagePrompt, review.issues);
          const review2 = await reviewImageWithClaude(input, design, second, templateKey).catch(() => null);
          if (review2?.acceptable) {
            image = second;
            design = review2.design;
          } else {
            console.log('Hero image rejected twice, publishing without image', lpId);
          }
        }
      }
    } catch (e: any) {
      console.error('Hero image generation failed, continuing without image', lpId, e?.message);
    }
  }

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
  templateKey?: string | null;
}>(lp: T) {
  const { heroImage, sections, ...rest } = lp;
  return {
    ...rest,
    design: (lp.design as Design | null) ?? presetDesign({ businessName: lp.businessName, heroTitle: lp.heroTitle, strengths: lp.strengths }, lp.templateKey),
    hasImage: !!heroImage,
    imageVersion: lp.designUpdatedAt ? lp.designUpdatedAt.getTime() : 0,
    sections: storedSections({ sections }).map(({ feature, content }) => ({ feature, content }))
  };
}
