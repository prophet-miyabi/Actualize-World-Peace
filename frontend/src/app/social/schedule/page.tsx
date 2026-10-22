'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { resizeImageToDataUrl } from '@/lib/image';
import { STATUS_LABEL, TARGET_COLOR, TARGET_LABEL } from '@/lib/social';

// カレンダー形式の予約投稿。日付をタップ → 文章・写真/縦動画・配信先（AWP / Instagram / X / TikTok …）・時刻を決めて予約。
// スマホ（375px）では 7 列のカレンダーをそのまま収め、予約の内容は下のシートで編集する。
type AccountRow = { platform: string; label: string; connected: boolean; configured: boolean; status: string | null };
type Post = { id: string; text: string; media: string | null; mediaType: string | null; kind: string; platforms: string[]; scheduledAt: string; status: string; attempts: number; lastError: string | null; postedIds: Record<string, string> | null; nextAttemptAt: string | null };

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

export default function SchedulePage() {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selected, setSelected] = useState<string>(ymd(today));
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [time, setTime] = useState('10:00');
  const [targets, setTargets] = useState<string[]>(['awp']);
  const [media, setMedia] = useState<{ dataUrl: string; type: string; name: string } | null>(null);
  const [kind, setKind] = useState<'post' | 'reel'>('post');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const range = useMemo(() => {
    const from = new Date(month.getFullYear(), month.getMonth(), 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 0, 23, 59, 59);
    return { from, to };
  }, [month]);

  const load = useCallback(async () => {
    const [a, p] = await Promise.all([api.get('/social/accounts'), api.get('/social/posts', { params: { from: range.from.toISOString(), to: range.to.toISOString() } })]);
    setAccounts(a.data.platforms);
    setPosts(p.data.posts);
  }, [range]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  useEffect(() => {
    if (!posts.some((p) => p.status === 'pending' || p.status === 'processing')) return;
    const t = setInterval(() => { load().catch(() => {}); }, 15000);
    return () => clearInterval(t);
  }, [posts, load]);

  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts) { const k = ymd(new Date(p.scheduledAt)); m.set(k, [...(m.get(k) ?? []), p]); }
    return m;
  }, [posts]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [month]);

  const connectable = accounts.filter((a) => a.connected && a.status !== 'expired');
  const toggle = (t: string) => setTargets((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const pickFile = async (f: File) => {
    setError('');
    if (f.type.startsWith('video/')) {
      if (f.size > MAX_VIDEO_BYTES) return setError('動画は 25MB までにしてください。');
      const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(f); });
      setMedia({ dataUrl, type: f.type, name: f.name }); setKind('reel');
    } else if (f.type.startsWith('image/')) {
      const dataUrl = await resizeImageToDataUrl(f, 1600, 0.85);
      setMedia({ dataUrl, type: 'image/jpeg', name: f.name }); setKind('post');
    } else setError('写真（JPEG/PNG/WebP）か動画（MP4/WebM/MOV）を選んでください。');
  };

  const submit = async () => {
    setError('');
    if (!text.trim()) return setError('投稿文を入力してください。');
    if (targets.length === 0) return setError('配信先を1つ以上選んでください。');
    const when = new Date(`${selected}T${time}:00`);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000) return setError('過去の日時は指定できません。');
    setSaving(true);
    try {
      await api.post('/social/posts', { text: text.trim(), platforms: targets, scheduledAt: when.toISOString(), mediaDataUrl: media?.dataUrl ?? null, kind });
      setText(''); setMedia(null); setComposing(false);
      setNotice(`${selected} ${time} に予約しました。`); setTimeout(() => setNotice(''), 3000);
      await load();
    } catch (e: any) { setError(e?.response?.data?.error || '予約に失敗しました。'); } finally { setSaving(false); }
  };
  const cancel = async (id: string) => { if (!window.confirm('この予約を取り消しますか？')) return; await api.delete(`/social/posts/${id}`).catch(() => {}); load(); };
  const retry = async (id: string) => { await api.post(`/social/posts/${id}/retry`).catch(() => {}); load(); };

  const dayPosts = byDay.get(selected) ?? [];
  const selectedDate = new Date(`${selected}T00:00:00`);

  return (
    <div className="min-h-screen bg-gray-50 px-3 sm:px-4 py-5 pb-28">
      <div className="max-w-3xl mx-auto">
        <Link href="/social" className="text-sm text-gray-500">← SNS連携へ戻る</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">投稿カレンダー</h1>
        <p className="text-sm text-gray-500 mb-4">日付を選んで予約。AWP のフィードとページ、連携した SNS へ同時に配信します。</p>
        {notice && <p className="mb-3 text-sm text-green-700 font-bold">{notice}</p>}

        {/* 月の切り替え */}
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-full border px-3 py-1.5 text-sm font-bold bg-white">‹ 前月</button>
          <p className="font-black">{month.getFullYear()}年 {month.getMonth() + 1}月</p>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-full border px-3 py-1.5 text-sm font-bold bg-white">翌月 ›</button>
        </div>

        {/* カレンダー（7列固定） */}
        <div className="rounded-2xl bg-white border overflow-hidden">
          <div className="grid grid-cols-7 text-center text-[11px] font-bold text-gray-500 border-b">
            {WEEK.map((w, i) => <div key={w} className={`py-1.5 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : ''}`}>{w}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((d) => {
              const key = ymd(d);
              const inMonth = d.getMonth() === month.getMonth();
              const items = byDay.get(key) ?? [];
              const isSel = key === selected;
              const isToday = key === ymd(today);
              const past = d < new Date(today.getFullYear(), today.getMonth(), today.getDate());
              return (
                <button key={key} onClick={() => { setSelected(key); if (!past) setComposing(false); }}
                  className={`min-h-[52px] sm:min-h-[72px] p-1 border-b border-r text-left align-top ${inMonth ? '' : 'bg-gray-50 text-gray-300'} ${isSel ? 'ring-2 ring-violet-500 ring-inset' : ''}`}>
                  <span className={`inline-flex w-5 h-5 items-center justify-center rounded-full text-[11px] font-bold ${isToday ? 'bg-violet-600 text-white' : ''}`}>{d.getDate()}</span>
                  <div className="mt-0.5 flex flex-wrap gap-0.5">
                    {items.slice(0, 4).map((p) => (
                      <span key={p.id} title={p.text} className="inline-flex gap-px">
                        {p.platforms.map((t) => <span key={t} className="w-2 h-2 rounded-full" style={{ background: p.status === 'failed' ? '#ef4444' : p.status === 'done' ? '#22c55e' : TARGET_COLOR[t] ?? '#94a3b8', opacity: p.status === 'canceled' ? 0.3 : 1 }} />)}
                      </span>
                    ))}
                    {items.length > 4 && <span className="text-[9px] text-gray-500">+{items.length - 4}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-gray-500">
          {Object.entries(TARGET_LABEL).map(([k, v]) => <span key={k} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: TARGET_COLOR[k] }} />{v}</span>)}
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />配信済み</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />失敗</span>
        </div>

        {/* 選んだ日 */}
        <section className="mt-4 rounded-2xl bg-white border p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-black">{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日（{WEEK[selectedDate.getDay()]}）</h2>
            <button onClick={() => { setComposing(true); setError(''); }} className="rounded-full bg-violet-600 text-white text-sm font-bold px-4 py-2">＋ この日に予約</button>
          </div>
          {dayPosts.length === 0 && !composing && <p className="text-sm text-gray-500">この日の予約はありません。</p>}
          <ul className="space-y-2">
            {dayPosts.map((p) => {
              const s = STATUS_LABEL[p.status] || STATUS_LABEL.failed;
              return (
                <li key={p.id} className="rounded-xl border p-3">
                  <div className="flex items-start gap-3">
                    {p.media && (p.mediaType?.startsWith('video/') ? <video src={p.media} className="w-16 h-16 rounded-lg object-cover bg-black shrink-0" muted playsInline /> : <img src={p.media} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />)}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-bold text-sm">{new Date(p.scheduledAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.className}`}>{s.text}</span>{p.kind === 'reel' && <span className="text-[10px] rounded-full bg-gray-100 px-2 py-0.5">リール</span>}</div>
                      <p className="text-sm mt-1 whitespace-pre-wrap break-words">{p.text}</p>
                      <div className="mt-1 flex flex-wrap gap-1">{p.platforms.map((t) => <span key={t} className="text-[10px] rounded-full px-2 py-0.5 text-white" style={{ background: TARGET_COLOR[t] ?? '#94a3b8' }}>{TARGET_LABEL[t] ?? t}{p.postedIds?.[t] ? ' ✓' : ''}</span>)}</div>
                      {p.lastError && <p className="text-xs text-red-600 mt-1">{p.lastError}{p.nextAttemptAt && p.status === 'pending' ? `（${new Date(p.nextAttemptAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} に再試行）` : ''}</p>}
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2 text-xs">
                    {p.status === 'pending' && <button onClick={() => cancel(p.id)} className="text-red-600 font-bold">取り消す</button>}
                    {(p.status === 'failed' || p.status === 'partial') && <button onClick={() => retry(p.id)} className="text-blue-600 font-bold">再試行</button>}
                  </div>
                </li>
              );
            })}
          </ul>

          {composing && (
            <div className="mt-4 rounded-2xl border-2 border-violet-200 bg-violet-50/40 p-4 space-y-3">
              <p className="font-bold text-sm">新しい予約</p>
              <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} className="w-full p-3 border rounded-xl text-sm bg-white" placeholder="投稿する内容。写真や動画も付けられます" />
              <div className="flex flex-wrap items-center gap-2">
                <label className="rounded-full border bg-white px-3 py-1.5 text-xs font-bold cursor-pointer">📷 写真・動画を付ける<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = ''; }} /></label>
                {media && <span className="text-xs text-gray-600 flex items-center gap-2">{media.type.startsWith('video/') ? <video src={media.dataUrl} className="w-10 h-10 rounded object-cover bg-black" muted /> : <img src={media.dataUrl} alt="" className="w-10 h-10 rounded object-cover" />}{media.name.slice(0, 20)}<button onClick={() => setMedia(null)} className="text-red-600 font-bold">外す</button></span>}
                <label className="text-xs flex items-center gap-1 ml-auto">時刻<input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="border rounded-lg px-2 py-1 bg-white" /></label>
              </div>
              <div>
                <p className="text-xs font-bold mb-1.5">配信先（同時に配信）</p>
                <div className="flex flex-wrap gap-2">
                  <label className={`flex items-center gap-1.5 text-xs border rounded-full px-3 py-1.5 cursor-pointer bg-white ${targets.includes('awp') ? 'border-violet-500' : ''}`}><input type="checkbox" checked={targets.includes('awp')} onChange={() => toggle('awp')} />AWP（フィード・ページ）</label>
                  {connectable.map((a) => <label key={a.platform} className={`flex items-center gap-1.5 text-xs border rounded-full px-3 py-1.5 cursor-pointer bg-white ${targets.includes(a.platform) ? 'border-violet-500' : ''}`}><input type="checkbox" checked={targets.includes(a.platform)} onChange={() => toggle(a.platform)} />{a.label}</label>)}
                  {accounts.filter((a) => !a.connected && a.configured).map((a) => <Link key={a.platform} href="/social" className="text-xs border border-dashed rounded-full px-3 py-1.5 text-gray-500">{a.label} を連携 →</Link>)}
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Instagram・TikTok・YouTube は写真または動画が必要です。X は現在テキストのみ配信できます。外部SNSへの配信は有料プランで使えます。</p>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex gap-2">
                <button disabled={saving} onClick={submit} className="flex-1 rounded-full bg-violet-600 text-white font-bold py-3 text-sm disabled:opacity-50">{saving ? '予約中…' : `${selectedDate.getMonth() + 1}/${selectedDate.getDate()} ${time} に予約する`}</button>
                <button onClick={() => setComposing(false)} className="rounded-full border bg-white px-4 text-sm font-bold">閉じる</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
