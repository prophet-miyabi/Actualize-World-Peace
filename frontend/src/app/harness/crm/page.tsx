'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import MessageSpecEditor from '@/components/harness/MessageSpecEditor';
import LineSetup from '@/components/harness/LineSetup';
import Inbox from '@/components/harness/Inbox';
import Broadcasts from '@/components/harness/Broadcasts';
import Surveys from '@/components/harness/Surveys';
import Reminders from '@/components/harness/Reminders';
import { STAGE_LABEL, emptySpec, specSummary, type Condition, type MessageSpec } from '@/lib/harness';

// AWP Harness（自社実装）: スマホ 1 台で LINE 公式アカウントをつなぎ、自動返信・アンケート・ステップ配信・一斉配信・
// リマインダー・受信箱・予約導線までを運用する。外部のサーバーには何も送らない（LINE は公式 API のみ）。
type Channel = 'line' | 'x' | 'instagram' | 'tiktok';
type Contact = { id: string; cid: string; displayName: string | null; source: string; stage: string; leadScore: number; lastSeenAt: string; tags: string[]; blocked: boolean; fields: Record<string, unknown> | null; lineUserId: string | null; xUserId: string | null; igUserId: string | null; tiktokUserId: string | null; enrollments: { scenarioId: string; status: string; currentStep: number }[] };
type Gate = { id: string; channel: Channel; keyword: string; replyTemplate: string; replyMessage: MessageSpec | null; surveyId: string | null; linkPath: string | null; scenarioId: string | null; tagName: string | null; active: boolean; hits: number; scenario: { name: string } | null };
type Step = { delayMinutes: number; template: string; linkPath?: string | null; message?: MessageSpec | null; condition?: Condition | null; onSkip?: 'next' | 'stop' };
type Scenario = { id: string; name: string; channel: string; trigger: string; active: boolean; steps: (Step & { id: string; order: number })[]; _count: { enrollments: number } };
type Pool = { id: string; channel: string; label: string; healthScore: number; errorCount: number; sentToday: number; dailyLimit: number; cooldownUntil: string | null; active: boolean; lastError: string | null };
type LineAcc = { id: string; label: string; healthScore: number; webhookActivated: boolean; friendsAdded: number; isDefault: boolean };
type Summary = { total: number; stages: Record<string, number>; scenarios: number; health: { line: { configured: boolean; webhookActivated: boolean; friends: number; accounts: LineAcc[] }; pools: Pool[]; enrollments: Record<string, number>; gates: { id: string; keyword: string; hits: number }[] }; recent: { id: string; type: string; channel: string | null; createdAt: string; contact: { id: string; displayName: string | null; cid: string } }[]; webhookKey: string; ownerId: string };
type Intent = { key: string; label: string; score: number; reason: string | null; suggest: boolean; href: string };
type Survey = { id: string; name: string };
type Tab = 'overview' | 'inbox' | 'gates' | 'surveys' | 'scenarios' | 'broadcasts' | 'reminders' | 'contacts' | 'settings';

const CH: Record<Channel, string> = { line: 'LINE', x: 'X', instagram: 'Instagram', tiktok: 'TikTok' };
const TRIGGER: Record<string, string> = { manual: '手動で登録', gate: 'ゲートから', line_follow: 'LINE 友だち追加', tag: 'タグ付与', booking: '予約' };
const EVT: Record<string, string> = { created: '顧客を作成', linked: 'ID を結合', gate_hit: 'ゲートに反応', follow: '友だち追加', unfollow: 'ブロック', lp_visit: 'ページ来訪', booking: '予約', payment: '注文', step_sent: '配信', score: 'スコア変更', tag_added: 'タグ', button: 'ボタン', survey_start: 'アンケート開始', survey_done: 'アンケート完了' };
const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-base';
const btn = 'rounded-full bg-violet-600 text-white text-sm font-bold px-5 py-2 disabled:opacity-40';
const EMPTY_GATE = { channel: 'line' as Channel, keyword: '', replyTemplate: 'ありがとうございます！{こちら|この先}から詳しい内容をご覧いただけます。\n{{link}}', linkPath: '', scenarioId: '', tagName: '', surveyId: '', rich: false, replyMessage: emptySpec() as MessageSpec };
const newStep = (): Step => ({ delayMinutes: 0, template: '', linkPath: '', message: null, condition: null, onSkip: 'next' });
const EMPTY_SC = { name: '', trigger: 'gate', steps: [newStep()] as Step[] };
const TABS: { key: Tab; label: string }[] = [{ key: 'overview', label: '全体' }, { key: 'inbox', label: '受信箱' }, { key: 'gates', label: '自動返信' }, { key: 'surveys', label: 'アンケート' }, { key: 'scenarios', label: 'ステップ配信' }, { key: 'broadcasts', label: '一斉配信' }, { key: 'reminders', label: 'リマインダー' }, { key: 'contacts', label: '顧客' }, { key: 'settings', label: '設定' }];

