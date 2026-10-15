import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../prisma';

// 運営が AWP 上に置く「ブランドのアカウント」を起動時に投入する共通処理。
// 公式アカウント（official.ts）と同じ考え方で、プロフィール・ページ・最初の投稿・ページのリンク/予約をまとめて作る。
// 事実でない数字・実績は書かない。素材は backend/assets/<dir> に同梱する
export type BrandDef = {
  key: string;                 // 素材のフォルダ名
  email: string;
  username: string;
  name: string;
  bio: string;
  category: 'business' | 'creator' | 'other';
  region?: string;
  links: { label: string; url: string }[];
  page: {
    slug: string;
    businessName: string;
    heroTitle: string;
    strengths: string[];
    templateKey: string;
    purpose?: 'business' | 'creator';
    heroAsset?: string;
    tools?: { label: string; url: string }[];
    booking?: { menus: { name: string; note?: string }[]; note?: string; leadDays?: number; maxDays?: number };
  };
  posts: { body: string; image?: string; video?: string; kind?: 'post' | 'reel' }[];
};

const assetOf = (dir: string, name: string): Buffer | null => {
  try { return fs.readFileSync(path.join(__dirname, '..', '..', 'assets', dir, name)); } catch { return null; }
};

export async function seedBrandAccount(def: BrandDef) {
  let user = await prisma.user.findUnique({ where: { email: def.email } });
  if (!user) {
    const taken = await prisma.user.findUnique({ where: { username: def.username }, select: { id: true } });
    user = await prisma.user.create({
      data: {
        email: def.email, name: def.name, username: taken ? null : def.username, bio: def.bio, category: def.category, region: def.region ?? null,
        links: def.links, password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)
      }
    });
  }

  let lp = await prisma.landingPage.findUnique({ where: { slug: def.page.slug } });
  if (!lp) {
    const hero = def.page.heroAsset ? assetOf(def.key, def.page.heroAsset) : null;
    lp = await prisma.landingPage.create({
      data: {
        userId: user.id, slug: def.page.slug, businessName: def.page.businessName, purpose: def.page.purpose ?? 'business', siteType: 'lp', templateKey: def.page.templateKey,
        heroTitle: def.page.heroTitle, strengths: def.page.strengths,
        designSource: 'preset', designStatus: 'ready', designUpdatedAt: new Date(),
        heroImage: hero ?? undefined, heroImageType: hero ? 'image/jpeg' : undefined,
        postsEnabled: true, chatbotEnabled: false,
        bookingEnabled: !!def.page.booking,
        bookingConfig: def.page.booking ? { menus: def.page.booking.menus, note: def.page.booking.note ?? '', leadDays: def.page.booking.leadDays ?? 1, maxDays: def.page.booking.maxDays ?? 60 } : undefined,
        tools: def.page.tools?.length ? { create: def.page.tools.map((t, i) => ({ toolKey: `brand:${def.key}:${i}`, label: t.label, url: t.url, display: 'button', sortOrder: i })) } : undefined
      }
    });
  }

  const count = await prisma.post.count({ where: { userId: user.id } });
  if (count > 0) return { user, lp, created: 0 };
  const base = Date.now() - def.posts.length * 60_000;
  let created = 0;
  for (const [i, it] of def.posts.entries()) {
    const image = it.image ? assetOf(def.key, it.image) : null;
    const video = it.video ? assetOf(def.key, it.video) : null;
    if ((it.image && !image) || (it.video && !video)) continue;
    await prisma.post.create({
      data: {
        userId: user.id, body: it.body, kind: it.kind ?? 'post', createdAt: new Date(base + i * 60_000),
        image: image ?? undefined, imageType: image ? 'image/jpeg' : undefined,
        video: video ?? undefined, videoType: video ? 'video/mp4' : undefined, videoSize: video ? video.length : undefined
      }
    });
    created++;
  }
  return { user, lp, created };
}

const frontendUrl = () => (process.env.FRONTEND_URL || process.env.SITE_URL || 'https://awp-frontend-bf17.onrender.com').replace(/\/$/, '');

// ---- URARA コンパニオン（宴会向けコンパニオン派遣のアプリ） ----
// 数字・受付時間は URARA アプリの表示と料金ルール（packages/pricing）から。電話番号・対応エリアはアプリ側で案内するため載せない
export const URARA: BrandDef = {
  key: 'urara',
  email: 'urara@awp.local',
  username: 'urara-official',
  name: 'URARA コンパニオン',
  bio: '宴会を、もっと華やかに。\nURARA は、ご希望の場所へコンパニオンを手配できる予約アプリです。アプリから日時と人数を選ぶだけ。受付時間 10:00〜24:00（年中無休）。',
  category: 'business',
  links: [
    { label: 'URARA アプリで予約する', url: 'https://urara-app.onrender.com' },
    { label: 'URARA のページ（AWP）', url: `${frontendUrl()}/urara` }
  ],
  page: {
    slug: 'urara',
    businessName: 'URARA',
    heroTitle: '宴会を、もっと華やかに。',
    strengths: [
      'ご希望の場所へ、アプリからかんたん予約',
      '1名・2時間 13,200円（税込）。延長は1時間・1名 6,600円',
      '受付時間 10:00〜24:00、年中無休'
    ],
    templateKey: 'elegant',
    heroAsset: 'hero.jpg',
    tools: [{ label: 'URARA アプリで予約する', url: 'https://urara-app.onrender.com' }],
    booking: {
      menus: [
        { name: 'コンパニオン派遣（1名・2時間）', note: '13,200円（税込）。延長 1時間・1名 6,600円' },
        { name: '複数名・長時間のご相談', note: 'ご希望の人数・時間をメモに' }
      ],
      note: 'ここからのリクエストは URARA が確認し、確定とお支払いの詳細は URARA アプリ・メールでご案内します。',
      leadDays: 1, maxDays: 60
    }
  },
  posts: [
    { body: 'URARA コンパニオンです。\n宴会を、もっと華やかに。ご希望の場所へ、アプリからかんたんに予約できます。\n受付時間は 10:00〜24:00、年中無休。', image: 'post-dinner.jpg' },
    { body: '宴会を、もっと華やかに。\nURARA コンパニオン — ご希望の場所へ、かんたん予約。', video: 'reel-urara.mp4', kind: 'reel' },
    { body: '料金のご案内\n・1名・2時間 13,200円（税込）\n・延長 1時間・1名 6,600円\n・当日キャンセルは 1名あたり 13,200円\n人数・時間を選ぶと、アプリで合計金額がその場で分かります。', image: 'post-price.jpg' },
    { body: '初めての方へ\nアプリで「新しく予約する」→ 日時・場所・人数を選ぶ → 確定のご連絡、の3ステップです。お困りのときはアプリ内のお電話からもご相談いただけます。' }
  ]
};
