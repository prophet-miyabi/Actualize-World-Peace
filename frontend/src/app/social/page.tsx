'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { STATUS_LABEL, TARGET_LABEL } from '@/lib/social';

// SNS連携のハブ: アカウントの連携状態、外部SNSからの取り込み（手動・自動）、直近の配信結果。
// 「いつ・何を・どこへ」投稿するかはカレンダー（/social/schedule）で決める。
type AccountRow = { platform: string; label: string; connected: boolean; accountLabel: string | null; configured: boolean; status: string | null; expiresAt: string | null; syncEnabled: boolean; syncSupported: boolean; lastSyncAt: string | null; lastError: string | null };
type Post = { id: string; text: string; media: string | null; platforms: string[]; scheduledAt: string; status: string; attempts: number; results: any; lastError: string | null; postedIds: Record<string, string> | null };

export default function Social() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [notice, setNotice] = useState('');
  const [connectError, setConnectError] = useState('');
  const [busy, setBusy] = useState('');

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
    if (connected) { load(); setNotice(`${connected}と連携しました。`); }
    if (err) setConnectError(err);
    if (connected || err) window.history.replaceState({}, '', '/social');
  }, [load]);
  useEffect(() => {
    if (!posts.some((p) => p.status === 'pending' || p.status === 'processing')) return;
    const t = setInterval(() => { api.get('/social/posts').then((r) => setPosts(r.data.posts)).catch(() => {}); }, 10000);
    return () => clearInterval(t);
  }, [posts]);

  const connect = (platform: string) => {
    setConnectError('');
    const token = localStorage.getItem('token') || '';
    window.location.href = `/api/social/${platform}/connect?token=${encodeURIComponent(token)}`;
  };
  const disconnect = async (platform: string) => {
    if (!window.confirm('連携を解除しますか？')) return;
    await api.delete(`/social/${platform}`);
    load();
  };
  const sync = async (platform: string) => {
    setBusy(platform); setNotice(''); setConnectError('');
    try {
      const { data } = await api.post(`/social/${platform}/sync`);
      setNotice(`${TARGET_LABEL[platform]} から ${data.result.imported} 件を取り込みました（既に取り込み済み ${data.result.skipped} 件）。フィードとページに反映されます。`);
      await load();
    } catch (e: any) { setConnectError(e?.response?.data?.error || '取り込みに失敗しました。'); } finally { setBusy(''); }
  };
  const toggleSync = async (platform: string, on: boolean) => {
    await api.put(`/social/${platform}/settings`, { syncEnabled: on }).catch(() => {});
    load();
  };
  const retry = async (id: string) => { await api.post(`/social/posts/${id}/retry`).catch(() => {}); load(); };
  const cancel = async (id: string) => { if (!window.confirm('この予約を取り消しますか？')) return; await api.delete(`/social/posts/${id}`).catch(() => {}); load(); };

  if (!accounts) return <p className="p-8">読み込み中...</p>;

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4 pb-24">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">SNS連携</h1>
        <p className="text-sm text-gray-500 mb-5">Instagram・X・TikTok の投稿を AWP に取り込み、AWP からは各SNSへ同時に配信できます。</p>

        <Link href="/social/schedule" className="block rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white p-5 shadow-lg mb-6">
          <p className="text-lg font-black">📅 カレンダーで投稿を予約する</p>
          <p className="text-sm opacity-90 mt-1">日付を選んで、AWP・Instagram・X・TikTok へ同時に配信。写真や縦動画も付けられます。</p>
        </Link>

        <div className="rounded-2xl bg-white border p-4 mb-6 text-sm">
          <p className="font-bold">1回の投稿で X / Instagram / TikTok / YouTube（ショート）/ AWP に同時配信</p>
          <p className="text-xs text-gray-600 mt-1">カレンダーで文面と動画を1回つくると、選んだ媒体すべてに同じ時刻で配信します。YouTube は縦動画がショートとして投稿されます（Google の連携が未設定のときは失敗として残り、配信の履歴に理由が出ます）。</p>
          <Link href="/social/schedule" className="inline-block mt-2 text-xs font-bold text-violet-700">まとめて投稿する →</Link>
        </div>
        <section className="bg-white border rounded-2xl p-5 mb-6">
          <h2 className="font-bold mb-3">アカウント連携と取り込み</h2>
          {notice && <p className="text-green-700 text-sm mb-3">{notice}</p>}
          {connectError && <p className="text-red-600 text-sm mb-3">{connectError}</p>}
          <div className="grid sm:grid-cols-2 gap-3">
            {accounts.map((a) => (
              <div key={a.platform} className="border rounded-xl p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold">{a.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      {a.connected ? (a.accountLabel || '連携済み') : a.configured ? '未連携' : '準備中（運営者が接続設定中）'}
                      {a.connected && a.status === 'expired' && <span className="ml-1 text-red-600 font-bold">有効期限切れ・再連携してください</span>}
                      {a.connected && a.status === 'error' && a.lastError && <span className="ml-1 text-amber-700">直近のエラー: {a.lastError.slice(0, 60)}</span>}
                    </p>
                  </div>
                  {a.connected ? (
                    <div className="flex gap-2 shrink-0">
                      {a.status === 'expired' && <button onClick={() => connect(a.platform)} className="text-xs text-blue-600 font-bold">再連携</button>}
                      <button onClick={() => disconnect(a.platform)} className="text-xs text-red-600 font-bold">解除</button>
                    </div>
                  ) : (
                    <button onClick={() => connect(a.platform)} disabled={!a.configured} className="text-sm text-blue-600 font-bold disabled:text-gray-300 shrink-0">連携する</button>
                  )}
                </div>
                {a.connected && a.syncSupported && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <button disabled={!!busy} onClick={() => sync(a.platform)} className="rounded-full bg-gray-900 text-white font-bold px-3 py-1.5 disabled:opacity-40">{busy === a.platform ? '取り込み中…' : '投稿を取り込む'}</button>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={a.syncEnabled} onChange={(e) => toggleSync(a.platform, e.target.checked)} />1時間ごとに自動で取り込む</label>
                    {a.lastSyncAt && <span className="text-gray-400">最終: {new Date(a.lastSyncAt).toLocaleString('ja-JP')}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-500 mt-3">取り込んだ投稿はフィード・リール・あなたのページの「最新の投稿」に並びます。動画は本体を保存せず、元の投稿へのリンクとサムネイルで表示します。</p>
        </section>

        <section className="bg-white border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3"><h2 className="font-bold">配信の履歴</h2><Link href="/social/schedule" className="text-xs text-violet-700 font-bold">カレンダーを開く →</Link></div>
          {posts.length === 0 ? <p className="text-sm text-gray-500">まだ予約はありません。</p> : (
            <div className="space-y-3">
              {posts.map((p) => {
                const s = STATUS_LABEL[p.status] || STATUS_LABEL.failed;
                return (
                  <div key={p.id} className="border rounded-xl p-4">
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0">
                        <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${s.className}`}>{s.text}</span>
                        <span className="text-xs text-gray-500 ml-2">{new Date(p.scheduledAt).toLocaleString('ja-JP')}</span>
                        <p className="mt-2 text-sm whitespace-pre-wrap break-words">{p.text}</p>
                        <p className="text-xs text-gray-500 mt-1">{p.platforms.map((x) => `${TARGET_LABEL[x] ?? x}${p.postedIds?.[x] ? ' ✓' : ''}`).join('・')}</p>
                        {p.lastError && <p className="text-xs text-red-600 mt-1">{p.lastError}</p>}
                      </div>
                      <div className="flex flex-col gap-1 shrink-0">
                        {p.status === 'pending' && <button onClick={() => cancel(p.id)} className="text-xs text-red-600 font-bold">取り消す</button>}
                        {(p.status === 'failed' || p.status === 'partial') && <button onClick={() => retry(p.id)} className="text-xs text-blue-600 font-bold">再試行</button>}
                      </div>
                    </div>
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
