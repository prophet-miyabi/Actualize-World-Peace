'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import Thinking from '@/components/Thinking';

type Status = 'provided' | 'confirmed' | 'assumed' | 'default' | 'unconfirmed';
type Fact = { key: string; value: string; status: Status };
type Brief = {
  purpose: { value: 'business' | 'creator'; status: Status };
  facts: Fact[];
  copy: { heroTitle: string; strengths: string[]; status: Status } | null;
  suggestedSlug: string;
};
type Session = {
  id: string; status: string; lpId: string | null;
  messages: { role: 'user' | 'assistant'; content: string }[];
  brief: Brief;
  meta: Record<string, { label: string; required?: boolean; sensitive?: boolean }>;
};

const STATUS: Record<Status, { label: string; cls: string }> = {
  confirmed: { label: '確定', cls: 'bg-green-100 text-green-700' },
  provided: { label: 'あなたが言った', cls: 'bg-sky-100 text-sky-700' },
  assumed: { label: 'AIの推測', cls: 'bg-amber-100 text-amber-700' },
  default: { label: '既定', cls: 'bg-gray-100 text-gray-600' },
  unconfirmed: { label: '未確認', cls: 'bg-gray-100 text-gray-400' }
};
const PUBLISHABLE: Status[] = ['confirmed', 'default'];

