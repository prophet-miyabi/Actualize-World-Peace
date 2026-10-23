'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

// AWP Harness（自社実装）: 顧客（クロスUUID）・エンゲージメントゲート・ステップ配信・配信アカウントの健全性・
// 「いま導入すると効く」提案を、1つの画面で。外部のサーバーには何も送らない（LINE は公式 API のみ）。
type Channel = 'line' | 'x' | 'instagram' | 'tiktok';
type Contact = { id: string; cid: string; displayName: string | null; source: string; stage: string; leadScore: number; lastSeenAt: string; tags: string[]; lineUserId: string | null; xUserId: string | null; igUserId: string | null; tiktokUserId: string | null; enrollments: { scenarioId: string; status: string; currentStep: number }[] };
type Gate = { id: string; channel: Channel; keyword: string; replyTemplate: string; linkPath: string | null; scenarioId: string | null; tagName: string | null; active: boolean; hits: number; scenario: { name: string } | null };
type Step = { delayMinutes: number; template: string; linkPath?: string | null };
type Scenario = { id: string; name: string; channel: string; trigger: string; active: boolean; steps: (Step & { id: string; order: number })[]; _count: { enrollments: number } };
type Pool = { id: string; channel: string; label: string; healthScore: number; errorCount: number; sentToday: number; dailyLimit: number; cooldownUntil: string | null; active: boolean; lastError: string | null };
type Summary = { total: number; stages: Record<string, number>; scenarios: number; health: { line: { configured: boolean; webhookActivated: boolean; friends: number }; pools: Pool[]; enrollments: Record<string, number>; gates: { id: string; keyword: string; hits: number }[] }; recent: { id: string; type: string; channel: string | null; createdAt: string; contact: { id: string; displayName: string | null; cid: string } }[]; webhookKey: string; ownerId: string };
type Intent = { key: string; label: string; score: number; reason: string | null; suggest: boolean; href: string };

const CH: Record<Channel, string> = { line: 'LINE', x: 'X', instagram: 'Instagram', tiktok: 'TikTok' };
const STAGE: Record<string, string> = { lead: '見込み', engaged: '反応あり', booked: '予約済み', customer: 'お客様', lost: '離脱' };
const TRIGGER: Record<string, string> = { manual: '手動で登録', gate: 'ゲートから', line_follow: 'LINE 友だち追加', tag: 'タグ付与', booking: '予約' };
const EVT: Record<string, string> = { created: '顧客を作成', linked: 'ID を結合', gate_hit: 'ゲートに反応', follow: '友だち追加', lp_visit: 'ページ来訪', booking: '予約', payment: '注文', step_sent: '配信', score: 'スコア変更', tag: 'タグ' };
const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-base';
const btn = 'rounded-full bg-violet-600 text-white text-sm font-bold px-5 py-2 disabled:opacity-40';
const EMPTY_GATE = { channel: 'line' as Channel, keyword: '', replyTemplate: 'ありがとうございます！{こちら|この先}から詳しい内容をご覧いただけます。\n{{link}}', linkPath: '', scenarioId: '', tagName: '' };
const EMPTY_SC = { name: '', trigger: 'gate', steps: [{ delayMinutes: 0, template: '', linkPath: '' }] as Step[] };

