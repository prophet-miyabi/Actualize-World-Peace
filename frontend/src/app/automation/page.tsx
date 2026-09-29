'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

type Action = 'navigate' | 'click' | 'type' | 'select' | 'waitFor' | 'extract';

type Step = { action: Action; selector?: string; value?: string; label?: string };

type Workflow = {
  id: string;
  name: string;
  targetUrl: string;
  steps: Step[];
  enabled: boolean;
  createdAt: string;
};

type RunLogEntry = { index: number; action: Action; label?: string; ok: boolean; detail?: string };
type Run = { id: string; status: string; log: RunLogEntry[] | null; blockedStep: number | null; startedAt: string; finishedAt: string | null };

const ACTIONS: Action[] = ['navigate', 'click', 'type', 'select', 'waitFor', 'extract'];
const ACTION_LABEL: Record<Action, string> = {
  navigate: '移動する（URL）',
  click: 'クリックする',
  type: '入力する',
  select: '選択する（セレクトボックス）',
  waitFor: '表示されるまで待つ',
  extract: 'テキストを取得する'
};
const STATUS_LABEL: Record<string, string> = {
  running: '実行中', success: '成功', failed: '失敗', blocked: 'ブロックされました'
};

const emptyStep = (): Step => ({ action: 'click', selector: '', value: '', label: '' });

