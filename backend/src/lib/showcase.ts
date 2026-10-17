import prisma from '../prisma';
import { presetDesign, type Design } from '../ai/design';

// トップページのスマホ見本（9パターン）。AWPで作れるページの幅を、実際のページ部品で見せる。
// すべて架空の店・活動。評価・口コミ件数・利用者数のような実績の表示は入れない。
// 写真は管理画面の装飾画像（site-assets）に同じキーで生成したものを使い、無ければ写真なしで描く。

export type ShowcaseSample = {
  key: string;
  label: string;        // 画面下の説明（業種）
  styleKey: string;
  accent: string;
  businessName: string;
  heroTitle: string;
  strengths: string[];
  copy: { eyebrow: string; subcopy: string; ctaLabel: string; secondaryCtaLabel: string; strengthLabels: string[] };
  menu?: { name: string; price: string; description: string }[];
  imageKey: string;
};

export const SHOWCASE: ShowcaseSample[] = [
  {
    key: 'salon', label: '美容室', styleKey: 'editorial', accent: '#9a6b2f', businessName: 'Lumière',
    heroTitle: '毎朝の髪が、\n少しうれしくなる。',
    strengths: ['骨格と髪質に合わせた、扱いやすいカット', '髪へのやさしさにこだわった薬剤選び', 'ひとりひとりの時間を大切にする完全予約制'],
    copy: { eyebrow: '表参道のヘアサロン', subcopy: '骨格と髪質に合わせて、おうちでも再現しやすいスタイルを。', ctaLabel: 'WEB予約', secondaryCtaLabel: 'メニューを見る', strengthLabels: ['髪質に合わせる', 'やさしい薬剤', '完全予約制'] },
    menu: [{ name: 'Cut', price: '¥6,600', description: '' }, { name: 'Color', price: '¥8,800〜', description: '' }, { name: 'Treatment', price: '¥4,400', description: '' }],
    imageKey: 'mockup_salon_hero'
  },
  {
    key: 'cafe', label: 'カフェ', styleKey: 'warmTable', accent: '#b45309', businessName: 'コトノハ珈琲',
    heroTitle: '朝のひと息を、\nていねいに。',
    strengths: ['自家焙煎の豆を、毎朝ハンドドリップで', '季節の果物を使った焼き菓子', '一人でもゆっくり過ごせる窓際の席'],
    copy: { eyebrow: '鎌倉・自家焙煎のカフェ', subcopy: '豆の焙煎から一杯まで、店主がていねいに。', ctaLabel: 'メニューを見る', secondaryCtaLabel: 'アクセス', strengthLabels: ['自家焙煎', '季節の焼き菓子', '窓際の席'] },
    menu: [{ name: 'ドリップコーヒー', price: '¥550', description: '' }, { name: 'カフェラテ', price: '¥620', description: '' }, { name: '季節のタルト', price: '¥680', description: '' }],
    imageKey: 'showcase_cafe_hero'
  },
  {
    key: 'gym', label: 'パーソナルジム', styleKey: 'studio', accent: '#f59e0b', businessName: 'STUDIO KOA',
    heroTitle: '続けられる体づくりを、\nここから。',
    strengths: ['体力と目的に合わせた1対1のメニュー', '食事はアプリで毎日フィードバック', '駅から徒歩2分、22時まで'],
    copy: { eyebrow: '完全個室のパーソナルジム', subcopy: '無理な食事制限ではなく、続けられる習慣を一緒につくります。', ctaLabel: '体験を予約', secondaryCtaLabel: '料金を見る', strengthLabels: ['1対1のメニュー', '毎日の食事サポート', '駅徒歩2分'] },
    imageKey: 'showcase_gym_hero'
  },
  {
    key: 'clinic', label: '歯科医院', styleKey: 'clinic', accent: '#0284c7', businessName: 'ひまわり歯科',
    heroTitle: '痛みの少ない、\nやさしい歯科。',
    strengths: ['治療の前に、写真を見ながらていねいに説明', 'キッズスペースと女性歯科医師', '土曜も18時まで診療、WEB予約に対応'],
    copy: { eyebrow: '家族で通える歯科医院', subcopy: '「何をされるかわからない」をなくす、説明を大切にした診療です。', ctaLabel: 'WEB予約', secondaryCtaLabel: '診療案内', strengthLabels: ['説明をていねいに', 'キッズスペース', '土曜も診療'] },
    imageKey: 'showcase_clinic_hero'
  },
  {
    key: 'craft', label: '工房・物販', styleKey: 'stage', accent: '#44403c', businessName: 'tsumugi 工房',
    heroTitle: '手に馴染む、\n毎日の器。',
    strengths: ['ひとつひとつ手びねりで成形', '電子レンジ・食洗機で使える釉薬', 'オンラインでも、工房でも買える'],
    copy: { eyebrow: '益子の陶芸工房', subcopy: '飾るためではなく、毎日使うための器を作っています。', ctaLabel: 'オンラインショップ', secondaryCtaLabel: '工房について', strengthLabels: ['手びねり', '毎日使える', '工房でも買える'] },
    menu: [{ name: 'マグカップ', price: '¥3,300', description: '' }, { name: '6寸皿', price: '¥2,860', description: '' }, { name: '飯碗', price: '¥2,420', description: '' }],
    imageKey: 'showcase_craft_hero'
  },
  {
    key: 'photo', label: 'フォトグラファー', styleKey: 'gallery', accent: '#e11d48', businessName: 'Rin Photography',
    heroTitle: '一瞬を、\nずっと残す。',
    strengths: ['家族写真・ウェディング・プロフィール撮影', '自然光を活かしたロケーション撮影', '撮影から2週間でデータ納品'],
    copy: { eyebrow: '出張撮影 / 東京・神奈川', subcopy: '肩の力を抜いた、その人らしい表情を撮ります。', ctaLabel: '撮影を相談', secondaryCtaLabel: '作品を見る', strengthLabels: ['家族・結婚式・プロフィール', '自然光のロケ撮影', '2週間で納品'] },
    imageKey: 'showcase_photo_hero'
  },
  {
    key: 'consult', label: '税理士事務所', styleKey: 'corporate', accent: '#1e3a8a', businessName: '山田税理士事務所',
    heroTitle: '数字の不安を、\n相談できる安心に。',
    strengths: ['個人事業主と小さな会社の記帳・申告を専門に', 'チャットでいつでも質問できる', '初回相談は無料、料金は事前にお見積もり'],
    copy: { eyebrow: '小さな会社のための税理士', subcopy: '帳簿づけから申告まで、わかる言葉で伴走します。', ctaLabel: '無料相談を申し込む', secondaryCtaLabel: '料金を見る', strengthLabels: ['小規模事業の専門', 'チャットで質問', '料金は事前見積もり'] },
    imageKey: 'showcase_consult_hero'
  },
  {
    key: 'kids', label: '子ども英語教室', styleKey: 'soft', accent: '#f472b6', businessName: 'にじいろ英語教室',
    heroTitle: '英語が「すき」に\n変わる場所。',
    strengths: ['歌と絵本で、耳から自然に', '少人数クラス（最大6人）', '保護者向けに毎回レッスンの様子を共有'],
    copy: { eyebrow: '3歳〜小学生の英語教室', subcopy: '「勉強」になる前に、英語を楽しい時間にします。', ctaLabel: '体験レッスン', secondaryCtaLabel: 'クラスを見る', strengthLabels: ['歌と絵本', '少人数クラス', 'ようすを共有'] },
    imageKey: 'showcase_kids_hero'
  },
  {
    key: 'tech', label: '業務サービス', styleKey: 'glass', accent: '#7c3aed', businessName: 'Nexo Works',
    heroTitle: '小さな会社の業務を、\nまとめてかんたんに。',
    strengths: ['請求・在庫・予約をひとつの画面で', '導入から運用まで担当者が伴走', '月額制、いつでも解約できる'],
    copy: { eyebrow: '中小企業向けの業務ツール', subcopy: 'バラバラの作業を、ひとつの流れに。', ctaLabel: '無料で試す', secondaryCtaLabel: '機能を見る', strengthLabels: ['ひとつの画面', '担当者が伴走', 'いつでも解約'] },
    imageKey: 'showcase_tech_hero'
  }
];