export default function HarnessCrmPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [tab, setTab] = useState<'overview' | 'gates' | 'scenarios' | 'contacts' | 'pools'>('overview');
  const [gate, setGate] = useState({ ...EMPTY_GATE });
  const [sc, setSc] = useState({ ...EMPTY_SC });
  const [test, setTest] = useState({ channel: 'line' as Channel, text: '' });
  const [testResult, setTestResult] = useState<{ matched: boolean; reply: string | null } | null>(null);
  const [pool, setPool] = useState({ channel: 'line' as Channel, label: '', dailyLimit: 200 });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [myPath, setMyPath] = useState('');
  const [link, setLink] = useState<{ contactId: string; url: string } | null>(null);

  const load = useCallback(async () => {
    const [s, c, g, sc, i] = await Promise.all([api.get('/harness/crm/summary'), api.get('/harness/crm/contacts'), api.get('/harness/crm/gates'), api.get('/harness/crm/scenarios'), api.get('/intelligence/intent').catch(() => ({ data: { intents: [] } }))]);
    setSummary(s.data); setContacts(c.data.contacts); setGates(g.data.gates); setScenarios(sc.data.scenarios); setIntents(i.data.intents ?? []);
  }, []);
  useEffect(() => { load().catch((e) => setError(e?.response?.status === 401 ? 'ログインが必要です' : '読み込めませんでした')); }, [load]);
  useEffect(() => { api.get('/lp/list').then((r) => { const slug = r.data?.pages?.[0]?.slug; if (slug) setMyPath(`/${slug}`); }).catch(() => {}); }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(''); setMsg('');
    try { await fn(); setMsg(ok); await load(); } catch (e: any) { setError(e?.response?.data?.error || '処理できませんでした'); } finally { setBusy(false); }
  };

  const createGate = () => run(async () => {
    await api.post('/harness/crm/gates', { ...gate, linkPath: gate.linkPath || null, scenarioId: gate.scenarioId || null, tagName: gate.tagName || null });
    setGate({ ...EMPTY_GATE });
  }, 'ゲートを作りました');
  const toggleGate = (g: Gate) => run(() => api.put(`/harness/crm/gates/${g.id}`, { active: !g.active }), g.active ? '止めました' : '動かしました');
  const removeGate = (g: Gate) => { if (confirm(`「${g.keyword}」のゲートを削除しますか？`)) void run(() => api.delete(`/harness/crm/gates/${g.id}`), '削除しました'); };
  const testGate = async () => {
    setError(''); setTestResult(null);
    try { const { data } = await api.post('/harness/crm/gates/test', test); setTestResult(data); } catch (e: any) { setError(e?.response?.data?.error || '試せませんでした'); }
  };
  const createScenario = () => run(async () => {
    await api.post('/harness/crm/scenarios', { name: sc.name, channel: 'line', trigger: sc.trigger, steps: sc.steps.filter((s) => s.template.trim()).map((s) => ({ delayMinutes: Number(s.delayMinutes) || 0, template: s.template, linkPath: s.linkPath || null })) });
    setSc({ ...EMPTY_SC, steps: [{ delayMinutes: 0, template: '', linkPath: '' }] });
  }, 'シナリオを作りました');
  const toggleScenario = (s: Scenario) => run(() => api.put(`/harness/crm/scenarios/${s.id}`, { active: !s.active }), s.active ? '止めました' : '動かしました');
  const removeScenario = (s: Scenario) => { if (confirm(`シナリオ「${s.name}」を削除しますか？登録も消えます。`)) void run(() => api.delete(`/harness/crm/scenarios/${s.id}`), '削除しました'); };
  const runQueue = () => run(() => api.post('/harness/crm/scenarios/run-queue'), '期限の来た配信を処理しました');
  const setStage = (c: Contact, stage: string) => run(() => api.patch(`/harness/crm/contacts/${c.id}`, { stage }), '更新しました');
  const enrollTo = (c: Contact, scenarioId: string) => { if (scenarioId) void run(() => api.post(`/harness/crm/scenarios/${scenarioId}/enroll`, { contactId: c.id }), '登録しました'); };
  const makeLink = async (c: Contact) => {
    setError('');
    try { const { data } = await api.post('/harness/crm/link', { contactId: c.id, path: myPath || '/' }); setLink({ contactId: c.id, url: data.url }); } catch (e: any) { setError(e?.response?.data?.error || 'リンクを作れませんでした'); }
  };
  const addPool = () => run(async () => { await api.post('/harness/crm/pools', pool); setPool({ channel: 'line', label: '', dailyLimit: 200 }); }, '配信アカウントを追加しました');
  const resetPool = (p: Pool) => run(() => api.put(`/harness/crm/pools/${p.id}`, { reset: true, active: true }), '健全性を戻しました');

  const webhookUrl = summary ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/harness/crm/webhook/${summary.ownerId}/{channel}` : '';
  const tabs: { key: typeof tab; label: string }[] = [{ key: 'overview', label: '全体' }, { key: 'gates', label: 'ゲート' }, { key: 'scenarios', label: 'ステップ配信' }, { key: 'contacts', label: '顧客' }, { key: 'pools', label: '配信アカウント' }];

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-6 pb-28">
      <div className="max-w-2xl mx-auto">
        <Link href="/harness" className="text-sm text-gray-500">← Harness へ戻る</Link>
        <h1 className="text-2xl font-black mt-3 mb-1">顧客の動線を自動化</h1>
        <p className="text-sm text-gray-600 mb-4">投稿やLINEの「キーワード」に反応して返信し、ページ・予約・注文まで同じ人として追いかけ、決めた間隔でLINEに自動でお知らせします。データはすべて AWP の中だけに置き、外部のサーバーには送りません。</p>
        {intents.filter((i) => i.suggest).length > 0 && (
          <div className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white p-4 mb-4">
            <p className="text-[11px] font-bold opacity-90">いま導入すると効く</p>
            {intents.filter((i) => i.suggest).map((i) => <p key={i.key} className="text-sm font-bold mt-1">{i.label} <span className="font-normal opacity-90">（{i.reason}）</span></p>)}
          </div>
        )}
        <div className="flex gap-1 overflow-x-auto mb-4 -mx-1 px-1">
          {tabs.map((t) => <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold border ${tab === t.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600'}`}>{t.label}</button>)}
        </div>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        {msg && <p className="text-sm text-emerald-700 mb-3">{msg}</p>}
        {!summary ? <p className="text-sm text-gray-500">読み込み中…</p> : null}

        {summary && tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[['顧客', summary.total], ['反応あり', summary.stages.engaged ?? 0], ['予約済み', summary.stages.booked ?? 0], ['お客様', summary.stages.customer ?? 0], ['動いているシナリオ', summary.scenarios], ['配信待ち', summary.health.enrollments.active ?? 0]].map(([l, v]) => (
                <div key={l as string} className="bg-white border rounded-2xl p-3"><p className="text-[11px] text-gray-500">{l}</p><p className="text-xl font-black">{v as number}</p></div>
              ))}
            </div>
            <section className="bg-white border rounded-2xl p-4 text-sm">
              <h2 className="font-bold mb-2">LINE 公式アカウント</h2>
              <p>{summary.health.line.configured ? `接続済み・友だち ${summary.health.line.friends} 人` : '未接続。ダッシュボードの「LINE 設定」でチャネル情報を登録すると、友だち追加とメッセージがここに流れます。'}</p>
              <p className="text-xs text-gray-500 mt-1">LINE のメッセージがゲートのキーワードに当たると、その返信を優先し、シナリオに登録します。当たらないときは今までどおり AWP が返信します。</p>
            </section>
            <section className="bg-white border rounded-2xl p-4 text-sm">
              <h2 className="font-bold mb-2">X・Instagram・TikTok からの反応を受け取る</h2>
              <p className="text-xs text-gray-600">各 SNS の公式 API（または自分で動かす受信プログラム）から、次の URL に <code className="bg-gray-100 px-1 rounded">{'{ key, externalUserId, text, displayName? }'}</code> を POST すると、ゲートが判定して返信文を返します。送信は呼び出し側が公式 API で行います。</p>
              <p className="mt-2 break-all text-xs"><span className="font-bold">URL:</span> {webhookUrl}</p>
              <p className="mt-1 break-all text-xs"><span className="font-bold">key:</span> {summary.webhookKey}</p>
            </section>
            <section className="bg-white border rounded-2xl p-4 text-sm">
              <h2 className="font-bold mb-2">最近の動き</h2>
              {summary.recent.length === 0 ? <p className="text-gray-500 text-xs">まだ反応はありません。まずゲートを1つ作り、投稿の文末に「◯◯とコメントしてね」と入れてみてください。</p> : (
                <ul className="divide-y text-xs">
                  {summary.recent.map((e) => <li key={e.id} className="py-2 flex justify-between gap-2"><span className="min-w-0 truncate">{EVT[e.type] ?? e.type}{e.channel ? `（${CH[e.channel as Channel] ?? e.channel}）` : ''}・{e.contact.displayName ?? '名前なし'}</span><span className="shrink-0 text-gray-400">{new Date(e.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></li>)}
                </ul>
              )}
            </section>
          </div>
        )}

        {summary && tab === 'gates' && (
          <div className="space-y-4">
            <section className="bg-white border rounded-2xl p-4 space-y-2">
              <h2 className="font-bold">ゲートを作る</h2>
              <p className="text-xs text-gray-500">「キーワード」を含むコメント・DM・LINE に反応します。返信文には <code>{'{{link}}'}</code>（クロスUUID付きのリンク）、<code>{'{{name}}'}</code>、<code>{'{A|B}'}</code>（言い回しのゆらぎ）が使えます。</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">チャネル<select className={input} value={gate.channel} onChange={(e) => setGate({ ...gate, channel: e.target.value as Channel })}>{(Object.keys(CH) as Channel[]).map((c) => <option key={c} value={c}>{CH[c]}</option>)}</select></label>
                <label className="text-xs">キーワード<input className={input} value={gate.keyword} onChange={(e) => setGate({ ...gate, keyword: e.target.value })} placeholder="例: 予約" /></label>
              </div>
              <label className="text-xs block">返信文<textarea className={`${input} min-h-[88px]`} value={gate.replyTemplate} onChange={(e) => setGate({ ...gate, replyTemplate: e.target.value })} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">リンク先（AWP 内のパス）<input className={input} value={gate.linkPath} onChange={(e) => setGate({ ...gate, linkPath: e.target.value })} placeholder={myPath || '/your-page'} /></label>
                <label className="text-xs">タグ（任意）<input className={input} value={gate.tagName} onChange={(e) => setGate({ ...gate, tagName: e.target.value })} placeholder="例: 予約希望" /></label>
              </div>
              <label className="text-xs block">反応したら登録するシナリオ（任意）<select className={input} value={gate.scenarioId} onChange={(e) => setGate({ ...gate, scenarioId: e.target.value })}><option value="">なし</option>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <button type="button" disabled={busy || !gate.keyword.trim() || !gate.replyTemplate.trim()} onClick={createGate} className={btn}>作る</button>
            </section>
            <section className="bg-white border rounded-2xl p-4">
              <h2 className="font-bold mb-2">試し打ち（送信はしません）</h2>
              <div className="flex gap-2">
                <select className={`${input} w-28`} value={test.channel} onChange={(e) => setTest({ ...test, channel: e.target.value as Channel })}>{(Object.keys(CH) as Channel[]).map((c) => <option key={c} value={c}>{CH[c]}</option>)}</select>
                <input className={input} value={test.text} onChange={(e) => setTest({ ...test, text: e.target.value })} placeholder="例: 予約したいです" />
                <button type="button" onClick={testGate} className="shrink-0 rounded-full border px-4 text-sm font-bold">試す</button>
              </div>
              {testResult && <div className={`mt-2 rounded-xl p-3 text-sm ${testResult.matched ? 'bg-emerald-50' : 'bg-gray-50'}`}>{testResult.matched ? <><p className="font-bold text-emerald-700">反応しました</p><p className="whitespace-pre-wrap break-all mt-1">{testResult.reply}</p></> : <p className="text-gray-600">どのゲートにも当たりませんでした</p>}</div>}
            </section>
            <ul className="space-y-2">
              {gates.map((g) => (
                <li key={g.id} className={`bg-white border rounded-2xl p-4 ${g.active ? '' : 'opacity-60'}`}>
                  <div className="flex justify-between gap-2"><p className="font-bold">{CH[g.channel]}「{g.keyword}」</p><span className="text-xs text-gray-500 shrink-0">反応 {g.hits} 回</span></div>
                  <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{g.replyTemplate}</p>
                  <p className="text-[11px] text-gray-500 mt-1">{g.linkPath ? `→ ${g.linkPath}` : ''}{g.scenario ? `・シナリオ: ${g.scenario.name}` : ''}{g.tagName ? `・タグ: ${g.tagName}` : ''}</p>
                  <div className="flex gap-3 mt-2 text-xs"><button type="button" onClick={() => toggleGate(g)} className="underline text-violet-700">{g.active ? '止める' : '動かす'}</button><button type="button" onClick={() => removeGate(g)} className="underline text-red-600">削除</button></div>
                </li>
              ))}
              {gates.length === 0 && <li className="text-sm text-gray-500">まだゲートはありません。</li>}
            </ul>
          </div>
        )}

        {summary && tab === 'scenarios' && (
          <div className="space-y-4">
            <section className="bg-white border rounded-2xl p-4 space-y-2">
              <h2 className="font-bold">シナリオを作る（LINE に届きます）</h2>
              <p className="text-xs text-gray-500">各ステップは「前のステップから何分後」に送るかで決めます。2,500ms 前後のゆらぎを付け、配信アカウントの健全性が下がると自動で待ちます。</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">名前<input className={input} value={sc.name} onChange={(e) => setSc({ ...sc, name: e.target.value })} placeholder="例: 初回予約のご案内" /></label>
                <label className="text-xs">きっかけ<select className={input} value={sc.trigger} onChange={(e) => setSc({ ...sc, trigger: e.target.value })}>{Object.entries(TRIGGER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              </div>
              {sc.steps.map((s, i) => (
                <div key={i} className="rounded-xl border border-gray-200 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs"><span className="font-bold">ステップ {i + 1}</span><input type="number" min={0} className={`${input} w-24`} value={s.delayMinutes} onChange={(e) => setSc({ ...sc, steps: sc.steps.map((x, k) => (k === i ? { ...x, delayMinutes: Number(e.target.value) } : x)) })} /><span>分後</span></div>
                  <textarea className={`${input} min-h-[72px]`} value={s.template} onChange={(e) => setSc({ ...sc, steps: sc.steps.map((x, k) => (k === i ? { ...x, template: e.target.value } : x)) })} placeholder="文面（{{name}} / {{link}} / {A|B} が使えます）" />
                  <input className={input} value={s.linkPath ?? ''} onChange={(e) => setSc({ ...sc, steps: sc.steps.map((x, k) => (k === i ? { ...x, linkPath: e.target.value } : x)) })} placeholder="リンク先（任意。例: /your-page#reserve）" />
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button" onClick={() => setSc({ ...sc, steps: [...sc.steps, { delayMinutes: 1440, template: '', linkPath: '' }] })} className="rounded-full border px-4 py-2 text-sm font-bold">ステップを足す</button>
                <button type="button" disabled={busy || !sc.name.trim() || !sc.steps.some((s) => s.template.trim())} onClick={createScenario} className={btn}>作る</button>
              </div>
            </section>
            <div className="flex justify-end"><button type="button" onClick={runQueue} disabled={busy} className="text-xs underline text-violet-700">期限の来た配信を今すぐ処理</button></div>
            <ul className="space-y-2">
              {scenarios.map((s) => (
                <li key={s.id} className={`bg-white border rounded-2xl p-4 ${s.active ? '' : 'opacity-60'}`}>
                  <div className="flex justify-between gap-2"><p className="font-bold">{s.name}</p><span className="text-xs text-gray-500 shrink-0">{TRIGGER[s.trigger] ?? s.trigger}・登録 {s._count.enrollments}</span></div>
                  <ol className="mt-2 space-y-1 text-xs text-gray-700">{s.steps.map((st) => <li key={st.id}><span className="font-bold">{st.delayMinutes === 0 ? 'すぐ' : `${st.delayMinutes}分後`}</span>: {st.template.slice(0, 80)}</li>)}</ol>
                  <div className="flex gap-3 mt-2 text-xs"><button type="button" onClick={() => toggleScenario(s)} className="underline text-violet-700">{s.active ? '止める' : '動かす'}</button><button type="button" onClick={() => removeScenario(s)} className="underline text-red-600">削除</button></div>
                </li>
              ))}
              {scenarios.length === 0 && <li className="text-sm text-gray-500">まだシナリオはありません。</li>}
            </ul>
          </div>
        )}

        {summary && tab === 'contacts' && (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li key={c.id} className="bg-white border rounded-2xl p-4">
                <div className="flex justify-between gap-2">
                  <p className="font-bold min-w-0 truncate">{c.displayName ?? '名前なし'} <span className="text-xs font-normal text-gray-500">{[c.lineUserId && 'LINE', c.xUserId && 'X', c.igUserId && 'IG', c.tiktokUserId && 'TikTok'].filter(Boolean).join('・') || c.source}</span></p>
                  <span className="shrink-0 text-sm font-black text-violet-700">{c.leadScore}</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2 items-center text-xs">
                  <select className="rounded-full border px-2 py-1" value={c.stage} onChange={(e) => setStage(c, e.target.value)}>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  {c.tags.map((t) => <span key={t} className="rounded-full bg-gray-100 px-2 py-1">{t}</span>)}
                  <select className="rounded-full border px-2 py-1" defaultValue="" onChange={(e) => { enrollTo(c, e.target.value); e.target.value = ''; }}><option value="">シナリオに登録…</option>{scenarios.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  <button type="button" onClick={() => makeLink(c)} className="underline text-violet-700">この人用のリンク</button>
                </div>
                {link?.contactId === c.id && <p className="mt-2 text-xs break-all bg-gray-50 rounded-lg p-2">{link.url}</p>}
                <p className="text-[11px] text-gray-400 mt-1">最終反応 {new Date(c.lastSeenAt).toLocaleString('ja-JP')}{c.enrollments.length ? `・配信 ${c.enrollments.map((e) => `${e.status}(${e.currentStep})`).join(', ')}` : ''}</p>
              </li>
            ))}
            {contacts.length === 0 && <li className="text-sm text-gray-500">まだ顧客はいません。ゲートに反応した人・LINE を追加した人が自動で入ります。</li>}
          </ul>
        )}

        {summary && tab === 'pools' && (
          <div className="space-y-4">
            <section className="bg-white border rounded-2xl p-4 space-y-2">
              <h2 className="font-bold">配信アカウントを登録</h2>
              <p className="text-xs text-gray-500">配信に使うアカウントを登録しておくと、エラーで健全性が下がったアカウントを自動で休ませ、別のアカウントに切り替えます（LINE は接続済みのチャネルで送ります）。</p>
              <div className="grid grid-cols-3 gap-2">
                <select className={input} value={pool.channel} onChange={(e) => setPool({ ...pool, channel: e.target.value as Channel })}>{(Object.keys(CH) as Channel[]).map((c) => <option key={c} value={c}>{CH[c]}</option>)}</select>
                <input className={input} value={pool.label} onChange={(e) => setPool({ ...pool, label: e.target.value })} placeholder="名前" />
                <input type="number" className={input} value={pool.dailyLimit} onChange={(e) => setPool({ ...pool, dailyLimit: Number(e.target.value) })} placeholder="1日の上限" />
              </div>
              <button type="button" disabled={busy || !pool.label.trim()} onClick={addPool} className={btn}>追加</button>
            </section>
            <ul className="space-y-2">
              {summary.health.pools.map((p) => (
                <li key={p.id} className="bg-white border rounded-2xl p-4 text-sm">
                  <div className="flex justify-between gap-2"><p className="font-bold">{CH[p.channel as Channel] ?? p.channel}・{p.label}</p><span className={`font-black ${p.healthScore >= 70 ? 'text-emerald-600' : p.healthScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{p.healthScore}</span></div>
                  <p className="text-xs text-gray-500 mt-1">今日 {p.sentToday}/{p.dailyLimit} 通・エラー {p.errorCount}{p.cooldownUntil && new Date(p.cooldownUntil) > new Date() ? `・休止中（${new Date(p.cooldownUntil).toLocaleTimeString('ja-JP')} まで）` : ''}{p.lastError ? `・${p.lastError}` : ''}</p>
                  {(p.healthScore < 70 || p.cooldownUntil) && <button type="button" onClick={() => resetPool(p)} className="mt-2 text-xs underline text-violet-700">健全性を戻す</button>}
                </li>
              ))}
              {summary.health.pools.length === 0 && <li className="text-sm text-gray-500">まだ登録はありません。</li>}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
