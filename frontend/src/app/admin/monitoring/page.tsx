'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

type SystemError = {
  id: string;
  source: string;
  message: string;
  stack: string | null;
  diagnosis: string | null;
  status: 'open' | 'diagnosed' | 'resolved';
  createdAt: string;
};

// 監視・障害対応担当エージェントが記録・診断したエラーの一覧（管理者専用）。
// 診断結果はあくまで「人が確認・適用するための提案」で、コードの自動修正や
// 本番環境への自動デプロイ・ロールバックは行わない（human on the loopの原則）。
export default function AdminMonitoring() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<SystemError[] | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/auth/me').then(({ data }) => setAllowed(!!data.isAdmin)).catch(() => setAllowed(false));
  }, []);

  const load = useCallback(async () => {
    const { data } = await api.get('/monitoring');
    setErrors(data.errors);
  }, []);

  useEffect(() => { if (allowed) load().catch(() => setErr('読み込みに失敗しました。')); }, [allowed, load]);

  const runNow = async () => {
    setRunning(true);
    setErr('');
    try {
      await api.post('/monitoring/run-now');
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        await load();
      }
    } catch {
      setErr('診断の実行に失敗しました。');
    } finally {
      setRunning(false);
    }
  };

  const resolve = async (id: string) => {
    try {
      await api.post(`/monitoring/${id}/resolve`);
      await load();
    } catch {
      setErr('更新に失敗しました。');
    }
  };

  if (allowed === false) return <p className="p-8">この画面は管理者のみ利用できます。</p>;
  if (!errors) return <p className="p-8">{err || '読み込み中...'}</p>;

  const open = errors.filter((e) => e.status !== 'resolved');
  const resolved = errors.filter((e) => e.status === 'resolved');

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <div className="flex items-center justify-between mt-2 mb-1">
          <h1 className="text-2xl font-bold">システム監視</h1>
          <button onClick={runNow} disabled={running} className="text-sm font-bold text-blue-600 disabled:text-gray-400">
            {running ? '診断中...' : '今すぐ診断する →'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          想定外のエラーをAIが分析し、原因と修正方針を提示します。コードの自動修正や本番への自動反映は行いません。
          修正はこの内容を参考に、ご自身で適用してください。
        </p>
        {err && <p className="text-red-600 text-sm mb-4">{err}</p>}

        <h2 className="font-bold text-lg mb-3">対応が必要{open.length > 0 && `（${open.length}）`}</h2>
        {open.length === 0 ? (
          <p className="text-gray-400 text-sm mb-8">現在、記録されているエラーはありません。</p>
        ) : (
          <div className="space-y-3 mb-8">
            {open.map((e) => (
              <div key={e.id} className="bg-white border rounded-xl p-5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-blue-700 bg-blue-50 rounded-full px-3 py-1">{e.source}</span>
                  <span className={`text-xs font-bold rounded-full px-3 py-1 ${e.status === 'diagnosed' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                    {e.status === 'diagnosed' ? '診断済み' : '未診断'}
                  </span>
                  <span className="text-xs text-gray-400">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-2 font-mono text-sm text-gray-800">{e.message}</p>
                {e.diagnosis && <p className="mt-3 text-sm whitespace-pre-wrap bg-gray-50 rounded-lg p-3">{e.diagnosis}</p>}
                <button onClick={() => resolve(e.id)} className="mt-3 text-xs font-bold text-gray-400 underline">
                  対応済みにする
                </button>
              </div>
            ))}
          </div>
        )}

        {resolved.length > 0 && (
          <>
            <h2 className="font-bold text-lg mb-3">対応済み</h2>
            <div className="space-y-2">
              {resolved.map((e) => (
                <div key={e.id} className="bg-white border rounded-xl p-4 text-sm text-gray-500">
                  <span className="font-bold">{e.source}</span> — {e.message}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
