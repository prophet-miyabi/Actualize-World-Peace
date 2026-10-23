'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

// データ資産の管理画面: 匿名データレイクの件数、業種×チャネルの勝ちパターン、ハーネス導入インテントの上位
type Benchmark = { id: string; industryKey: string; industryLabel: string; channel: string; sampleSize: number; avgGatePassRate: number; avgClickRate: number; avgBookingRate: number; avgOrderValue: number; bestSendHoursJson: number[]; winningKeywordsJson: string[]; optimalJitterMs: number; updatedAt: string };
type Lake = { total: number; last30d: Record<string, number>; topIndustries: { key: string; label: string; count: number }[] };
type Intent = { id: string; ownerId: string; industryLabel: string; recommendedAddon: string; label: string; intentScore: number; reason: string | null; monthlyTraffic: number; monthlyBookings: number; lineFriendCount: number; isConverted: boolean; owner: { username: string | null; name: string } | null; updatedAt: string };

const STAGE: Record<string, string> = { awareness_post: '発信', gate_dm: 'DM・LINE反応', lp_visit: 'ページ来訪', step_message: 'ステップ', booking: '予約', payment: '決済' };
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function IntelligencePage() {
  const [lake, setLake] = useState<Lake | null>(null);
  const [rows, setRows] = useState<Benchmark[]>([]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(async () => {
    const [b, i] = await Promise.all([api.get('/intelligence/benchmarks'), api.get('/intelligence/intents')]);
    setLake(b.data.lake); setRows(b.data.benchmarks); setIntents(i.data.intents);
  }, []);
  useEffect(() => { load().catch(() => setMsg('読み込めませんでした')); }, [load]);
  const aggregate = async () => {
    setBusy(true); setMsg('');
    try { const { data } = await api.post('/intelligence/aggregate'); setMsg(`集計しました（勝ちパターン ${data.benchmarks.updated} 件更新・利用者 ${data.owners} 人を評価）`); await load(); } catch (e: any) { setMsg(e?.response?.data?.error || '集計に失敗しました'); } finally { setBusy(false); }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="text-lg font-black">データ資産（匿名レイク・勝ちパターン・導入インテント）</h1>
        <button disabled={busy} onClick={aggregate} className="ml-auto rounded-full bg-gray-900 text-white text-xs font-bold px-4 py-2 disabled:opacity-40">{busy ? '集計中…' : '今すぐ集計'}</button>
      </div>
      {msg && <p className="text-xs text-violet-700 mb-3">{msg}</p>}
      <p className="text-xs text-gray-500 mb-4">レイクには個人を特定する値（利用者ID・氏名・連絡先・本文）を入れていません。業種・チャネル・段階・時間帯・文面のハッシュだけを蓄積し、6時間ごとに業種別の勝ちパターンへ結晶化して、ページ生成の手本（業種プレイブック）に還流します。サンプル 5 件未満の組み合わせは作りません。</p>

      {lake && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6 text-sm">
          <div className="rounded-2xl bg-white border p-3"><p className="text-[11px] text-gray-500">レイクの累計</p><p className="text-xl font-black">{lake.total.toLocaleString('ja-JP')}</p></div>
          {Object.entries(lake.last30d).map(([k, v]) => <div key={k} className="rounded-2xl bg-white border p-3"><p className="text-[11px] text-gray-500">{STAGE[k] ?? k}（30日）</p><p className="text-xl font-black">{v.toLocaleString('ja-JP')}</p></div>)}
          {lake.topIndustries.length > 0 && <div className="rounded-2xl bg-white border p-3 col-span-2 sm:col-span-4"><p className="text-[11px] text-gray-500 mb-1">業種別の件数（30日）</p><p className="text-xs">{lake.topIndustries.map((t) => `${t.label} ${t.count}`).join(' ・ ')}</p></div>}
        </section>
      )}

      <section className="mb-6">
        <h2 className="font-bold mb-2">業種×チャネルの勝ちパターン <span className="text-xs text-gray-500">{rows.length} 件</span></h2>
        {rows.length === 0 ? <p className="text-sm text-gray-500 rounded-2xl bg-white border p-4">まだ十分なデータがありません。来訪・予約・決済・配信が記録されると自動で作られます。</p> : (
          <div className="overflow-x-auto rounded-2xl bg-white border">
            <table className="min-w-[760px] w-full text-xs">
              <thead className="text-left text-gray-500 border-b"><tr><th className="p-2">業種</th><th className="p-2">チャネル</th><th className="p-2">n</th><th className="p-2">反応率</th><th className="p-2">LP遷移</th><th className="p-2">予約・決済</th><th className="p-2">平均単価</th><th className="p-2">反応が多い時間</th><th className="p-2">効いた言葉</th></tr></thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.id}><td className="p-2 font-bold">{r.industryLabel}</td><td className="p-2">{r.channel}</td><td className="p-2">{r.sampleSize}</td><td className="p-2">{pct(r.avgGatePassRate)}</td><td className="p-2">{pct(r.avgClickRate)}</td><td className="p-2">{pct(r.avgBookingRate)}</td><td className="p-2">{r.avgOrderValue ? `¥${r.avgOrderValue.toLocaleString('ja-JP')}` : '—'}</td><td className="p-2">{(r.bestSendHoursJson ?? []).map((h) => `${h}時`).join('・') || '—'}</td><td className="p-2">{(r.winningKeywordsJson ?? []).join('・') || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="font-bold mb-2">ハーネス導入インテント（上位） <span className="text-xs text-gray-500">{intents.length} 件</span></h2>
        {intents.length === 0 ? <p className="text-sm text-gray-500 rounded-2xl bg-white border p-4">まだ提案はありません。ページの閲覧・予約・LINE の友だち数などが貯まると、利用者ごとに「いま要る外部ツール」を予測します。</p> : (
          <ul className="space-y-2">
            {intents.map((i) => (
              <li key={i.id} className={`rounded-2xl bg-white border p-3 text-sm ${i.intentScore >= 80 ? 'border-violet-300' : ''}`}>
                <div className="flex flex-wrap items-center gap-2"><span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${i.intentScore >= 80 ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{i.intentScore}</span><span className="font-bold">{i.label}</span><span className="text-xs text-gray-500">{i.owner ? `@${i.owner.username ?? '-'}（${i.owner.name}）` : i.ownerId.slice(0, 8)} ・ {i.industryLabel}</span>{i.isConverted && <span className="text-[11px] rounded-full bg-green-100 text-green-700 px-2">導入済み</span>}</div>
                <p className="text-xs text-gray-600 mt-1">{i.reason}</p>
                <p className="text-[11px] text-gray-400 mt-1">閲覧 {i.monthlyTraffic} / 予約 {i.monthlyBookings} / LINE友だち {i.lineFriendCount} ・ {new Date(i.updatedAt).toLocaleString('ja-JP')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
