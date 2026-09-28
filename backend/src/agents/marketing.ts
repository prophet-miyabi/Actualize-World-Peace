import { generateText } from '../ai/text';
import type { Platform } from '../social/types';

// プラットフォームごとに特化したマーケティング担当エージェント。
// LPに登録済みの事実だけを使い、各SNSの流儀に合わせた投稿文を1本作る。
// 与えられていない実績・数字・限定オファーは書かせない（事実でない表示は景品表示法に触れるおそれがあるため）。
// 実際にSNSへ投稿するかどうかは、店主がダッシュボードで承認してから決める（このエージェントは下書きまで）。
// 生成にはCloudflare Workers AI（無料枠が大きい）を使い、高頻度・複数プラットフォーム分の実行に耐えられるようにする。

export const SNS_PLATFORMS = ['x', 'instagram', 'facebook', 'tiktok'] as const satisfies readonly Platform[];
export type SnsPlatform = (typeof SNS_PLATFORMS)[number];

const PLATFORM_STYLE: Record<SnsPlatform, string> = {
  x: 'Xへの投稿。140字程度で簡潔に。ハッシュタグは多くても2個まで。',
  instagram: 'Instagramのキャプション。世界観が伝わる文章にし、絵文字を効果的に使い、最後に関連ハッシュタグを3〜5個つける。',
  facebook: 'Facebookページの投稿。地域のお客様に語りかけるような、やや丁寧な文体で200字程度まで。',
  tiktok: 'TikTok動画のキャプション。冒頭に興味を引く一言、続けて内容を一言でまとめる短い文。ハッシュタグは1〜3個。'
};

export type MarketingInput = {
  businessName: string;
  heroTitle: string;
  strengths: string[];
  sections: { feature: string; content: unknown }[];
};

export async function draftForPlatform(platform: (typeof SNS_PLATFORMS)[number], input: MarketingInput): Promise<string> {
  const facts = [
    `事業名: ${input.businessName}`,
    `キャッチコピー: ${input.heroTitle}`,
    `強み: ${input.strengths.filter(Boolean).join(' / ')}`,
    ...input.sections.map((s) => `${s.feature}: ${JSON.stringify(s.content).slice(0, 300)}`)
  ].join('\n');

  const system =
    'あなたは中小事業者のSNS運用を手伝う、プラットフォームごとの専門マーケティング担当です。\n' +
    '与えられた事実だけを使って、投稿文を1本だけ作成してください。\n' +
    '与えられていない実績・数字・限定オファー・キャンペーン・日付は絶対に作らないでください（事実でない表示になるため）。\n' +
    `文体の指示: ${PLATFORM_STYLE[platform]}\n` +
    '出力は投稿文の本文のみとし、前置き・説明・見出し・考察・鍵括弧は一切含めないでください。';
  const user = `【事実】\n${facts}\n\n上記の事実だけを使って投稿文を作成してください。`;

  const raw = await generateText(system, user);
  // Qwen3は思考過程（<think>...</think>）を出力に含めることがあるため、念のため取り除く
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return cleaned.replace(/^["「]|["」]$/g, '').slice(0, 2000);
}
