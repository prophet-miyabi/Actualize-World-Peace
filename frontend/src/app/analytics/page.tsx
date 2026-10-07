'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';

type Data = {
  page: { id: string; slug: string; businessName: string; monetizationEnabled: boolean } | null;
  totals: { views: number; likes: number; followers: number; prClicks: number };
  days: { date: string; views: number }[];
  clicks: { tool: number; line: number; sns: number; ad: number };
  sources: { source: string; views: number }[];
};

const CLICK_LABEL: Record<keyof Data['clicks'], string> = { tool: '予約・ショップなど', line: 'LINE', sns: 'SNS', ad: 'PR枠' };

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-gray-400">読み込み中…</main>}>
      <Analytics />
    </Suspense>
  );
}

// アクセス解析: 直近30日の閲覧・クリック・流入元。どこから来て、何を押したかがひと目でわかる
function Analytics() {
  const lpId = useSearchParams()?.get('lp') || '';
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [bot, setBot] = useState<{ enabled: boolean; questions: { id: string; question: string; answered: boolean; createdAt: string }[] } | null>(null);

  useEffect(() => {
    const params = lpId ? { lpId } : {};
    api.get('/community/me/analytics', { params }).then((r) => setD(r.data)).catch(() => setError('読み込めませんでした。'));
    api.get('/chatbot/mine/settings', { params }).then((r) => r.data.page && setBot({ enabled: r.data.page.chatbotEnabled, questions: r.data.questions })).catch(() => {});
  }, [lpId]);

  const toggleBot = async () => {
    if (!d?.page || !bot) return;
    const { data } = await api.put('/chatbot/mine/settings', { lpId: d.page.id, enabled: !bot.enabled });
    setBot({ ...bot, enabled: data.page.chatbotEnabled });
  };

  if (!d) return <main className="p-6 text-sm text-gray-400">{error || '読み込み中…'}</main>;
  if (!d.page) {
    return (
      <main className="p-6 text-sm text-gray-600">
        まだページがありません。<Link href="/builder" className="text-violet-700 underline">ページをつくる</Link>
      </main>
    );
  }

  const max = Math.max(1, ...d.days.map((x) => x.views));
  const clickTotal = Object.values(d.clicks).reduce((a, b) => a + b, 0);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <Link href={`/dashboard${lpId ? `?lp=${encodeURIComponent(lpId)}` : ''}`} className="text-sm text-violet-700 font-bold">← ホーム</Link>
        <div>
          <h1 className="text-2xl font-black">アクセス解析</h1>
          <p className="text-xs text-gray-500 mt-1">{d.page.businessName}（/{d.page.slug}）・直近30日</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            ['閲覧', d.totals.views, '👀'],
            ['リンクのクリック', clickTotal, '👆'],
            ['いいね（累計）', d.totals.likes, '♥'],
            ['フォロワー', d.totals.followers, '🙌']
          ].map(([label, v, icon]) => (
            <div key={label as string} className="bg-white border rounded-2xl p-4">
              <p className="text-[11px] text-gray-500"><span aria-hidden>{icon}</span> {label}</p>
              <p className="text-2xl font-black mt-1">{(v as number).toLocaleString('ja-JP')}</p>
            </div>
          ))}
        </div>

        <section className="bg-white border rounded-2xl p-4">
          <h2 className="font-bold text-sm">毎日の閲覧</h2>
          <div className="mt-3 flex items-end gap-[3px] h-32" role="img" aria-label="直近30日の閲覧数のグラフ">
            {d.days.map((x) => (
              <div key={x.date} className="flex-1 flex flex-col justify-end h-full" title={`${x.date}: ${x.views}`}>
                <div className="rounded-t bg-gradient-to-t from-violet-500 to-fuchsia-400" style={{ height: `${(x.views / max) * 100}%`, minHeight: x.views ? 3 : 1, opacity: x.views ? 1 : 0.2 }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
            <span>{d.days[0].date.slice(5).replace('-', '/')}</span>
            <span>今日</span>
          </div>
        </section>

        <section className="bg-white border rounded-2xl p-4">
          <h2 className="font-bold text-sm">押されたリンク</h2>
          <ul className="mt-2 space-y-2">
            {(Object.keys(d.clicks) as (keyof Data['clicks'])[]).filter((k) => k !== 'ad' || d.page!.monetizationEnabled).map((k) => (
              <li key={k} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 text-gray-600">{CLICK_LABEL[k]}</span>
                <span className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <span className="block h-full bg-sky-400" style={{ width: `${clickTotal ? (d.clicks[k] / clickTotal) * 100 : 0}%` }} />
                </span>
                <span className="w-10 text-right font-bold">{d.clicks[k]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-white border rounded-2xl p-4">
          <h2 className="font-bold text-sm">どこから来た？</h2>
          {d.sources.length === 0 ? <p className="text-sm text-gray-400 mt-2">まだデータがありません</p> : (
            <ul className="mt-2 divide-y text-sm">
              {d.sources.map((s) => (
                <li key={s.source} className="py-2 flex justify-between gap-3">
                  <span className="truncate">{s.source}</span>
                  <span className="font-bold shrink-0">{s.views}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-gray-400 mt-2">SNSのプロフィールにページのURLを貼ると、ここに表示されるよ</p>
        </section>

        {bot && (
          <section id="chatbot" className="bg-white border rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-sm">💬 AIチャットボット</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">ページの情報だけを使って、訪問者の質問に24時間答えるよ。わからないことは推測せず、問い合わせ方法を案内します。</p>
              </div>
              <button onClick={toggleBot} role="switch" aria-checked={bot.enabled} aria-label="AIチャットボット"
                className={`relative w-12 h-7 shrink-0 rounded-full transition ${bot.enabled ? 'bg-violet-600' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${bot.enabled ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
            <h3 className="text-xs font-bold text-gray-500 mt-4">最近届いた質問</h3>
            {bot.questions.length === 0 ? <p className="text-sm text-gray-400 mt-1">まだ質問はありません</p> : (
              <ul className="mt-1 divide-y text-sm">
                {bot.questions.map((q) => (
                  <li key={q.id} className="py-2 flex items-start justify-between gap-3">
                    <span className="break-words min-w-0">{q.question}</span>
                    {!q.answered && <span className="shrink-0 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold px-2 py-0.5">答えられなかった</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-gray-400 mt-2">「答えられなかった」質問は、ページに情報を足すチャンス。料金表やよくある質問を追加すると、AIも答えられるようになるよ。</p>
          </section>
        )}

        <p className="text-[11px] text-gray-400">見た人・押した人を特定する情報は記録していません。</p>
      </div>
    </main>
  );
}
