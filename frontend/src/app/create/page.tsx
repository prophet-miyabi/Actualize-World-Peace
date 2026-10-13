'use client';
import Link from 'next/link';

// 「作る」: いま何を作るかを1画面で選ぶ。最初の一歩を小さく、ゴールまでの距離を見せる
const OPTIONS: { href: string; emoji: string; title: string; desc: string; time: string; primary?: boolean }[] = [
  { href: '/builder', emoji: '💬', title: 'AIとおしゃべりしてページを作る', desc: '質問に答えるだけ。確定した情報だけがページに載る', time: '約5分', primary: true },
  { href: '/wizard', emoji: '✨', title: '4ステップでページを作る', desc: 'お店・活動の名前から。見た目はAIが用意、あなたが仕上げる', time: '約3分' },
  { href: '/feed', emoji: '📝', title: 'タイムラインに投稿する', desc: '新作・お知らせ・日々のこと。写真も1枚つけられる', time: '30秒' },
  { href: '/products', emoji: '🛍️', title: '商品を並べる', desc: 'ページに商品を出して、手数料0円で直接売る', time: '約3分' },
  { href: '/bookings', emoji: '🗓️', title: '予約を受け付ける', desc: 'メニューを決めるだけ。確定はあなたが押したときだけ', time: '約2分' },
  { href: '/profile', emoji: '🪪', title: 'プロフィールを整える', desc: 'ユーザー名・自己紹介・リンク。フォローしてもらう名刺に', time: '約2分' }
];

export default function CreatePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-sky-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 pt-5 pb-10">
        <h1 className="text-2xl font-black">作る</h1>
        <p className="text-sm text-gray-600 mt-1">どれも無料。途中でやめても、戻って続きから作れます。</p>
        <ul className="mt-4 space-y-3">
          {OPTIONS.map((o) => (
            <li key={o.href}>
              <Link href={o.href} className={`flex items-center gap-4 rounded-2xl p-4 border-2 ${o.primary ? 'bg-white border-violet-300 shadow-md' : 'bg-white border-gray-100'}`}>
                <span className="text-3xl" aria-hidden>{o.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-sm">{o.title}{o.primary && <span className="ml-2 text-[10px] bg-violet-600 text-white rounded-full px-2 py-0.5">おすすめ</span>}</span>
                  <span className="block text-xs text-gray-500 mt-0.5">{o.desc}</span>
                </span>
                <span className="shrink-0 text-[11px] font-bold text-violet-700">{o.time}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
