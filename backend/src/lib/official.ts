import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../prisma';

// AWP 公式アカウント: プロフィール（/awp-official）、公式ページ（/awp）、最初の投稿（リール＋文章＋画像）。
// 起動時に無ければ作る。本番の intelligence が止まっていても作れるよう、デザインはプリセット、素材は同梱のファイルを使う。
// 事実でない数字・実績は書かない（会社の決まり）
export const OFFICIAL_EMAIL = 'official@awp.local';
export const OFFICIAL_USERNAME = 'awp-official';
export const OFFICIAL_SLUG = 'awp';

const ASSETS = path.join(__dirname, '..', '..', 'assets', 'official');
const asset = (name: string): Buffer | null => {
  try { return fs.readFileSync(path.join(ASSETS, name)); } catch { return null; }
};
const frontendUrl = () => (process.env.FRONTEND_URL || process.env.SITE_URL || 'https://awp-frontend-bf17.onrender.com').replace(/\/$/, '');

// 公式ページの「よくある質問」。AWP チャットボットはページの情報だけで答えるので、ここに事実を書いておく
const OFFICIAL_SECTIONS = [
  {
    feature: 'faq', promptBy: 'system', updatedAt: new Date().toISOString(),
    content: {
      heading: 'よくある質問',
      items: [
        { question: 'AWPは無料ですか？', answer: 'はい。ページの作成・公開・SNS（投稿・フォロー）・ショップ（手数料0円）はずっと無料です。有料プランは、自分のドメインで公開したい人と、intelligence にもっと任せたい人のためのものです。' },
        { question: '自分のドメイン（独自ドメイン）で公開できますか？', answer: 'できます。AWP の提携リンクから取得したドメインなら無料、それ以外のドメインは有料プラン（ライト以上）で公開できます。設定は「独自ドメイン」の画面から3ステップです。' },
        { question: 'ページはどうやって作りますか？', answer: '「作る」から、AWPとチャットして作る（質問に答えるだけ）か、4ステップで作る、のどちらかを選びます。文章とデザインは AWP が用意し、仕上げはあなたの手で行います。公開まで無料です。' },
        { question: 'ショップの手数料はかかりますか？', answer: 'かかりません。AWP のショップは手数料0円で、お客さまからの代金はあなたの口座に直接振り込まれます（AWP は代金を預かりません）。販売には特定商取引法に基づく表記が必要で、ショップの設定画面で入力できます。' },
        { question: '投稿はどこに表示されますか？', answer: 'タイムライン、あなたのプロフィール、そしてあなたのページの「最新の投稿」に自動で表示されます。リール（動画）も、文章＋写真も投稿できます。' },
        { question: '有料プランの支払い方法は？', answer: '銀行振込か、AWP のキャッシュです。決済会社を通さないため決済手数料はかかりません。自動更新はなく、やめたいときは何もしなくて大丈夫です。' },
        { question: 'お問い合わせはどこから？', answer: 'このページの「予約をリクエスト」や投稿への返信からどうぞ。利用規約・プライバシーポリシーは画面下部のリンクから読めます。' }
      ]
    }
  }
];

export async function seedOfficial() {
  // 1. アカウント
  let user = await prisma.user.findUnique({ where: { email: OFFICIAL_EMAIL } });
  if (!user) {
    const taken = await prisma.user.findUnique({ where: { username: OFFICIAL_USERNAME }, select: { id: true } });
    user = await prisma.user.create({
      data: {
        email: OFFICIAL_EMAIL, name: 'AWP 公式', username: taken ? null : OFFICIAL_USERNAME,
        bio: 'AWP（Actualize World Peace）の公式アカウント。\nやりたいことを、スマホひとつで世界へ。ページの作成・公開・SNS・ショップはずっと無料。\n新しい機能やお知らせをここで投稿します。',
        category: 'other', region: '日本',
        links: [{ label: 'AWP 公式ページ', url: `${frontendUrl()}/${OFFICIAL_SLUG}` }, { label: 'みんなのページを見る', url: `${frontendUrl()}/discover` }],
        password: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10)
      }
    });
  }

  // 2. 公式ページ（LP）。デザインはプリセット、メイン画像は同梱の素材
  let lp = await prisma.landingPage.findUnique({ where: { slug: OFFICIAL_SLUG } });
  // 公式ページでは AWP チャットボット（ページの情報だけで答える受付）を常にオンにする。訪問者が AWP について質問できる
  if (lp && !lp.chatbotEnabled) lp = await prisma.landingPage.update({ where: { id: lp.id }, data: { chatbotEnabled: true } });
  // よくある質問が無ければ足す（チャットボットの知識にもなる）
  if (lp && !(Array.isArray(lp.sections) && (lp.sections as any[]).some((x) => x?.feature === 'faq'))) {
    lp = await prisma.landingPage.update({ where: { id: lp.id }, data: { sections: [...((Array.isArray(lp.sections) ? lp.sections : []) as any[]), ...OFFICIAL_SECTIONS] as any } });
  }
  if (!lp) {
    const hero = asset('hero.jpg');
    lp = await prisma.landingPage.create({
      data: {
        userId: user.id, slug: OFFICIAL_SLUG, businessName: 'AWP', purpose: 'business', siteType: 'lp', templateKey: 'bold',
        heroTitle: 'やりたいことを、スマホひとつで世界へ。',
        strengths: [
          'ページの作成・公開・SNS・ショップは、ずっと無料',
          '質問に答えるだけで文章とデザインが整い、仕上げはあなたの手で',
          '予約・商品・チャット受付は、必要になったときに自分で足せる'
        ],
        design: undefined, designSource: 'preset', designStatus: 'ready', designUpdatedAt: new Date(),
        heroImage: hero ?? undefined, heroImageType: hero ? 'image/jpeg' : undefined,
        postsEnabled: true, chatbotEnabled: true, sections: OFFICIAL_SECTIONS as any
      }
    });
  }

  // 3. 最初の投稿（既に投稿があれば何もしない）
  const count = await prisma.post.count({ where: { userId: user.id } });
  if (count > 0) return { user, lp, created: 0 };
  const base = Date.now() - 4 * 60_000;
  const items: { body: string; image?: string; video?: string; kind?: 'post' | 'reel' }[] = [
    { body: 'AWP 公式アカウントです。\nここは、やりたいことを自分の手で形にして、世界へ届ける場所。お店も、作品も、あなた自身も。\nまずは「作る」から、あなたの居場所を作ってみてください。公開まで無料です。', image: 'post-welcome.jpg' },
    { body: 'AWP、はじまります。\nやりたいことを、スマホひとつで世界へ。ページ・SNS・予約・ショップ、ずっと無料。', video: 'reel-intro.mp4', kind: 'reel' },
    { body: 'AWPのショップは手数料0円。\nお客さまからの代金は、あなたの口座に直接振り込まれます（AWPは代金を預かりません）。商品を並べる前に、ショップの設定で「特定商取引法に基づく表記」を整えてください。', image: 'post-shop.jpg' },
    { body: '投稿した内容は、あなたのページの「最新の投稿」に自動で載ります。\nリール（動画）も、文章＋写真も。投稿するたびにページが更新され、見た人はそこからあなたのページへ飛べます。' }
  ];
  let created = 0;
  for (const [i, it] of items.entries()) {
    const image = it.image ? asset(it.image) : null;
    const video = it.video ? asset(it.video) : null;
    if ((it.image && !image) || (it.video && !video)) continue; // 素材が無ければ飛ばす
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