// 「どのサイトで、どんな操作をするか」を編集して繰り返し実行できるブラウザ自動化ワークフロー。
// パスワード・カード番号など重要な認証情報の入力は、保存時・実行時の両方でシステム側が拒否する。
export default function Automation() {
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [maxSteps, setMaxSteps] = useState(40);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, Run[]>>({});

  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [steps, setSteps] = useState<Step[]>([emptyStep()]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await api.get('/automation');
    setWorkflows(res.data.workflows);
    setMaxSteps(res.data.maxSteps);
  }, []);

  useEffect(() => { load().catch(() => setError('読み込みに失敗しました。')); }, [load]);

  const resetForm = () => {
    setName(''); setTargetUrl(''); setSteps([emptyStep()]); setShowNew(false);
  };

  const create = async () => {
    setSaving(true);
    setError('');
    try {
      await api.post('/automation', { name, targetUrl, steps });
      resetForm();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || '作成に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (w: Workflow) => {
    setBusyId(w.id);
    try {
      await api.put(`/automation/${w.id}`, { enabled: !w.enabled });
      await load();
    } catch {
      setError('更新に失敗しました。');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('このワークフローを削除します。よろしいですか？')) return;
    setBusyId(id);
    try {
      await api.delete(`/automation/${id}`);
      await load();
    } catch {
      setError('削除に失敗しました。');
    } finally {
      setBusyId(null);
    }
  };

  const run = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      await api.post(`/automation/${id}/run`);
      // ブラウザの起動〜操作完了まで数秒〜数十秒かかるため、少し待ってから履歴を再取得する
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await api.get(`/automation/${id}/runs`);
        setExpandedRuns((prev) => ({ ...prev, [id]: res.data.runs }));
        if (res.data.runs[0] && res.data.runs[0].status !== 'running') break;
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || '実行に失敗しました。');
    } finally {
      setBusyId(null);
    }
  };

  const toggleHistory = async (id: string) => {
    if (expandedRuns[id]) {
      setExpandedRuns((prev) => { const next = { ...prev }; delete next[id]; return next; });
      return;
    }
    const res = await api.get(`/automation/${id}/runs`);
    setExpandedRuns((prev) => ({ ...prev, [id]: res.data.runs }));
  };

  const updateStep = (i: number, patch: Partial<Step>) => {
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  if (!workflows) return <p className="p-8">{error || '読み込み中...'}</p>;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <div className="flex items-center justify-between mt-2 mb-1">
          <h1 className="text-2xl font-bold">ブラウザ操作の自動化</h1>
          <button onClick={() => setShowNew((v) => !v)} className="text-sm font-bold text-blue-600">
            {showNew ? '閉じる' : '＋ 新しいワークフロー'}
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          「どのサイトで、どの操作をするか」を登録しておくと、繰り返し自動で実行できます。
          パスワード・クレジットカード番号など重要な情報の入力を伴う手順は、安全のため登録・実行のどちらでも拒否されます。
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {showNew && (
          <div className="bg-white border rounded-xl p-5 mb-8 space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-500">ワークフロー名</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 求人情報サイトへの掲載内容チェック"
                className="w-full border rounded-lg px-3 py-2 mt-1" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500">開始URL</label>
              <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://example.com/login"
                className="w-full border rounded-lg px-3 py-2 mt-1" />
            </div>

            <div>
              <label className="text-xs font-bold text-gray-500">手順（上から順に実行されます／最大{maxSteps}件）</label>
              <div className="space-y-2 mt-1">
                {steps.map((s, i) => (
                  <div key={i} className="border rounded-lg p-3 space-y-2">
                    <div className="flex gap-2">
                      <select value={s.action} onChange={(e) => updateStep(i, { action: e.target.value as Action })}
                        className="border rounded-lg px-2 py-1 text-sm">
                        {ACTIONS.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
                      </select>
                      <input value={s.label ?? ''} onChange={(e) => updateStep(i, { label: e.target.value })}
                        placeholder="メモ（任意）" className="flex-1 border rounded-lg px-2 py-1 text-sm" />
                      <button onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-xs text-red-500 px-2">削除</button>
                    </div>
                    {s.action !== 'navigate' && (
                      <input value={s.selector ?? ''} onChange={(e) => updateStep(i, { selector: e.target.value })}
                        placeholder="対象要素のCSSセレクタ（例: #email, button.submit）"
                        className="w-full border rounded-lg px-2 py-1 text-sm" />
                    )}
                    {(s.action === 'type' || s.action === 'select' || s.action === 'navigate') && (
                      <input value={s.value ?? ''} onChange={(e) => updateStep(i, { value: e.target.value })}
                        placeholder={s.action === 'navigate' ? '遷移先URL（開始URLと同じサイト内のみ）' : '入力する値'}
                        className="w-full border rounded-lg px-2 py-1 text-sm" />
                    )}
                  </div>
                ))}
              </div>
              <button onClick={() => setSteps((prev) => [...prev, emptyStep()])}
                disabled={steps.length >= maxSteps}
                className="text-xs text-blue-600 font-bold mt-2 disabled:text-gray-300">
                ＋ 手順を追加
              </button>
            </div>

            <button onClick={create} disabled={saving || !name || !targetUrl}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg font-bold text-sm disabled:opacity-50">
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        )}

        {workflows.length === 0 ? (
          <p className="text-gray-400 text-sm">登録済みのワークフローはまだありません。</p>
        ) : (
          <div className="space-y-3">
            {workflows.map((w) => (
              <div key={w.id} className="bg-white border rounded-xl p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold">{w.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{w.targetUrl}</p>
                  </div>
                  <span className={`text-xs font-bold rounded-full px-3 py-1 shrink-0 ${w.enabled ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                    {w.enabled ? '有効' : '無効'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-2">{w.steps.length}件の手順</p>
                <div className="flex flex-wrap gap-3 mt-4 text-sm">
                  <button onClick={() => run(w.id)} disabled={busyId === w.id || !w.enabled}
                    className="bg-blue-600 text-white px-4 py-1.5 rounded-lg font-bold disabled:opacity-50">
                    {busyId === w.id ? '実行中...' : '今すぐ実行'}
                  </button>
                  <button onClick={() => toggleHistory(w.id)} className="text-gray-600 underline">
                    {expandedRuns[w.id] ? '履歴を閉じる' : '実行履歴を見る'}
                  </button>
                  <button onClick={() => toggleEnabled(w)} disabled={busyId === w.id} className="text-gray-600 underline">
                    {w.enabled ? '無効にする' : '有効にする'}
                  </button>
                  <button onClick={() => remove(w.id)} disabled={busyId === w.id} className="text-red-500 underline">
                    削除
                  </button>
                </div>

                {expandedRuns[w.id] && (
                  <div className="mt-4 border-t pt-3 space-y-2">
                    {expandedRuns[w.id].length === 0 ? (
                      <p className="text-xs text-gray-400">実行履歴はありません。</p>
                    ) : expandedRuns[w.id].map((r) => (
                      <div key={r.id} className="text-xs bg-gray-50 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <span className={`font-bold ${r.status === 'success' ? 'text-green-600' : r.status === 'running' ? 'text-blue-600' : 'text-red-600'}`}>
                            {STATUS_LABEL[r.status] || r.status}
                          </span>
                          <span className="text-gray-400">{new Date(r.startedAt).toLocaleString()}</span>
                        </div>
                        {r.log && r.log.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {r.log.map((entry, idx) => (
                              <li key={idx} className={entry.ok ? 'text-gray-600' : 'text-red-600'}>
                                {idx + 1}. {entry.label || ACTION_LABEL[entry.action] || entry.action}
                                {entry.detail && ` — ${entry.detail}`}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
