'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Kind = 'x' | 'instagram';
type LinkInfo = { kind: Kind; baseUrl: string; accountId: string | null; accountLabel: string | null };
type Post = { id: string; kind: Kind; text: string; scheduledAt: string; status: 'scheduled' | 'canceled' | 'failed'; error: string | null };

const LABEL: Record<Kind, string> = { x: 'X（X Harness）', instagram: 'Instagram（IG Harness）' };
const STATUS: Record<Post['status'], string> = { scheduled: '予約済み', canceled: '取り消し', failed: '失敗' };

const localNow = (addMin: number) => {
  const d = new Date(Date.now() + addMin * 60_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

// 自分のX Harness / IG Harnessとつないで、AWPから投稿を予約する。
// AIの下書きは、ページに登録済みの事実だけで作り、審査AIのチェック結果も表示する
export default function HarnessPostPage() {
  const [links, setLinks] = useState<LinkInfo[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [kind, setKind] = useState<Kind>('x');
  const [form, setForm] = useState({ baseUrl: '', apiKey: '' });
  const [accounts, setAccounts] = useState<{ id: string; label: string }[] | null>(null);
  const [text, setText] = useState('');
  const [when, setWhen] = useState(localNow(60));
  const [review, setReview] = useState<{ approved: boolean; reason: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/harness-link');
    setLinks(data.links);
    setPosts(data.posts);
  }, []);
  useEffect(() => { load().catch(() => setError('読み込めませんでした。')); }, [load]);

  const link = links.find((l) => l.kind === kind);
  useEffect(() => { setAccounts(null); setForm({ baseUrl: link?.baseUrl ?? '', apiKey: '' }); setError(''); setMsg(''); }, [kind, link?.baseUrl]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setError('');
    setMsg('');
    try { await fn(); } catch (e: any) { setError(e?.response?.data?.error || 'うまくいきませんでした。'); } finally { setBusy(''); }
  };

  const check = () => run('check', async () => {
    const { data } = await api.put(`/harness-link/${kind}`, form);
    setAccounts(data.accounts);
    if (data.accounts.length === 0) setError('Harnessにアカウントがまだ登録されていません。先にHarnessの管理画面で登録してください。');
  });
  const choose = (accountId: string) => run('save', async () => {
    await api.put(`/harness-link/${kind}`, { ...form, accountId });
    setAccounts(null);
    setMsg('接続しました！');
    await load();
  });
  const disconnect = () => run('disconnect', async () => {
    if (!confirm('接続を解除しますか？（Harness側の予約は消えません）')) return;
    await api.delete(`/harness-link/${kind}`);
    await load();
  });
  const draft = () => run('draft', async () => {
    const { data } = await api.post(`/harness-link/${kind}/draft`, {});
    setText(data.text);
    setReview(data.review);
  });
  const schedule = () => run('schedule', async () => {
    await api.post(`/harness-link/${kind}/schedule`, { text, scheduledAt: new Date(when).toISOString() });
    setText('');
    setReview(null);
    setMsg('予約しました！指定した時間にHarnessから投稿されます。');
    await load();
  });
  const cancel = (p: Post) => run('cancel', async () => {
    if (!confirm('この予約を取り消しますか？')) return;
    await api.delete(`/harness-link/posts/${p.id}`);
    await load();
  });

  const input = 'mt-1 w-full border rounded-xl px-3 py-2.5 text-base bg-white';

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <Link href="/harness" className="text-sm text-violet-700 font-bold">← Harness</Link>
        <div>
          <h1 className="text-2xl font-black">AWPから予約投稿</h1>
          <p className="text-xs text-gray-500 mt-1">あなたが導入したX Harness・IG HarnessとつないでAWPから予約できます。投稿するのはあなたのHarnessです。</p>
        </div>

        <div className="flex gap-2">
          {(['x', 'instagram'] as Kind[]).map((k) => (
            <button key={k} onClick={() => setKind(k)}
              className={`flex-1 rounded-full py-2 text-sm font-bold ${kind === k ? 'bg-gray-900 text-white' : 'bg-white border text-gray-600'}`}>
              {k === 'x' ? 'X' : 'Instagram'}{links.some((l) => l.kind === k) ? ' ✓' : ''}
            </button>
          ))}
        </div>

        <section className="bg-white border rounded-2xl p-4 space-y-3">
          <h2 className="font-black">{LABEL[kind]}との接続</h2>
          {link && !accounts ? (
            <div className="text-sm">
              <p>接続中: <span className="font-bold">{link.accountLabel}</span></p>
              <p className="text-xs text-gray-500 break-all">{link.baseUrl}</p>
              <div className="flex gap-3 mt-2 text-xs">
                <button onClick={() => setAccounts([])} className="text-violet-700 underline">つなぎ直す</button>
                <button onClick={disconnect} className="text-gray-500 underline">解除</button>
              </div>
            </div>
          ) : (
            <>
              <label className="block text-sm font-bold">HarnessのURL
                <input className={input} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://〇〇.workers.dev" inputMode="url" autoCapitalize="none" />
              </label>
              <label className="block text-sm font-bold">APIキー
                <input className={input} type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} autoComplete="off" placeholder={link ? '変更しない場合は空欄' : ''} />
              </label>
              <p className="text-[11px] text-gray-500">APIキーは暗号化して保存し、予約の送信にだけ使います。閲覧専用（viewer）のキーでは予約できません。</p>
              <button onClick={check} disabled={!!busy || !form.baseUrl} className="w-full rounded-full bg-gray-900 text-white font-bold py-3 text-sm disabled:opacity-40">{busy === 'check' ? '確認中…' : '接続を確認する'}</button>
              {accounts && accounts.length > 0 && (
                <div>
                  <p className="text-sm font-bold">投稿するアカウントを選んでね</p>
                  <ul className="mt-2 space-y-2">
                    {accounts.map((a) => (
                      <li key={a.id}><button onClick={() => choose(a.id)} disabled={!!busy} className="w-full text-left rounded-xl border px-4 py-3 text-sm font-bold hover:bg-violet-50">{a.label}</button></li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        {link && (
          <section className="bg-white border rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-black">投稿をつくる</h2>
              <button onClick={draft} disabled={!!busy} className="rounded-full bg-violet-50 text-violet-700 text-xs font-bold px-3 py-2">{busy === 'draft' ? '作成中…' : '✨ AIに下書きしてもらう'}</button>
            </div>
            <textarea className={input} rows={6} value={text} onChange={(e) => { setText(e.target.value); setReview(null); }} maxLength={kind === 'x' ? 280 : 2200}
              placeholder={kind === 'x' ? 'Xに投稿する文章（280文字まで）' : 'Instagramのキャプション（画像はページのメイン画像を使います）'} />
            <p className="text-[11px] text-gray-400 text-right">{text.length}/{kind === 'x' ? 280 : 2200}</p>
            {review && (
              <p className={`text-xs rounded-xl p-3 ${review.approved ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                {review.approved ? '✅ 審査AI: 問題なし' : '⚠ 審査AI: 見直しをおすすめ'} — {review.reason}
              </p>
            )}
            <label className="block text-sm font-bold">投稿する日時<input type="datetime-local" className={input} value={when} min={localNow(1)} onChange={(e) => setWhen(e.target.value)} /></label>
            <button onClick={schedule} disabled={!!busy || !text.trim()} className="w-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold py-3.5 disabled:opacity-40">
              {busy === 'schedule' ? '予約中…' : 'この内容で予約する'}
            </button>
            <p className="text-[11px] text-gray-500">事実と違う実績・価格・限定表示は書かないでね。送信前に内容を必ず確認してください。</p>
          </section>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-green-700">{msg}</p>}

        {posts.length > 0 && (
          <section>
            <h2 className="font-bold text-sm mb-2">予約の履歴</h2>
            <ul className="bg-white border rounded-2xl divide-y">
              {posts.map((p) => (
                <li key={p.id} className="px-4 py-3 text-sm">
                  <div className="flex justify-between gap-2 text-xs text-gray-500">
                    <span>{p.kind === 'x' ? 'X' : 'Instagram'}・{new Date(p.scheduledAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className={p.status === 'failed' ? 'text-red-600' : ''}>{STATUS[p.status]}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 break-words">{p.text}</p>
                  {p.error && <p className="text-xs text-red-600 mt-1">{p.error}</p>}
                  {p.status === 'scheduled' && new Date(p.scheduledAt).getTime() > Date.now() && (
                    <button onClick={() => cancel(p)} className="text-xs text-gray-500 underline mt-1">取り消す</button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
