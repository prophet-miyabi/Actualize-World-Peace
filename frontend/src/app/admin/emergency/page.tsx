'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';

type Flags = { pause_agent_loop: boolean; pause_sns_posting: boolean };

const CONTROLS: { key: keyof Flags; title: string; body: string }[] = [
  { key: 'pause_agent_loop', title: 'AIエージェントの定期実行', body: 'マーケティング・成長分析・監視・自己PRなど、6時間ごとに動くAIエージェントをすべて止めます。' },
  { key: 'pause_sns_posting', title: 'SNSの予約投稿', body: '予約されているSNS投稿の送信を止めます。予約は消えず、再開すると順に投稿されます。' }
];

// 緊急コントロール: 自動で動く処理を、その場で止める・再開する（確認はボタンの場所で行う）
export default function EmergencyPage() {
  const [flags, setFlags] = useState<Flags | null>(null);
  const [confirming, setConfirming] = useState<keyof Flags | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/ops/overview').then(({ data }) => setFlags(data.emergency)).catch(() => setError('読み込みに失敗しました。'));
  }, []);

  const apply = async (key: keyof Flags, value: boolean) => {
    setError('');
    try {
      const { data } = await api.put('/ops/emergency', { key, value });
      setFlags(data);
      setConfirming(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || '変更できませんでした。');
    }
  };

  if (!flags) return <p className="p-6 text-sm text-gray-500">{error || '読み込み中...'}</p>;

  return (
    <div className="px-4 py-6 md:px-8 max-w-3xl">
      <h1 className="text-2xl font-black">緊急コントロール</h1>
      <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mt-3">
        ここでの操作はすぐに本番へ反映されます。止めた処理は、再開するまで動きません。
      </p>
      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

      <ul className="mt-5 space-y-3">
        {CONTROLS.map((c) => {
          const stopped = flags[c.key];
          const next = !stopped;
          return (
            <li key={c.key} className="bg-white border rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{c.title}</p>
                  <p className="text-xs text-gray-600 mt-1">{c.body}</p>
                </div>
                <span className={`shrink-0 text-xs font-bold rounded-full px-2.5 py-1 ${stopped ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {stopped ? '停止中' : '動作中'}
                </span>
              </div>
              {confirming === c.key ? (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold">{next ? '本当に止めますか？' : '再開しますか？'}</span>
                  <button onClick={() => apply(c.key, next)} className={`rounded-full px-4 py-2 text-sm font-bold text-white ${next ? 'bg-red-600' : 'bg-emerald-600'}`}>
                    {next ? '止める' : '再開する'}
                  </button>
                  <button onClick={() => setConfirming(null)} className="rounded-full px-4 py-2 text-sm text-gray-600">キャンセル</button>
                </div>
              ) : (
                <button onClick={() => setConfirming(c.key)}
                  className={`mt-3 rounded-full px-4 py-2 text-sm font-bold border ${stopped ? 'border-emerald-600 text-emerald-700' : 'border-red-600 text-red-600'}`}>
                  {stopped ? '再開する' : '止める'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