// 対話で作るページビルダー。左右に切り替える2画面: 「おしゃべり」（聞き取り）と「確認して公開」（事実の台帳）
export default function BuilderPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'chat' | 'check'>('chat');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [copyDraft, setCopyDraft] = useState<{ heroTitle: string; strengths: string[] } | null>(null);
  const [slug, setSlug] = useState('');
  const [published, setPublished] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get('/builder/sessions/current')
      .then(async ({ data }) => {
        if (data.session) setSession(data.session);
        else setSession((await api.post('/builder/sessions')).data.session);
      })
      .catch(() => setError('読み込めませんでした。'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [session?.messages.length, tab]);
  useEffect(() => { if (session?.brief.suggestedSlug && !slug) setSlug(session.brief.suggestedSlug); }, [session?.brief.suggestedSlug, slug]);

  const run = async (fn: () => Promise<{ data: { session: Session } }>) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await fn();
      setSession(data.session);
      return true;
    } catch (e: any) {
      setError(e?.response?.data?.error || 'うまくいきませんでした。');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy || !session) return;
    setInput('');
    // 送った内容はすぐ画面に出す（AIの返事を待つ間も会話が見えるように）
    setSession({ ...session, messages: [...session.messages, { role: 'user', content: text }] });
    const ok = await run(() => api.post(`/builder/sessions/${session.id}/messages`, { text }));
    if (!ok) setSession(session);
  };

  const saveFact = (key: string, value: string) =>
    run(() => api.put(`/builder/sessions/${session!.id}/brief`, { action: 'fact', key, value })).then(() => setEditing(null));
  const saveCopy = () =>
    run(() => api.put(`/builder/sessions/${session!.id}/brief`, { action: 'copy', ...copyDraft })).then((ok) => ok && setCopyDraft(null));
  const confirmAll = () => run(() => api.put(`/builder/sessions/${session!.id}/brief`, { action: 'confirm_all' }));
  const restart = async () => {
    if (!confirm('最初からやり直しますか？（いまの会話は消えます）')) return;
    setSlug('');
    await run(() => api.post('/builder/sessions'));
    setTab('chat');
  };

  const publish = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/builder/sessions/${session!.id}/publish`, { slug });
      setPublished(data.lp.slug);
    } catch (e: any) {
      setError(e?.response?.data?.error || '公開できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <main className="p-6 text-sm text-gray-400">読み込み中…</main>;
  if (!session) return <main className="p-6 text-sm text-red-600">{error}</main>;

  if (published) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-sky-50 flex flex-col items-center justify-center p-6 text-center">
        <p className="text-5xl" aria-hidden>🎉</p>
        <h1 className="text-2xl font-black mt-3">公開したよ！</h1>
        <p className="text-sm text-gray-600 mt-2">デザインと、料金・営業時間などのページは裏で仕上げ中。数十秒で反映されるよ。</p>
        <Link href={`/${published}`} className="mt-6 w-full max-w-xs rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold py-3.5">ページを見る</Link>
        <Link href="/dashboard" className="mt-3 text-sm text-violet-700 font-bold">ホームへ</Link>
      </main>
    );
  }

  const { brief, meta } = session;
  const factByKey = Object.fromEntries(brief.facts.map((f) => [f.key, f]));
  const keys = Object.keys(meta);
  const pending = brief.facts.filter((f) => f.value && !PUBLISHABLE.includes(f.status)).length + (brief.copy && brief.copy.status !== 'confirmed' ? 1 : 0);
  const requiredOk = keys.filter((k) => meta[k].required).every((k) => factByKey[k]?.value && PUBLISHABLE.includes(factByKey[k].status));
  const canPublish = requiredOk && brief.copy?.status === 'confirmed' && /^[a-z0-9-]{3,40}$/.test(slug);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b">
        <div className="max-w-2xl mx-auto px-4 pt-3 flex items-center justify-between">
          <Link href="/dashboard" className="text-sm text-violet-700 font-bold">← ホーム</Link>
          <p className="font-black">AIとページづくり</p>
          <button onClick={restart} className="text-xs text-gray-500 underline">やり直す</button>
        </div>
        <div className="max-w-2xl mx-auto px-4 flex">
          {(['chat', 'check'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-sm font-bold border-b-2 ${tab === t ? 'border-violet-600 text-violet-700' : 'border-transparent text-gray-500'}`}>
              {t === 'chat' ? 'おしゃべり' : '確認して公開'}
              {t === 'check' && pending > 0 && <span className="ml-1 rounded-full bg-amber-400 text-white text-[10px] px-1.5 py-0.5">{pending}</span>}
            </button>
          ))}
        </div>
      </header>

      {tab === 'chat' ? (
        <>
          <section className="flex-1 max-w-2xl w-full mx-auto px-4 py-4 space-y-3 pb-36">
            {session.messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex'}>
                <p className={`max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-violet-600 text-white rounded-br-md' : 'bg-white border rounded-bl-md'}`}>
                  {m.content}
                </p>
              </div>
            ))}
            {busy && <Thinking className="pl-2" phases={['考え中', 'ページの構成を考えています', '文章を組み立てています', 'もう少しお待ちください']} />}
            {brief.copy && (
              <button onClick={() => setTab('check')} className="w-full rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50 text-violet-700 text-sm font-bold py-3">
                ここまでの内容を確認する →
              </button>
            )}
            <div ref={bottom} />
          </section>
          <form onSubmit={(e) => { e.preventDefault(); send(); }}
            className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t px-4 py-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
            {error && <p className="text-red-600 text-xs mb-2 max-w-2xl mx-auto">{error}</p>}
            <div className="flex gap-2 max-w-2xl mx-auto">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={1000} placeholder="メッセージを入力"
                className="flex-1 border rounded-2xl px-4 py-3 text-base resize-none" />
              <button disabled={busy || !input.trim()} className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold px-5 disabled:opacity-40">送信</button>
            </div>
          </form>
        </>
      ) : (
        <section className="max-w-2xl w-full mx-auto px-4 py-4 pb-16 space-y-5">
          <div className="rounded-2xl bg-white border p-4 text-xs text-gray-600 leading-relaxed">
            ページに載るのは <span className="rounded-full px-2 py-0.5 font-bold bg-green-100 text-green-700">確定</span> の情報だけ。
            「AIの推測」や「未確認」の項目は、確定するまでページに出ないから安心してね。
          </div>

          <div>
            <p className="text-sm font-bold mb-2">ジャンル</p>
            <div className="flex gap-2">
              {(['business', 'creator'] as const).map((p) => (
                <button key={p} disabled={busy} onClick={() => run(() => api.put(`/builder/sessions/${session.id}/brief`, { action: 'purpose', value: p }))}
                  className={`rounded-full px-4 py-2 text-sm font-bold ${brief.purpose.value === p ? 'bg-violet-600 text-white' : 'bg-white border text-gray-600'}`}>
                  {p === 'business' ? 'お店・ビジネス' : 'クリエイター'}
                </button>
              ))}
            </div>
          </div>

          <ul className="bg-white border rounded-2xl divide-y">
            {keys.map((k) => {
              const f = factByKey[k] as Fact | undefined;
              const st = f?.value ? f.status : 'unconfirmed';
              return (
                <li key={k} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-gray-500">
                      {meta[k].label}{meta[k].required && <span className="text-red-500"> *</span>}
                    </p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS[st].cls}`}>{STATUS[st].label}</span>
                  </div>
                  {editing === k ? (
                    <div className="mt-2 space-y-2">
                      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={300} className="w-full border rounded-xl px-3 py-2 text-base" />
                      <div className="flex gap-2">
                        <button onClick={() => saveFact(k, draft)} disabled={busy} className="rounded-full bg-violet-600 text-white text-xs font-bold px-4 py-2">保存して確定</button>
                        <button onClick={() => setEditing(null)} className="rounded-full border text-xs px-4 py-2">やめる</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 flex items-start justify-between gap-3">
                      <p className={`text-sm whitespace-pre-wrap break-words ${f?.value ? '' : 'text-gray-400'}`}>{f?.value || 'まだ'}</p>
                      <div className="shrink-0 flex gap-2 text-xs">
                        {f?.value && !PUBLISHABLE.includes(f.status) && (
                          <button onClick={() => saveFact(k, f.value)} disabled={busy} className="font-bold text-green-700">確定</button>
                        )}
                        <button onClick={() => { setEditing(k); setDraft(f?.value || ''); }} className="text-violet-700 underline">{f?.value ? '直す' : '入力'}</button>
                      </div>
                    </div>
                  )}
                  {meta[k].sensitive && editing === k && (
                    <p className="text-[11px] text-amber-700 mt-1">事実だけを書いてね（事実と違う料金・実績・キャンペーンの表示は法律で禁止されています）</p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="bg-white border rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">キャッチコピーと強み</p>
              {brief.copy && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS[brief.copy.status].cls}`}>{STATUS[brief.copy.status].label}</span>}
            </div>
            {!brief.copy ? (
              <p className="text-sm text-gray-400 mt-1">名前と活動内容がわかったら、AIが案を作るよ</p>
            ) : copyDraft ? (
              <div className="mt-2 space-y-2">
                <input value={copyDraft.heroTitle} onChange={(e) => setCopyDraft({ ...copyDraft, heroTitle: e.target.value })} maxLength={60} className="w-full border rounded-xl px-3 py-2 text-base font-bold" />
                {[0, 1, 2].map((i) => (
                  <input key={i} value={copyDraft.strengths[i] || ''} placeholder={`強み${i + 1}`}
                    onChange={(e) => { const s = [...copyDraft.strengths]; s[i] = e.target.value; setCopyDraft({ ...copyDraft, strengths: s }); }}
                    maxLength={120} className="w-full border rounded-xl px-3 py-2 text-base" />
                ))}
                <div className="flex gap-2">
                  <button onClick={saveCopy} disabled={busy} className="rounded-full bg-violet-600 text-white text-xs font-bold px-4 py-2">保存して確定</button>
                  <button onClick={() => setCopyDraft(null)} className="rounded-full border text-xs px-4 py-2">やめる</button>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-2 font-black">{brief.copy.heroTitle}</p>
                <ul className="mt-1 text-sm text-gray-700 list-disc pl-5">{brief.copy.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                <button onClick={() => setCopyDraft({ heroTitle: brief.copy!.heroTitle, strengths: [...brief.copy!.strengths] })} className="mt-2 text-xs text-violet-700 underline">直す</button>
              </>
            )}
          </div>

          {pending > 0 && (
            <button onClick={confirmAll} disabled={busy} className="w-full rounded-full bg-gray-900 text-white font-bold py-3.5 text-sm">
              表示中の内容で全部OK（{pending}件を確定）
            </button>
          )}

          <div className="bg-white border rounded-2xl p-4">
            <p className="text-sm font-bold">ページのURL</p>
            <div className="mt-1 flex items-center rounded-xl border px-3 focus-within:ring-2 focus-within:ring-violet-300">
              <span className="text-gray-400 text-sm">/</span>
              <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={40} autoCapitalize="none" autoCorrect="off"
                className="flex-1 py-3 pl-1 text-base outline-none" />
            </div>
            <p className="text-xs text-gray-500 mt-1">半角の英小文字・数字・ハイフンで3〜40文字</p>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button onClick={publish} disabled={busy || !canPublish}
            className="w-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold py-4 disabled:opacity-40">
            {busy ? '処理中…' : 'このページを公開する'}
          </button>
          {!canPublish && <p className="text-xs text-gray-500 text-center">* の項目とキャッチコピーを確定すると公開できるよ</p>}
        </section>
      )}
    </main>
  );
}
