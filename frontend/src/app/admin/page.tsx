'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import AiHealthBanner from '@/components/admin/AiHealthBanner';

type Overview = {
  generatedAt: string;
  kpi: {
    users: number; newUsers7d: number; pages: number; newPages7d: number; ordersRequested: number; ordersInProgress: number;
    openErrors: number; pendingReviews: number; proposalsWaiting: number; affiliateClicks7d: number;
  };
  emergency: { pause_agent_loop: boolean; pause_sns_posting: boolean; pause_crew?: boolean };
  config: { smsVerification: string; stripe: boolean; anthropic: boolean; imageAi: boolean; githubForAiDevelopment: boolean; customDomainBase: boolean };
  todos: { label: string; count: number; href: string }[];
  readiness: { key: string; group: 'required' | 'recommended' | 'optional'; label: string; status: 'ok' | 'todo' | 'na'; detail: string; unlocks: string; where: string; href?: string }[];
};

const CONFIG_LABEL: Record<keyof Overview['config'], string> = {
  smsVerification: 'SMS認証',
  stripe: '決済（Stripe）',
  anthropic: 'intelligence（Claude）',
  imageAi: '画像生成 intelligence',
  githubForAiDevelopment: 'AWPによる開発（GitHub連携）',
  customDomainBase: 'AWPの独自ドメイン'
};

// 運営者のダッシュボード: 数字の要約 → 要対応 → 緊急停止の状態 → 各種設定の状態
export default function AdminDashboard() {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/ops/overview').then(({ data }) => setO(data)).catch(() => setError('読み込みに失敗しました。'));
  }, []);

  if (!o) return <p className="p-6 text-sm text-gray-500">{error || '読み込み中...'}</p>;

  const cards: { label: string; value: number; sub?: string; href?: string; alert?: boolean }[] = [
    { label: 'ユーザー', value: o.kpi.users, sub: `7日間で +${o.kpi.newUsers7d}` },
    { label: '公開ページ', value: o.kpi.pages, sub: `7日間で +${o.kpi.newPages7d}` },
    { label: '未対応の申し込み', value: o.kpi.ordersRequested, sub: `対応中 ${o.kpi.ordersInProgress}`, href: '/admin/harness', alert: o.kpi.ordersRequested > 0 },
    { label: '未解決のエラー', value: o.kpi.openErrors, href: '/admin/monitoring', alert: o.kpi.openErrors > 0 },
    { label: '承認待ちのAWP提案', value: o.kpi.proposalsWaiting, href: '/admin/ops', alert: o.kpi.proposalsWaiting > 0 },
    { label: '提携ツールのクリック', value: o.kpi.affiliateClicks7d, sub: '直近7日間' }
  ];
  const paused = o.emergency.pause_agent_loop || o.emergency.pause_sns_posting || !!o.emergency.pause_crew;

  return (
    <div className="px-4 py-6 md:px-8 max-w-5xl">
      <h1 className="text-2xl font-black">ダッシュボード</h1>
      <AiHealthBanner />
      <p className="text-xs text-gray-500 mt-1">{new Date(o.generatedAt).toLocaleString('ja-JP')} 時点</p>

      {paused && (
        <Link href="/admin/emergency" className="block mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 font-bold">
          緊急停止中: {[o.emergency.pause_agent_loop && 'AWPエージェント', o.emergency.pause_sns_posting && 'SNS予約投稿', o.emergency.pause_crew && 'ローンチ・クルー'].filter(Boolean).join('・')} →
        </Link>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-5">
        {cards.map((c) => {
          const inner = (
            <>
              <p className="text-xs text-gray-500">{c.label}</p>
              <p className={`text-3xl font-black mt-1 tabular-nums ${c.alert ? 'text-violet-700' : ''}`}>{c.value.toLocaleString('ja-JP')}</p>
              {c.sub && <p className="text-[11px] text-gray-500 mt-1">{c.sub}</p>}
            </>
          );
          return c.href ? (
            <Link key={c.label} href={c.href} className={`rounded-2xl bg-white border p-4 hover:border-violet-400 ${c.alert ? 'border-violet-300' : ''}`}>{inner}</Link>
          ) : (
            <div key={c.label} className="rounded-2xl bg-white border p-4">{inner}</div>
          );
        })}
      </div>

      <section className="mt-8">
        <h2 className="font-bold mb-2">要対応</h2>
        {o.todos.length === 0 ? (
          <p className="text-sm text-gray-500 bg-white border rounded-xl p-4">いま対応が必要なものはありません。</p>
        ) : (
          <ul className="bg-white border rounded-xl divide-y">
            {o.todos.map((t) => (
              <li key={t.label}>
                <Link href={t.href} className="flex justify-between items-center px-4 py-3 text-sm hover:bg-gray-50">
                  <span>{t.label}</span>
                  <span className="font-black text-violet-700 tabular-nums">{t.count} →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 grid md:grid-cols-2 gap-4">
        <div className="bg-white border rounded-xl p-4">
          <h2 className="font-bold mb-1">公開準備チェック</h2>
          <p className="text-xs text-gray-500 mb-3">「準備中」と表示されている機能は、ここの未設定を埋めると使えるようになります。{(() => { const r = o.readiness.filter((x) => x.group === 'required'); return `必須 ${r.filter((x) => x.status === 'ok').length}/${r.length}`; })()}</p>
          {(['required', 'recommended', 'optional'] as const).map((g) => (
            <div key={g} className="mb-3">
              <p className="text-[11px] font-bold text-gray-500 mb-1">{g === 'required' ? '必須（公開前に）' : g === 'recommended' ? '推奨' : '任意'}</p>
              <ul className="space-y-2 text-sm">
                {o.readiness.filter((x) => x.group === g).map((x) => (
                  <li key={x.key} className="rounded-lg border p-2">
                    <div className="flex justify-between gap-3">
                      <span className="font-bold">{x.href ? <Link href={x.href} className="underline">{x.label}</Link> : x.label}</span>
                      <span className={`shrink-0 text-xs font-bold rounded-full px-2 py-0.5 ${x.status === 'ok' ? 'bg-emerald-50 text-emerald-700' : x.status === 'na' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700'}`}>{x.status === 'ok' ? '設定済み' : x.status === 'na' ? '不要' : '未設定'}</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">{x.detail}</p>
                    {x.status !== 'ok' && x.status !== 'na' && (
                      <>
                        <p className="text-xs text-gray-500 mt-1">解放される機能: {x.unlocks}</p>
                        <p className="text-xs text-violet-700 mt-0.5">設定場所: {x.where}</p>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="rounded-xl p-4 text-white bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500">
          <h2 className="font-bold mb-1">AWPオペレーターに聞く</h2>
          <p className="text-sm opacity-90 mb-3">システムの状況確認、課題の整理、設定変更やコード変更の提案までをチャットで。実行はあなたの承認後です。</p>
          <Link href="/admin/ops" className="inline-block bg-white text-violet-700 font-bold rounded-full px-4 py-2 text-sm">チャットを開く →</Link>
        </div>
      </section>
    </div>
  );
}
