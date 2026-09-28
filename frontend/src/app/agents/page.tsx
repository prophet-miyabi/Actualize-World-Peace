'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

type Task = {
  id: string;
  role: string; // marketing_x / marketing_instagram / marketing_facebook / marketing_tiktok / growth
  kind: 'sns_post_draft' | 'lp_health_check';
  output: any;
  status: 'pending_review' | 'approved' | 'rejected';
  reviewPassed: boolean | null;
  reviewNote: string | null;
  autoApproved: boolean;
  createdAt: string;
};

const ROLE_LABEL: Record<string, string> = {
  marketing_x: 'Xマーケティング担当',
  marketing_instagram: 'Instagramマーケティング担当',
  marketing_facebook: 'Facebookマーケティング担当',
  marketing_tiktok: 'TikTokマーケティング担当',
  growth: '成長分析担当'
};
const roleLabel = (role: string) => ROLE_LABEL[role] || role;

// 役割ごとのAIエージェントが自動で作った成果物を確認する画面。
// 「作成・分析・審査」はエージェントが自動で行う。SNS投稿の実行は、
// 自動承認をオンにしている場合は審査済みの下書きが自動で投稿予約され、
// オフの場合はここで人が承認する。
export default function Agents() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [autoPublish, setAutoPublish] = useState(false);
  const [savingSetting, setSavingSetting] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([api.get('/agent-tasks'), api.get('/agent-tasks/settings')]);
    setTasks(t.data.tasks);
    setAutoPublish(!!s.data.autoPublishEnabled);
  }, []);

  useEffect(() => { load().catch(() => setError('読み込みに失敗しました。')); }, [load]);

  // 複数プラットフォーム分のAI呼び出しがあり数十秒かかるため、開始だけ依頼して裏側で待つ
  const runNow = async () => {
    setRunning(true);
    setError('');
    try {
      await api.post('/agent-tasks/run-now');
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        await load();
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || '実行に失敗しました。');
    } finally {
      setRunning(false);
    }
  };

  const toggleAutoPublish = async () => {
    const next = !autoPublish;
    if (next && !window.confirm(
      '自動承認をオンにすると、コンプライアンス担当の審査に通ったSNS投稿が、あなたの確認なしで自動的に投稿されるようになります。\n\n本当に有効にしますか？'
    )) return;
    setSavingSetting(true);
    try {
      await api.put('/agent-tasks/settings', { autoPublishEnabled: next });
      setAutoPublish(next);
    } catch {
      setError('設定の保存に失敗しました。');
    } finally {
      setSavingSetting(false);
    }
  };

  const act = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/agent-tasks/${id}/${action}`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || '処理に失敗しました。');
    } finally {
      setBusyId(null);
    }
  };

  if (!tasks) return <p className="p-8">{error || '読み込み中...'}</p>;

  const pending = tasks.filter((t) => t.status === 'pending_review');
  const history = tasks.filter((t) => t.status !== 'pending_review');

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <div className="flex items-center justify-between mt-2 mb-1">
          <h1 className="text-2xl font-bold">AIエージェント</h1>
          <button onClick={runNow} disabled={running} className="text-sm font-bold text-blue-600 disabled:text-gray-400">
            {running ? '実行中...' : '今すぐ実行 →'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          マーケティング担当・コンプライアンス担当・成長分析担当が、定期的に自動で分析・下書き作成・審査を行います。
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <div className={`border rounded-xl p-5 mb-8 ${autoPublish ? 'bg-amber-50 border-amber-300' : 'bg-white'}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-bold">自動承認（Human out of the loop）</p>
              <p className="text-xs text-gray-500 mt-1">
                {autoPublish
                  ? 'オン：コンプライアンス担当が承認した投稿は、確認なしで自動的に投稿されます。'
                  : 'オフ：コンプライアンス担当の審査結果を参考に、最終確認はあなたが行います。'}
              </p>
            </div>
            <button onClick={toggleAutoPublish} disabled={savingSetting}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-bold disabled:opacity-50 ${autoPublish ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
              {autoPublish ? 'オンにしています' : 'オフにしています'}
            </button>
          </div>
        </div>

        <h2 className="font-bold text-lg mb-3">承認待ち{pending.length > 0 && `（${pending.length}）`}</h2>
        {pending.length === 0 ? (
          <p className="text-gray-400 text-sm mb-8">承認待ちの項目はありません。</p>
        ) : (
          <div className="space-y-3 mb-8">
            {pending.map((t) => (
              <div key={t.id} className="bg-white border rounded-xl p-5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-blue-700 bg-blue-50 rounded-full px-3 py-1">{roleLabel(t.role)}</span>
                  {t.reviewPassed === true && <span className="text-xs font-bold text-green-700 bg-green-50 rounded-full px-3 py-1">審査OK</span>}
                  {t.reviewPassed === false && <span className="text-xs font-bold text-red-700 bg-red-50 rounded-full px-3 py-1">審査で懸念あり</span>}
                </div>
                <p className="text-xs text-gray-400 mt-2">{new Date(t.createdAt).toLocaleString()}</p>
                {t.kind === 'sns_post_draft' ? (
                  <>
                    <p className="text-xs text-gray-500 mt-2">投稿先: {t.output.platform}</p>
                    <p className="mt-1 whitespace-pre-wrap">{t.output.text}</p>
                    {t.reviewNote && (
                      <p className={`text-xs mt-2 ${t.reviewPassed ? 'text-gray-500' : 'text-red-600'}`}>
                        コンプライアンス担当の所見: {t.reviewNote}
                      </p>
                    )}
                  </>
                ) : (
                  <ul className="mt-2 list-disc list-inside text-sm text-gray-700 space-y-1">
                    {t.output.issues.map((issue: string, i: number) => <li key={i}>{issue}</li>)}
                  </ul>
                )}
                {t.kind === 'sns_post_draft' && (
                  <div className="flex gap-3 mt-4">
                    <button onClick={() => act(t.id, 'approve')} disabled={busyId === t.id}
                      className="bg-blue-600 text-white px-5 py-2 rounded-lg font-bold text-sm disabled:opacity-50">
                      承認して投稿予約する
                    </button>
                    <button onClick={() => act(t.id, 'reject')} disabled={busyId === t.id}
                      className="px-5 py-2 rounded-lg border text-gray-600 font-bold text-sm disabled:opacity-50">
                      却下する
                    </button>
                  </div>
                )}
                {t.kind === 'lp_health_check' && (
                  <button onClick={() => act(t.id, 'reject')} disabled={busyId === t.id}
                    className="mt-4 text-xs text-gray-400 underline">
                    確認済みにする
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {history.length > 0 && (
          <>
            <h2 className="font-bold text-lg mb-3">履歴</h2>
            <div className="space-y-2">
              {history.map((t) => (
                <div key={t.id} className="bg-white border rounded-xl p-4 text-sm flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-gray-500">{roleLabel(t.role)}</span>
                    {t.autoApproved && <span className="text-xs font-bold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5 ml-2">AI自動承認</span>}
                    <p className="text-gray-700 mt-1 line-clamp-1">
                      {t.kind === 'sns_post_draft' ? t.output.text : t.output.issues?.join(' / ')}
                    </p>
                  </div>
                  <span className={`text-xs font-bold whitespace-nowrap ${t.status === 'approved' ? 'text-green-600' : 'text-gray-400'}`}>
                    {t.status === 'approved' ? '承認済み' : '却下'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