let cache: { at: number; data: unknown } | null = null;

export async function showcasePayload(base: string) {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.data;
  const keys = SHOWCASE.map((s) => s.imageKey);
  const assets = await prisma.siteAsset.findMany({ where: { key: { in: keys } }, select: { key: true, updatedAt: true } }).catch(() => []);
  const assetAt = new Map(assets.map((a) => [a.key, a.updatedAt.getTime()]));
  const data = SHOWCASE.map((s) => {
    const design: Design = presetDesign({ businessName: s.businessName, heroTitle: s.heroTitle, strengths: s.strengths }, s.styleKey, null, s.accent);
    design.copy = s.copy;
    const v = assetAt.get(s.imageKey);
    return {
      key: s.key, label: s.label,
      lp: {
        slug: `showcase-${s.key}`, businessName: s.businessName, heroTitle: s.heroTitle, strengths: s.strengths, socialProof: null, scarcityOffer: null,
        design, hasImage: !!v, imageVersion: v ?? 0, lineAddUrl: 'https://lin.ee/showcase', purpose: 'business',
        sections: s.menu ? [{ feature: 'menu', content: { heading: 'メニュー・料金', intro: '', items: s.menu, note: '' } }] : []
      },
      imageUrl: v ? `${base}/api/site-assets/${s.imageKey}?v=${v}` : null
    };
  });
  cache = { at: Date.now(), data };
  return data;
}
