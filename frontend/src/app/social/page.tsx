'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

type AccountRow = { platform: string; label: string; connected: boolean; accountLabel: string | null; configured: boolean };
type Post = {
  id: string; text: string; mediaUrl: string | null; platforms: string[];
  scheduledAt: string; status: string; attempts: number; results: any;
};

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  pending: { text: '予約中', className: 'bg-blue-100 text-blue-700' },
  processing: { text: '投稿中', className: 'bg-yellow-100 text-yellow-700' },
  done: { text: '投稿済み', className: 'bg-green-100 text-green-700' },
  failed: { text: '失敗・取消', className: 'bg-red-100 text-red-700' }
};

export default function Social() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState('');
  const [connectError, setConnectError] = useState('');
  const [connectedNotice, setConnectedNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [a, p] = await Promise.all([api.get('/social/accounts'), api.get('/social/posts')]);
    setAccounts(a.data.platforms);
    setPosts(p.data.posts);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  // OAuth連携から戻ってきたときの結果表示（?connected=x / ?connect_error=...）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const err = params.get('connect_error');
    if (connected) { load(); setConnectedNotice(`${connected}と連携しました。`); }
    if (err) setConnectError(err);
    if (connected || err) window.history.replaceState({}, '', '/social');
  }, [load]);
  // 予約中の投稿があるうちは、状況（投稿中/完了/失敗）を自動で更新する
  useEffect(() => {
    if (!posts.some((p) => p.status === 'pending' || p.status === 'processing')) return;
    const t = setInterval(() => { api.get('/social/posts').then((r) => setPosts(r.data.posts)).catch(() => {}); }, 10000);
    return () => clearInterval(t);
  }, [posts]);

  const connect = (platform: string) => {
    setConnectError('');
    // OAuthは先方のログイン画面への通常の画面遷移が必要なため、fetchではなくページ遷移で行う。
    // Authorizationヘッダーを付けられないので、代わりにトークンをクエリで一度だけ渡す
    const token = localStorage.getItem('token') || '';
    window.location.href = `/api/social/${platform}/connect?token=${encodeURIComponent(token)}`;
  };

  const disconnect = async (platform: string) => {
    if (!window.confirm('連携を解除しますか？')) return;
    await api.delete(`/social/${platform}`);
    load();
  };

  const togglePlatform = (p: string) => {
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  };

  const schedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!text.trim()) return setError('投稿文を入力してください。');
    if (platforms.length === 0) return setError('投稿先を1つ以上選んでください。');
    if (!scheduledAt) return setError('投稿日時を指定してください。');
    setSaving(true);
    try {
      await api.post('/social/posts', {
        text: text.trim(),
        mediaUrl: mediaUrl.trim() || null,
        platforms,
        scheduledAt: new Date(scheduledAt).toISOString()
      });
      setText(''); setMediaUrl(''); setPlatforms([]); setScheduledAt('');
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || '予約に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: string) => {
    if (!window.confirm('この予約投稿を取り消しますか？')) return;
    await api.delete(`/social/posts/${id}`);
    load();
  };

  if (!accounts) return <p className="p-8">読み込み中...</p>;
  const connectedPlatforms = accounts.filter((a) => a.connected).map((a) => a.platform);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">SNS連携・予約投稿</h1>
        <p className="text-sm text-gray-500 mb-6">
          X・Instagram・Facebook・YouTube・TikTokに、複数プラットフォーム同時の予約投稿ができます。
        </p>

        <section className="bg-white border rounded-xl p-6 mb-6">
          <h2 className="font-bold mb-4">アカウント連携</h2>
          {connectedNotice && <p className="text-green-700 text-sm mb-3">{connectedNotice}</p>}
          {connectError && <p className="text-red-600 text-sm mb-3">{connectError}</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            {accounts.map((a) => (
              <div key={a.platform} className="border rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="font-bold">{a.label}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {a.connected ? (a.accountLabel || '連携済み') : a.configured ? '未連携' : '準備中'}
                  </p>
                </div>
                {a.connected ? (
                  <button onClick={() => disconnect(a.platform)} className="text-sm text-red-600 font-bold">解除</button>
                ) : (
                  <button onClick={() => connect(a.platform)} disabled={!a.configured}
                    className="text-sm text-blue-600 font-bold disabled:text-gray-300">連携する</button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border rounded-xl p-6 mb-6">
          <h2 className="font-bold mb-4">投稿を予約する</h2>
          {connectedPlatforms.length === 0 ? (
            <p className="text-sm text-gray-500">先に、上でアカウントを連携してください。</p>
          ) : (
            <form onSubmit={schedule} className="space-y-4">
              <div>
                <label className="text-sm font-bold block mb-1">投稿文</label>
                <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)}
                  className="w-full p-3 border rounded-lg" placeholder="投稿する内容を入力してください" />
              </div>
              <div>
                <label className="text-sm font-bold block mb-1">動画URL（Instagram・YouTube・TikTokは必須）</label>
                <input type="url" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)}
                  className="w-full p-3 border rounded-lg" placeholder="https://..." />
              </div>
              <div>
                <label className="text-sm font-bold block mb-2">投稿先</label>
                <div className="flex flex-wrap gap-3">
                  {accounts.filter((a) => a.connected).map((a) => (
                    <label key={a.platform} className="flex items-center gap-2 text-sm border rounded-full px-4 py-2 cursor-pointer">
                      <input type="checkbox" checked={platforms.includes(a.platform)} onChange={() => togglePlatform(a.platform)} />
                      {a.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-bold block mb-1">投稿日時</label>
                <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full p-3 border rounded-lg" />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button type="submit" disabled={saving} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold disabled:opacity-50">
                {saving ? '予約中…' : 'この内容で予約する'}
              </button>
            </form>
          )}
        </section>

        <section className="bg-white border rounded-xl p-6">
          <h2 className="font-bold mb-4">予約・投稿履歴</h2>
          {posts.length === 0 ? (
            <p className="text-sm text-gray-500">まだ予約はありません。</p>
          ) : (
            <div className="space-y-3">
              {posts.map((p) => {
                const s = STATUS_LABEL[p.status] || STATUS_LABEL.failed;
                return (
                  <div key={p.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${s.className}`}>{s.text}</span>
                        <span className="text-xs text-gray-500 ml-2">{new Date(p.scheduledAt).toLocaleString('ja-JP')}</span>
                        <p className="mt-2 text-sm">{p.text}</p>
                        <p className="text-xs text-gray-500 mt-1">{p.platforms.join('、')}</p>
                      </div>
                      {p.status === 'pending' && (
                        <button onClick={() => cancel(p.id)} className="text-xs text-red-600 font-bold whitespace-nowrap">取り消す</button>
                      )}
                    </div>
                    {p.results && (
                      <details className="mt-2">
                        <summary className="text-xs text-gray-400 cursor-pointer">実行結果を見る</summary>
                        <pre className="text-xs bg-gray-50 p-2 rounded mt-1 overflow-x-auto">{JSON.stringify(p.results, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
