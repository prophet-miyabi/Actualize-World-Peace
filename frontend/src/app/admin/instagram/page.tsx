'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import AiHealthBanner from '@/components/admin/AiHealthBanner';

type Profile = { id: string; username: string | null; name: string | null; followers: number | null; follows: number | null; mediaCount: number | null; pictureUrl: string | null; biography: string | null; website: string | null } | { error: string };
type Media = { id: string; caption: string; mediaType: string; mediaUrl: string | null; thumbnailUrl: string | null; permalink: string | null; timestamp: string | null; likes: number | null; comments: number | null };
type Queued = { id: string; text: string; mediaUrl: string | null; scheduledAt: string; status: string; attempts: number; results: any; createdAt: string };
type AwpMedia = { id: string; by: string | null; kind: string; body: string; mediaUrl: string; awpUrl: string };
type Overview =
  | { connected: false; awpMedia: AwpMedia[]; publicBaseSet: boolean }
  | { connected: true; account: { username: string | null; externalId: string | null; expiresAt: string | null; connectedAt: string }; autoPublish: boolean; profile: Profile; media: Media[]; insights: Record<string, number>; queue: Queued[]; awpMedia: AwpMedia[]; publicBaseSet: boolean };

const STATUS: Record<string, string> = { draft: '承認待ち', pending: '予約済み', processing: '投稿中', done: '公開済み', failed: '失敗', rejected: '却下' };
const INSIGHT: Record<string, string> = { reach: 'リーチ', profile_views: 'プロフィール表示', accounts_engaged: '反応したアカウント', total_interactions: '反応の合計' };
const fmt = (iso: string) => new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const toLocalInput = (iso: string) => { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

// AWP 公式 Instagram の運用。AWP企業の「SNS担当（Instagram）」が投稿を作り、ここで承認して公開する
export default function InstagramAdminPage() {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ id: string; text: string; when: string } | null>(null);
  const [manual, setManual] = useState<{ caption: string; mediaUrl: string; when: string }>({ caption: '', mediaUrl: '', when: '' });
  const [showGuide, setShowGuide] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get('/social/instagram/overview');
    setO(data);
  }, []);
  useEffect(() => { load().catch(() => setError('読み込みに失敗しました。')); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(''); setMsg('');
    try { await fn(); setMsg(ok); await load(); } catch (e: any) { setError(e?.response?.data?.error ?? '失敗しました。'); } finally { setBusy(false); }
  };

  if (!o) return <main className="p-6 text-sm text-gray-500">{error || '読み込み中…'}</main>;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <AiHealthBanner />
      <div>
        <h1 className="text-2xl font-bold">Instagram運用（AWP公式）</h1>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">
          AWP企業の「SNS担当（Instagram）」が、実例・コツ・使い方・AWPの考え方の4本柱で投稿を作ります。作った投稿はここで承認すると予約に入り、予約投稿の仕組みで公開されます。事実でない数字・限定表現はコンプライアンス審査で止まります。
        </p>
      </div>
      {msg && <p className="text-sm text-green-700 bg-green-50 rounded-xl px-3 py-2">{msg}</p>}
      {error && <p className="text-sm text-red-700 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
      {!o.publicBaseSet && <p className="text-sm text-yellow-800 bg-yellow-50 rounded-xl px-3 py-2">PUBLIC_BASE_URL が未設定です。Instagram は公開URLから画像を取りに来るため、投稿にはこの設定が必要です（Render の環境変数）。</p>}

      {/* 連携 */}
      <section className="bg-white border rounded-2xl p-5">
        <h2 className="font-bold">連携</h2>
        {o.connected ? (
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {'error' in o.profile ? <p className="text-sm text-red-700">プロフィールを取得できません: {o.profile.error}（トークンの期限切れの可能性。下で貼り直せます）</p> : (
              <>
                {o.profile.pictureUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.profile.pictureUrl} alt="" className="w-14 h-14 rounded-full object-cover" />
                )}
                <div>
                  <p className="font-bold">@{o.profile.username ?? o.account.username}{o.profile.name ? <span className="text-gray-500 font-normal ml-2">{o.profile.name}</span> : null}</p>
                  <p className="text-sm text-gray-600 mt-0.5">フォロワー {o.profile.followers ?? '-'} ・ フォロー中 {o.profile.follows ?? '-'} ・ 投稿 {o.profile.mediaCount ?? '-'}</p>
                  {o.profile.website && <p className="text-xs text-gray-500">リンク: {o.profile.website}</p>}
                </div>
              </>
            )}
            <div className="ml-auto text-xs text-gray-500">
              トークン期限 {o.account.expiresAt ? new Date(o.account.expiresAt).toLocaleDateString('ja-JP') : '不明'}
              <button type="button" disabled={busy} onClick={() => run(() => api.post('/social/instagram/refresh'), 'トークンを更新しました')} className="ml-2 underline text-blue-600">更新</button>
            </div>
          </div>
        ) : <p className="text-sm text-gray-600 mt-2">まだ連携されていません。下の手順でトークンを発行して貼り付けてください。</p>}

        <details className="mt-4" open={!o.connected || showGuide} onToggle={(e) => setShowGuide((e.target as HTMLDetailsElement).open)}>
          <summary className="text-sm font-bold cursor-pointer text-blue-700">連携のしかた（Meta for Developers でトークンを発行 → 貼り付け）</summary>
          <ol className="mt-2 text-sm text-gray-700 space-y-1.5 list-decimal pl-5 leading-relaxed">
            <li>Instagram アプリで、AWP公式アカウントを「プロアカウント（ビジネス or クリエイター）」にする（設定 → アカウントの種類とツール）。</li>
            <li><a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer" className="underline">developers.facebook.com/apps</a> で「アプリを作成」→ 用途は「その他」→ 種類は「ビジネス」。</li>
            <li>作ったアプリのダッシュボードで「Instagram」を追加 → 「API setup with Instagram login」を開く。</li>
            <li>「1. Add Instagram account」でAWP公式アカウントを追加（Instagram にログインして許可）。</li>
            <li>「2. Generate access tokens」の「Generate token」を押し、表示された長期トークン（60日有効）をコピー。</li>
            <li>下の欄に貼り付けて「連携する」。期限が近づくと自動で更新します（更新できなかった場合はもう一度ここで貼り直し）。</li>
          </ol>
          <p className="text-xs text-gray-500 mt-2">OAuth（ボタン1つで連携）にするには Render に INSTAGRAM_CLIENT_ID / INSTAGRAM_CLIENT_SECRET（同じアプリの「Instagram app ID / secret」）と、アプリ側にリダイレクトURI <code>{'{PUBLIC_BASE_URL}'}/api/social/instagram/callback</code> を設定します。</p>
          <form className="mt-3 flex flex-col sm:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api.post('/social/instagram/manual', { accessToken: token }).then(() => setToken('')), '連携しました'); }}>
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="長期アクセストークンを貼り付け" className="flex-1 border rounded-lg px-3 py-2 text-sm" autoComplete="off" />
            <button type="submit" disabled={busy || !token.trim()} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold text-sm disabled:opacity-50">{o.connected ? '貼り直して連携' : '連携する'}</button>
          </form>
        </details>
      </section>

      {o.connected && (
        <>
          {/* 運用の設定と実行 */}
          <section className="bg-white border rounded-2xl p-5 flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={o.autoPublish} disabled={busy} onChange={(e) => run(() => api.put('/social/instagram/settings', { autoPublish: e.target.checked }), e.target.checked ? '自動公開をオンにしました（承認なしで予約に入ります）' : '自動公開をオフにしました（承認待ちになります）')} />
              自動公開（オフ: SNS担当の投稿はここで承認してから公開）
            </label>
            <button type="button" disabled={busy} onClick={() => run(() => api.post('/social/instagram/plan'), 'SNS担当に投稿計画を依頼しました。数分で下書きが届きます（AWP企業の画面でも進み具合を見られます）')}
              className="ml-auto px-4 py-2 rounded-full bg-violet-600 text-white font-bold text-sm">今すぐ投稿を作らせる</button>
            <Link href="/admin/company" className="text-sm text-blue-600 underline">AWP企業の画面へ</Link>
          </section>

          {/* インサイト */}
          {Object.keys(o.insights).length > 0 && (
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.entries(o.insights).map(([k, v]) => (
                <div key={k} className="bg-white border rounded-2xl p-4"><p className="text-xs text-gray-500">{INSIGHT[k] ?? k}（7日）</p><p className="text-2xl font-black mt-1">{v.toLocaleString()}</p></div>
              ))}
            </section>
          )}

          {/* 予約列 */}
          <section className="bg-white border rounded-2xl p-5">
            <h2 className="font-bold">投稿の予約列 <span className="text-sm text-gray-500 font-normal">承認待ち {o.queue.filter((q) => q.status === 'draft').length} ・ 予約済み {o.queue.filter((q) => q.status === 'pending').length}</span></h2>
            {o.queue.length === 0 ? <p className="text-sm text-gray-500 mt-2">まだありません。「今すぐ投稿を作らせる」か、下の手動投稿から。</p> : (
              <ul className="mt-3 divide-y">
                {o.queue.map((q) => (
                  <li key={q.id} className="py-3 flex gap-3">
                    {q.mediaUrl && (/\/video(\?|$)|\.(mp4|mov|webm)(\?|$)/i.test(q.mediaUrl)
                      ? <video src={q.mediaUrl} muted playsInline preload="metadata" className="w-20 h-20 rounded-lg object-cover bg-black shrink-0" />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={q.mediaUrl} alt="" className="w-20 h-20 rounded-lg object-cover bg-gray-100 shrink-0" />)}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs flex flex-wrap items-center gap-2">
                        <span className={`font-bold px-2 py-0.5 rounded-full ${q.status === 'draft' ? 'bg-amber-100 text-amber-800' : q.status === 'pending' ? 'bg-blue-100 text-blue-800' : q.status === 'done' ? 'bg-green-100 text-green-800' : q.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>{STATUS[q.status] ?? q.status}</span>
                        <span className="text-gray-500">{fmt(q.scheduledAt)}</span>
                        {q.results?.by && <span className="text-gray-400">{String(q.results.by).replace('agent:', 'SNS担当: ')}</span>}
                        {q.status === 'failed' && q.results && <span className="text-red-600 truncate">{JSON.stringify(Object.values(q.results).at(-1) ?? '').slice(0, 160)}</span>}
                      </p>
                      {edit?.id === q.id ? (
                        <div className="mt-2 space-y-2">
                          <textarea value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} rows={6} className="w-full border rounded-lg p-2 text-sm" />
                          <div className="flex flex-wrap gap-2 items-center">
                            <input type="datetime-local" value={edit.when} onChange={(e) => setEdit({ ...edit, when: e.target.value })} className="border rounded-lg px-2 py-1 text-sm" />
                            <button type="button" disabled={busy} onClick={() => run(() => api.post(`/social/instagram/posts/${q.id}/approve`, { text: edit.text, scheduledAt: new Date(edit.when).toISOString() }).then(() => setEdit(null)), '承認して予約に入れました')} className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-bold">この内容で承認</button>
                            <button type="button" onClick={() => setEdit(null)} className="px-3 py-1.5 rounded-lg border text-sm">やめる</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap mt-1 line-clamp-6">{q.text}</p>
                      )}
                      {edit?.id !== q.id && (
                        <p className="mt-2 flex gap-3 text-xs font-bold">
                          {(q.status === 'draft' || q.status === 'rejected') && <button type="button" disabled={busy} onClick={() => run(() => api.post(`/social/instagram/posts/${q.id}/approve`), '承認して予約に入れました')} className="text-green-700">承認</button>}
                          {(q.status === 'draft' || q.status === 'rejected') && <button type="button" onClick={() => setEdit({ id: q.id, text: q.text, when: toLocalInput(q.scheduledAt) })} className="text-blue-700">直して承認</button>}
                          {(q.status === 'draft' || q.status === 'pending') && <button type="button" disabled={busy} onClick={() => run(() => api.post(`/social/instagram/posts/${q.id}/reject`), q.status === 'pending' ? '予約を取り消しました' : '却下しました')} className="text-red-600">{q.status === 'pending' ? '予約を取り消す' : '却下'}</button>}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 手動投稿 */}
          <section className="bg-white border rounded-2xl p-5">
            <h2 className="font-bold">手動で投稿を入れる</h2>
            <p className="text-xs text-gray-500 mt-1">メディアは AWP の投稿（下の一覧から選択）か、AWP が配信しているURLだけ使えます。審査に通ると予約に入ります。</p>
            <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); run(() => api.post('/social/instagram/queue', { caption: manual.caption, mediaUrl: manual.mediaUrl, scheduledAt: manual.when ? new Date(manual.when).toISOString() : null }).then(() => setManual({ caption: '', mediaUrl: '', when: '' })), '予約列に入れました'); }}>
              <textarea value={manual.caption} onChange={(e) => setManual({ ...manual, caption: e.target.value })} rows={5} placeholder="キャプション（ハッシュタグ含む）" className="w-full border rounded-lg p-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                <input value={manual.mediaUrl} onChange={(e) => setManual({ ...manual, mediaUrl: e.target.value })} placeholder="メディアURL（下の一覧をクリックで入力）" className="flex-1 min-w-[240px] border rounded-lg px-2 py-1.5 text-sm" />
                <input type="datetime-local" value={manual.when} onChange={(e) => setManual({ ...manual, when: e.target.value })} className="border rounded-lg px-2 py-1 text-sm" />
                <button type="submit" disabled={busy || !manual.caption.trim() || !manual.mediaUrl} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-50">予約列に入れる</button>
              </div>
            </form>
            {o.awpMedia.length > 0 && (
              <div className="mt-3 grid grid-cols-4 sm:grid-cols-6 gap-2">
                {o.awpMedia.map((m) => (
                  <button key={m.id} type="button" onClick={() => setManual((s) => ({ ...s, mediaUrl: m.mediaUrl }))} title={m.body} className={`relative aspect-square rounded-lg overflow-hidden border-2 ${manual.mediaUrl === m.mediaUrl ? 'border-blue-500' : 'border-transparent'}`}>
                    {m.kind === 'video' ? <video src={m.mediaUrl} muted playsInline preload="metadata" className="w-full h-full object-cover bg-black" />
                      // eslint-disable-next-line @next/next/no-img-element
                      : <img src={m.mediaUrl} alt="" className="w-full h-full object-cover" />}
                    <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white rounded px-1">{m.kind === 'video' ? 'リール' : '写真'}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* 最近の投稿 */}
          <section className="bg-white border rounded-2xl p-5">
            <h2 className="font-bold">Instagram の最近の投稿</h2>
            {o.media.length === 0 ? <p className="text-sm text-gray-500 mt-2">まだ投稿がありません。</p> : (
              <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
                {o.media.map((m) => (
                  <a key={m.id} href={m.permalink ?? '#'} target="_blank" rel="noopener noreferrer" className="block">
                    <div className="aspect-square rounded-lg overflow-hidden bg-gray-100">
                      {(m.thumbnailUrl || m.mediaUrl) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.thumbnailUrl || m.mediaUrl || ''} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">♥ {m.likes ?? 0} ・ 💬 {m.comments ?? 0}</p>
                  </a>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