export default function HarnessCrmPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [gates, setGates] = useState<Gate[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [tab, setTab] = useState<Tab>('overview');
  const [gate, setGate] = useState({ ...EMPTY_GATE });
  const [sc, setSc] = useState({ ...EMPTY_SC });
  const [stepRich, setStepRich] = useState<Record<number, boolean>>({});
  const [test, setTest] = useState({ channel: 'line' as Channel, text: '' });
  const [testResult, setTestResult] = useState<{ matched: boolean; reply: string | null; spec?: MessageSpec | null } | null>(null);
  const [pool, setPool] = useState({ channel: 'x' as Channel, label: '', dailyLimit: 200 });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [myPath, setMyPath] = useState('');
  const [link, setLink] = useState<{ contactId: string; url: string } | null>(null);

  const load = useCallback(async () => {
    const [s, c, g, scn, sv, tg, i] = await Promise.all([api.get('/harness/crm/summary'), api.get('/harness/crm/contacts'), api.get('/harness/crm/gates'), api.get('/harness/crm/scenarios'), api.get('/harness/crm/surveys'), api.get('/harness/crm/tags'), api.get('/intelligence/intent').catch(() => ({ data: { intents: [] } }))]);
    setSummary(s.data); setContacts(c.data.contacts); setGates(g.data.gates); setScenarios(scn.data.scenarios); setSurveys(sv.data.surveys); setTags(tg.data.tags.map((t: { name: string }) => t.name)); setIntents(i.data.intents ?? []);
  }, []);
  useEffect(() => { load().catch((e) => setError(e?.response?.status === 401 ? 'ログインが必要です' : '読み込めませんでした')); }, [load]);
  useEffect(() => { api.get('/lp/list').then((r) => { const slug = r.data?.pages?.[0]?.slug; if (slug) setMyPath(`/${slug}`); }).catch(() => {}); }, []);
  useEffect(() => { if (summary && !summary.health.line.configured && summary.total === 0) setTab('settings'); }, [summary]);

  const refs = { scenarios: scenarios.map((s) => ({ id: s.id, name: s.name })), surveys, myPath, tags };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(''); setMsg('');
    try { await fn(); setMsg(ok); await load(); } catch (e: any) { setError(e?.response?.data?.error || '処理できませんでした'); } finally { setBusy(false); }
  };

  const createGate = () => run(async () => {
    const { rich, replyMessage, ...g } = gate;
    await api.post('/harness/crm/gates', { ...g, linkPath: g.linkPath || null, scenarioId: g.scenarioId || null, tagName: g.tagName || null, surveyId: g.surveyId || null, replyTemplate: rich ? (replyMessage.text || g.replyTemplate || 'ありがとうございます') : g.replyTemplate, replyMessage: rich ? replyMessage : null });
    setGate({ ...EMPTY_GATE });
  }, '自動返信を作りました');
  const toggleGate = (g: Gate) => run(() => api.put(`/harness/crm/gates/${g.id}`, { active: !g.active }), g.active ? '止めました' : '動かしました');
  const removeGate = (g: Gate) => { if (confirm(`「${g.keyword}」の自動返信を削除しますか？`)) void run(() => api.delete(`/harness/crm/gates/${g.id}`), '削除しました'); };
  const testGate = async () => {
    setError(''); setTestResult(null);
    try { const { data } = await api.post('/harness/crm/gates/test', test); setTestResult(data); } catch (e: any) { setError(e?.response?.data?.error || '試せませんでした'); }
  };
  const setStep = (i: number, patch: Partial<Step>) => setSc({ ...sc, steps: sc.steps.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const createScenario = () => run(async () => {
    await api.post('/harness/crm/scenarios', { name: sc.name, channel: 'line', trigger: sc.trigger, steps: sc.steps.filter((s, i) => (stepRich[i] ? s.message : s.template.trim())).map((s, i) => ({ delayMinutes: Number(s.delayMinutes) || 0, template: stepRich[i] ? (s.message?.text || s.template || '') : s.template, linkPath: s.linkPath || null, message: stepRich[i] ? s.message : null, condition: s.condition && Object.values(s.condition).some((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length)) ? s.condition : null, onSkip: s.onSkip ?? 'next' })) });
    setSc({ ...EMPTY_SC, steps: [newStep()] }); setStepRich({});
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
  const addPool = () => run(async () => { await api.post('/harness/crm/pools', pool); setPool({ channel: 'x', label: '', dailyLimit: 200 }); }, '配信アカウントを追加しました');
  const resetPool = (p: Pool) => run(() => api.put(`/harness/crm/pools/${p.id}`, { reset: true, active: true }), '健全性を戻しました');

  const webhookUrl = summary ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/harness/crm/webhook/${summary.ownerId}/{channel}` : '';
  const lineOk = !!summary?.health.line.configured;

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-6 pb-28">
      <div className="max-w-2xl mx-auto">
        <Link href="/harness" className="text-sm text-gray-500">← Harness へ戻る</Link>
        <h1 className="text-2xl font-black mt-3 mb-1">LINE の自動化</h1>
        <p className="text-sm text-gray-600 mb-4">AWP のアカウントがあれば、スマホだけで LINE 公式アカウントをつなぎ、自動返信・アンケート・ステップ配信・一斉配信・リマインダー・予約導線まで動かせます。データは AWP の中だけに置き、LINE の公式 API 以外には送りません。</p>
        {summary && !lineOk && tab !== 'settings' && (
          <button type="button" onClick={() => setTab('settings')} className="w-full text-left rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white p-4 mb-4">
            <p className="font-bold text-sm">まず LINE 公式アカウントをつなぎましょう（5 分・スマホだけ）</p>
            <p className="text-[11px] opacity-90 mt-1">3 つの値を貼るだけ。Webhook の登録は AWP が行います。</p>
          </button>
        )}
        {intents.filter((i) => i.suggest).length > 0 && (
          <div className="rounded-2xl bg-white border p-3 mb-4 text-sm">
            <p className="text-[11px] font-bold text-violet-700">いま始めると効く</p>
            {intents.filter((i) => i.suggest).map((i) => <p key={i.key} className="text-sm font-bold mt-1">{i.label} <span className="font-normal text-gray-600">（{i.reason}）</span></p>)}
          </div>
        )}
        <div className="flex gap-1 overflow-x-auto mb-4 -mx-1 px-1">
          {TABS.map((t) => <button key={t.key} type="button" onClick={() => setTab(t.key)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold border ${tab === t.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600'}`}>{t.label}{t.key === 'inbox' && contacts.some((c) => (c as any).unreadCount > 0) ? ' •' : ''}</button>)}
        </div>
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
        {msg && <p className="text-sm text-emerald-700 mb-3">{msg}</p>}
        {!summary ? <p className="text-sm text-gray-500">読み込み中…</p> : null}

        {summary && tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {[['友だち（顧客）', summary.total], ['反応あり', summary.stages.engaged ?? 0], ['予約済み', summary.stages.booked ?? 0], ['お客様', summary.stages.customer ?? 0], ['動いているシナリオ', summary.scenarios], ['配信待ち', summary.health.enrollments.active ?? 0]].map(([l, v]) => (
                <div key={l as string} className="bg-white border rounded-2xl p-3"><p className="text-[11px] text-gray-500">{l}</p><p className="text-xl font-black">{v as number}</p></div>
              ))}
            </div>
            <section className="bg-white border rounded-2xl p-4 text-sm">
              <div className="flex items-center justify-between"><h2 className="font-bold">LINE 公式アカウント</h2><button type="button" onClick={() => setTab('settings')} className="text-xs text-violet-700 font-bold">設定 →</button></div>
              {lineOk ? (
                <ul className="mt-2 text-xs space-y-1">{summary.health.line.accounts.map((a) => <li key={a.id} className="flex justify-between"><span>{a.label}{a.isDefault ? '（既定）' : ''}・友だち {a.friendsAdded}・{a.webhookActivated ? '接続済み' : 'Webhook 未接続'}</span><span className={`font-black ${a.healthScore >= 70 ? 'text-emerald-600' : 'text-amber-600'}`}>{a.healthScore}</span></li>)}</ul>
              ) : <p className="mt-1 text-gray-600">未接続です。「設定」から 3 つの値を貼るだけでつながります。</p>}
            </section>
            <section className="bg-white border rounded-2xl p-4 text-sm">
              <h2 className="font-bold mb-1">はじめ方（スマホだけ）</h2>
              <ol className="list-decimal pl-5 text-xs text-gray-700 space-y-1">
                <li>「設定」で LINE 公式アカウントをつなぐ</li>
                <li>「自動返信」でキーワード（例: 予約）に返す内容を作る。ボタンに「予約フォームを開く」を付けると予約導線になる</li>
                <li>「アンケート」で選択肢の質問を作り、自動返信やボタンから始める</li>
                <li>「ステップ配信」で友だち追加後の案内を 1 通目・2 通目…と並べる</li>
                <li>「リマインダー」で予約の前日に自動で知らせる。「受信箱」で返事を返す</li>
              </ol>
            </section>
            <section className="bg-white border rounded-2xl p-4 text-sm">
              <h2 className="font-bold mb-2">最近の動き</h2>
              {summary.recent.length === 0 ? <p className="text-gray-500 text-xs">まだ反応はありません。</p> : (
                <ul className="divide-y text-xs">
                  {summary.recent.map((e) => <li key={e.id} className="py-2 flex justify-between gap-2"><span className="min-w-0 truncate">{EVT[e.type] ?? e.type}{e.channel ? `（${CH[e.channel as Channel] ?? e.channel}）` : ''}・{e.contact.displayName ?? '名前なし'}</span><span className="shrink-0 text-gray-400">{new Date(e.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></li>)}
                </ul>
              )}
            </section>
          </div>
        )}

        {summary && tab === 'inbox' && <Inbox refs={refs} />}
        {summary && tab === 'surveys' && <Surveys refs={refs} onChanged={load} />}
        {summary && tab === 'broadcasts' && <Broadcasts refs={refs} />}
        {summary && tab === 'reminders' && <Reminders refs={refs} />}

        {summary && tab === 'gates' && (
          <div className="space-y-4">
            <section className="bg-white border rounded-2xl p-4 space-y-2">
              <h2 className="font-bold">自動返信を作る</h2>
              <p className="text-xs text-gray-500">LINE のメッセージ（X / Instagram / TikTok はコメント・DM）に「キーワード」が含まれていたら返します。返信には <code>{'{{link}}'}</code>（顧客 ID 付きのリンク）、<code>{'{{name}}'}</code>、<code>{'{A|B}'}</code>（言い回しのゆらぎ）が使えます。</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">チャネル<select className={input} value={gate.channel} onChange={(e) => setGate({ ...gate, channel: e.target.value as Channel })}>{(Object.keys(CH) as Channel[]).map((c) => <option key={c} value={c}>{CH[c]}</option>)}</select></label>
                <label className="text-xs">キーワード<input className={input} value={gate.keyword} onChange={(e) => setGate({ ...gate, keyword: e.target.value })} placeholder="例: 予約" /></label>
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => setGate({ ...gate, rich: false })} className={`rounded-full border px-3 py-1 text-xs font-bold ${!gate.rich ? 'bg-gray-900 text-white border-gray-900' : 'bg-white'}`}>文章で返す</button>
                <button type="button" onClick={() => setGate({ ...gate, rich: true })} className={`rounded-full border px-3 py-1 text-xs font-bold ${gate.rich ? 'bg-gray-900 text-white border-gray-900' : 'bg-white'}`}>ボタン・カードで返す</button>
              </div>
              {gate.rich ? <MessageSpecEditor value={gate.replyMessage} onChange={(v) => setGate({ ...gate, replyMessage: v })} refs={refs} /> : <label className="text-xs block">返信文<textarea className={`${input} min-h-[88px]`} value={gate.replyTemplate} onChange={(e) => setGate({ ...gate, replyTemplate: e.target.value })} /></label>}
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">リンク先（AWP 内のパス）<input className={input} value={gate.linkPath} onChange={(e) => setGate({ ...gate, linkPath: e.target.value })} placeholder={myPath || '/your-page'} /></label>
                <label className="text-xs">タグ（任意）<input className={input} value={gate.tagName} onChange={(e) => setGate({ ...gate, tagName: e.target.value })} placeholder="例: 予約希望" /></label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs block">反応したら始めるシナリオ<select className={input} value={gate.scenarioId} onChange={(e) => setGate({ ...gate, scenarioId: e.target.value })}><option value="">なし</option>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                <label className="text-xs block">反応したら始めるアンケート<select className={input} value={gate.surveyId} onChange={(e) => setGate({ ...gate, surveyId: e.target.value })}><option value="">なし</option>{surveys.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              </div>
              <button type="button" disabled={busy || !gate.keyword.trim() || (!gate.rich && !gate.replyTemplate.trim())} onClick={createGate} className={btn}>作る</button>
            </section>
            <section className="bg-white border rounded-2xl p-4">
              <h2 className="font-bold mb-2">試し打ち（送信はしません）</h2>
              <div className="flex gap-2">
                <select className={`${input} w-28`} value={test.channel} onChange={(e) => setTest({ ...test, channel: e.target.value as Channel })}>{(Object.keys(CH) as Channel[]).map((c) => <option key={c} value={c}>{CH[c]}</option>)}</select>
                <input className={input} value={test.text} onChange={(e) => setTest({ ...test, text: e.target.value })} placeholder="例: 予約したいです" />
                <button type="button" onClick={testGate} className="shrink-0 rounded-full border px-4 text-sm font-bold">試す</button>
              </div>
              {testResult && <div className={`mt-2 rounded-xl p-3 text-sm ${testResult.matched ? 'bg-emerald-50' : 'bg-gray-50'}`}>{testResult.matched ? <><p className="font-bold text-emerald-700">反応しました{testResult.spec && testResult.spec.kind !== 'text' ? `（${specSummary(testResult.spec)}）` : ''}</p><p className="whitespace-pre-wrap break-all mt-1">{testResult.reply}</p></> : <p className="text-gray-600">どの自動返信にも当たりませんでした</p>}</div>}
            </section>
            <ul className="space-y-2">
              {gates.map((g) => (
                <li key={g.id} className={`bg-white border rounded-2xl p-4 ${g.active ? '' : 'opacity-60'}`}>
                  <div className="flex justify-between gap-2"><p className="font-bold">{CH[g.channel]}「{g.keyword}」</p><span className="text-xs text-gray-500 shrink-0">反応 {g.hits} 回</span></div>
                  <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{g.replyMessage ? specSummary(g.replyMessage) : g.replyTemplate}</p>
                  <p className="text-[11px] text-gray-500 mt-1">{g.linkPath ? `→ ${g.linkPath}` : ''}{g.scenario ? `・シナリオ: ${g.scenario.name}` : ''}{g.surveyId ? `・アンケート: ${surveys.find((s) => s.id === g.surveyId)?.name ?? ''}` : ''}{g.tagName ? `・タグ: ${g.tagName}` : ''}</p>
                  <div className="flex gap-3 mt-2 text-xs"><button type="button" onClick={() => toggleGate(g)} className="underline text-violet-700">{g.active ? '止める' : '動かす'}</button><button type="button" onClick={() => removeGate(g)} className="underline text-red-600">削除</button></div>
                </li>
              ))}
              {gates.length === 0 && <li className="text-sm text-gray-500">まだ自動返信はありません。</li>}
            </ul>
          </div>
        )}

        {summary && tab === 'scenarios' && (
          <div className="space-y-4">
            <section className="bg-white border rounded-2xl p-4 space-y-2">
              <h2 className="font-bold">シナリオを作る（LINE に届きます）</h2>
              <p className="text-xs text-gray-500">各ステップは「前のステップから何分後」に送るかで決めます。条件（タグ・スコア・段階）を付けると、合わない人は飛ばすか終えることができます。</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">名前<input className={input} value={sc.name} onChange={(e) => setSc({ ...sc, name: e.target.value })} placeholder="例: 初回予約のご案内" /></label>
                <label className="text-xs">きっかけ<select className={input} value={sc.trigger} onChange={(e) => setSc({ ...sc, trigger: e.target.value })}>{Object.entries(TRIGGER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              </div>
              {sc.steps.map((s, i) => (
                <div key={i} className="rounded-xl border border-gray-200 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs"><span className="font-bold">ステップ {i + 1}</span><input type="number" min={0} className={`${input} w-24`} value={s.delayMinutes} onChange={(e) => setStep(i, { delayMinutes: Number(e.target.value) })} /><span>分後</span>
                    <button type="button" onClick={() => setStepRich({ ...stepRich, [i]: !stepRich[i] })} className="ml-auto rounded-full border px-3 py-1 text-[11px] font-bold">{stepRich[i] ? '文章だけに' : 'ボタン・カード'}</button>
                  </div>
                  {stepRich[i] ? <MessageSpecEditor value={s.message ?? emptySpec()} onChange={(v) => setStep(i, { message: v })} refs={refs} compact /> : <textarea className={`${input} min-h-[72px]`} value={s.template} onChange={(e) => setStep(i, { template: e.target.value })} placeholder="文面（{{name}} / {{link}} / {A|B} が使えます）" />}
                  <input className={input} value={s.linkPath ?? ''} onChange={(e) => setStep(i, { linkPath: e.target.value })} placeholder="リンク先（任意。例: /your-page#reserve）" />
                  <details className="rounded-xl bg-gray-50 p-2 text-xs">
                    <summary className="font-bold text-gray-600 cursor-pointer">送る条件（任意）</summary>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <select className={input} value={s.condition?.hasTag ?? ''} onChange={(e) => setStep(i, { condition: { ...(s.condition ?? {}), hasTag: e.target.value || null } })}><option value="">タグを持つ人だけ…</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                      <select className={input} value={s.condition?.notTag ?? ''} onChange={(e) => setStep(i, { condition: { ...(s.condition ?? {}), notTag: e.target.value || null } })}><option value="">タグを持たない人だけ…</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                      <input type="number" min={0} max={100} className={input} value={s.condition?.minScore ?? ''} onChange={(e) => setStep(i, { condition: { ...(s.condition ?? {}), minScore: e.target.value === '' ? null : Number(e.target.value) } })} placeholder="スコア以上" />
                      <select className={input} value={s.onSkip ?? 'next'} onChange={(e) => setStep(i, { onSkip: e.target.value as 'next' | 'stop' })}><option value="next">合わなければ飛ばす</option><option value="stop">合わなければ終了</option></select>
                    </div>
                  </details>
                </div>
              ))}
              <div className="flex gap-2">
                <button type="button" onClick={() => setSc({ ...sc, steps: [...sc.steps, { ...newStep(), delayMinutes: 1440 }] })} className="rounded-full border px-4 py-2 text-sm font-bold">ステップを足す</button>
                <button type="button" disabled={busy || !sc.name.trim() || !sc.steps.some((s, i) => (stepRich[i] ? !!s.message : s.template.trim()))} onClick={createScenario} className={btn}>作る</button>
              </div>
            </section>
            <div className="flex justify-end"><button type="button" onClick={runQueue} disabled={busy} className="text-xs underline text-violet-700">期限の来た配信を今すぐ処理</button></div>
            <ul className="space-y-2">
              {scenarios.map((s) => (
                <li key={s.id} className={`bg-white border rounded-2xl p-4 ${s.active ? '' : 'opacity-60'}`}>
                  <div className="flex justify-between gap-2"><p className="font-bold">{s.name}</p><span className="text-xs text-gray-500 shrink-0">{TRIGGER[s.trigger] ?? s.trigger}・登録 {s._count.enrollments}</span></div>
                  <ol className="mt-2 space-y-1 text-xs text-gray-700">{s.steps.map((st) => <li key={st.id}><span className="font-bold">{st.delayMinutes === 0 ? 'すぐ' : `${st.delayMinutes}分後`}</span>: {st.message ? specSummary(st.message) : st.template.slice(0, 80)}{st.condition ? '（条件あり）' : ''}</li>)}</ol>
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
                  <p className="font-bold min-w-0 truncate">{c.displayName ?? '名前なし'} <span className="text-xs font-normal text-gray-500">{[c.lineUserId && 'LINE', c.xUserId && 'X', c.igUserId && 'IG', c.tiktokUserId && 'TikTok'].filter(Boolean).join('・') || c.source}{c.blocked ? '・ブロック' : ''}</span></p>
                  <span className="shrink-0 text-sm font-black text-violet-700">{c.leadScore}</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2 items-center text-xs">
                  <select className="rounded-full border px-2 py-1" value={c.stage} onChange={(e) => setStage(c, e.target.value)}>{Object.entries(STAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                  {c.tags.map((t) => <span key={t} className="rounded-full bg-gray-100 px-2 py-1">{t}</span>)}
                  <select className="rounded-full border px-2 py-1" defaultValue="" onChange={(e) => { enrollTo(c, e.target.value); e.target.value = ''; }}><option value="">シナリオに登録…</option>{scenarios.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  <button type="button" onClick={() => makeLink(c)} className="underline text-violet-700">この人用のリンク</button>
                </div>
                {c.fields && Object.keys(c.fields).length > 0 && <p className="text-[11px] text-gray-600 mt-1">{Object.entries(c.fields).map(([k, v]) => `${k}: ${String(v)}`).join('・')}</p>}
                {link?.contactId === c.id && <p className="mt-2 text-xs break-all bg-gray-50 rounded-lg p-2">{link.url}</p>}
                <p className="text-[11px] text-gray-400 mt-1">最終反応 {new Date(c.lastSeenAt).toLocaleString('ja-JP')}{c.enrollments.length ? `・配信 ${c.enrollments.map((e) => `${e.status}(${e.currentStep})`).join(', ')}` : ''}</p>
              </li>
            ))}
            {contacts.length === 0 && <li className="text-sm text-gray-500">まだ顧客はいません。LINE を追加した人・話しかけた人・自動返信に反応した人が自動で入ります。</li>}
          </ul>
        )}

        {summary && tab === 'settings' && (
          <div className="space-y-4">
            <LineSetup onChanged={load} />
            <section className="bg-white border rounded-2xl p-4 text-sm">
              <h2 className="font-bold mb-2">X・Instagram・TikTok からの反応を受け取る</h2>
              <p className="text-xs text-gray-600">各 SNS の公式 API（または自分で動かす受信プログラム）から、次の URL に <code className="bg-gray-100 px-1 rounded">{'{ key, externalUserId, text, displayName? }'}</code> を POST すると、自動返信が判定して返信文を返します。</p>
              <p className="mt-2 break-all text-xs"><span className="font-bold">URL:</span> {webhookUrl}</p>
              <p className="mt-1 break-all text-xs"><span className="font-bold">key:</span> {summary.webhookKey}</p>
            </section>
            <section className="bg-white border rounded-2xl p-4 space-y-2">
              <h2 className="font-bold">配信アカウント（X / Instagram / TikTok）</h2>
              <p className="text-xs text-gray-500">LINE は上の公式アカウントで送ります。他の SNS の配信アカウントはここに登録しておくと、エラーで健全性が下がったものを自動で休ませます。</p>
              <div className="grid grid-cols-3 gap-2">
                <select className={input} value={pool.channel} onChange={(e) => setPool({ ...pool, channel: e.target.value as Channel })}>{(['x', 'instagram', 'tiktok'] as Channel[]).map((c) => <option key={c} value={c}>{CH[c]}</option>)}</select>
                <input className={input} value={pool.label} onChange={(e) => setPool({ ...pool, label: e.target.value })} placeholder="名前" />
                <input type="number" className={input} value={pool.dailyLimit} onChange={(e) => setPool({ ...pool, dailyLimit: Number(e.target.value) })} placeholder="1日の上限" />
              </div>
              <button type="button" disabled={busy || !pool.label.trim()} onClick={addPool} className={btn}>追加</button>
              <ul className="space-y-2">
                {summary.health.pools.map((p) => (
                  <li key={p.id} className="rounded-2xl border p-3 text-sm">
                    <div className="flex justify-between gap-2"><p className="font-bold">{CH[p.channel as Channel] ?? p.channel}・{p.label}</p><span className={`font-black ${p.healthScore >= 70 ? 'text-emerald-600' : p.healthScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{p.healthScore}</span></div>
                    <p className="text-xs text-gray-500 mt-1">今日 {p.sentToday}/{p.dailyLimit} 通・エラー {p.errorCount}{p.lastError ? `・${p.lastError}` : ''}</p>
                    {(p.healthScore < 70 || p.cooldownUntil) && <button type="button" onClick={() => resetPool(p)} className="mt-2 text-xs underline text-violet-700">健全性を戻す</button>}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
