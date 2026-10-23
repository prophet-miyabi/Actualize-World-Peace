'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import api from '@/lib/api';
import { resizeImageToDataUrl } from '@/lib/image';

// AWP Page Intelligence — 最小の質問で、業種に合うページ構成案（3つ）と各セクションの画像候補を提案し、
// 確認・差し替えのうえでページに反映する。スマホでは1画面1テーマ。
type Opt = { key: string; label: string };
type Options = { industries: string[]; goals: Opt[]; tones: Opt[]; required: Opt[] };
type Assumption = { field: string; value: string; reason: string };
type ImageSpec = { role: string; subject: string; mood: string; tone: string; aspect: string; placement: string; mediaType: string };
type PSection = { id: string; name: string; purpose: string; heading: string; body: string; bullets: string[]; image: ImageSpec | null; cta: { label: string } | null; mobilePriority: number; postsBlock: boolean };
type Proposal = { id: string; name: string; concept: string; whyItWorks: string; sections: PSection[]; confidence: number; status: string };
type Candidate = { id: string; sectionId: string; role: string; subject: string; tone: string; aspectRatio: string; cropPolicy: string | null; uploadId: string | null; mimeType: string | null; width: number | null; height: number | null; licenseInfo: string; source: string; reason: string; alternatives: { subject: string; tone: string }[] | null; altText: string; status: string };
type Session = { id: string; industry: string; pageGoal: string; tone: string | null; requiredSections: string[]; assumptions: Assumption[] | null; status: string; lpId: string | null; selectedProposalId: string | null; selections: { images?: Record<string, string>; businessName?: string; slug?: string } | null; previewToken: string; proposals: Proposal[]; images: Candidate[]; researchSnapshot: { patterns: string[]; trustElements: string[]; differentiators: string[]; sourceSummary: string } | null };
type Check = { key: string; label: string; ok: boolean; note: string };

const STEPS = ['業種と目的', 'お客様と雰囲気', '必須要素', 'AWPの提案', '確認・差し替え', '公開'] as const;
const AGES = ['20代以下', '20〜30代', '30〜50代', '50代以上', '幅広く'];
const primaryBtn = 'w-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-violet-200 disabled:opacity-40 disabled:shadow-none';
const backBtn = 'w-full bg-gray-100 text-gray-700 py-4 rounded-2xl font-bold';
const inputCls = 'w-full p-4 border border-gray-200 rounded-2xl text-base bg-white focus:outline-none focus:ring-2 focus:ring-violet-400';
const chip = (on: boolean) => `px-4 py-3 rounded-2xl border-2 text-sm font-bold text-left transition ${on ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-gray-200 bg-white text-gray-700'}`;

export default function PageCreate() {
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <Flow />
    </Suspense>
  );
}

function Flow() {
  const router = useRouter();
  const q = useSearchParams();
  const lpId = q.get('lp');
  const [opts, setOpts] = useState<Options | null>(null);
  const [step, setStep] = useState(0);
  const [industry, setIndustry] = useState('');
  const [industryFree, setIndustryFree] = useState('');
  const [goal, setGoal] = useState('');
  const [segment, setSegment] = useState('');
  const [age, setAge] = useState('');
  const [area, setArea] = useState('');
  const [tone, setTone] = useState('');
  const [required, setRequired] = useState<string[]>([]);
  const [vp, setVp] = useState({ services: '', strengths: '', problems: '', priceBand: '', proof: '' });
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteRequired, setInviteRequired] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);
  const [previewMode, setPreviewMode] = useState<'mobile' | 'desktop'>('mobile');
  const [previewV, setPreviewV] = useState(0);
  const [reasonOpen, setReasonOpen] = useState<string | null>(null);
  const [moodFor, setMoodFor] = useState<string | null>(null);
  const [mood, setMood] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [slug, setSlug] = useState('');
  const [lineAddUrl, setLineAddUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string>('');

  useEffect(() => { api.get('/page-intelligence/options').then((r) => setOpts(r.data)).catch(() => setError('選択肢を読み込めませんでした')); }, []);

  const reload = useCallback(async (id: string) => {
    const { data } = await api.get(`/page-intelligence/sessions/${id}`);
    setSession(data.session);
    return data.session as Session;
  }, []);

  const industryValue = industry === 'その他' || !industry ? industryFree.trim() : industry;
  const proposal = useMemo(() => session?.proposals.find((p) => p.id === session.selectedProposalId) ?? null, [session]);
  const picked = session?.selections?.images ?? {};
  const previewUrl = session && proposal ? `/preview/intelligence?t=${encodeURIComponent(session.previewToken)}&p=${encodeURIComponent(proposal.id)}&v=${previewV}` : '';

  const fail = (e: any, fb: string) => { setError(e?.response?.data?.error || fb); setBusy(''); };

  // Step 2 → 3: セッション作成 → 前提の確認 → 調査 → 構成案3つ
  const startProposals = async () => {
    setError('');
    try {
      let s = session;
      if (!s) {
        setBusy('質問の内容を整理しています…');
        const body = { industry: industryValue, pageGoal: goal, targetAudience: { segment, ageRange: age, area }, tone, requiredSections: required, valueProps: vp, lpId: lpId || undefined };
        const { data } = await api.post('/page-intelligence/sessions', body);
        s = await reload(data.session.id);
        if ((s.assumptions ?? []).length && !confirmed) { setBusy(''); setStep(3); return; }
      }
      setStep(3);
      setBusy('同業種の人気ページを調べています…');
      await api.post(`/page-intelligence/sessions/${s.id}/research`);
      setBusy('構成案を3つ考えています（1分ほど）…');
      await api.post(`/page-intelligence/sessions/${s.id}/structure`);
      await reload(s.id);
      setBusy('');
    } catch (e) { fail(e, '提案を作れませんでした。時間をおいてお試しください'); }
  };

  const chooseProposal = async (p: Proposal) => {
    if (!session) return;
    setError('');
    try {
      setBusy('選んだ構成に合わせて、画像候補を用意しています（1〜2分）…');
      await api.patch(`/page-intelligence/sessions/${session.id}/selections`, { proposalId: p.id, businessName: businessName || undefined });
      await api.post(`/page-intelligence/sessions/${session.id}/images`, { proposalId: p.id });
      const s = await reload(session.id);
      const { data } = await api.get(`/page-intelligence/sessions/${s.id}/check`);
      setChecks(data.checks);
      setPreviewV((v) => v + 1);
      setBusy('');
      setStep(4);
    } catch (e) { fail(e, '画像候補を作れませんでした'); }
  };

  const select = async (sectionId: string, imageId: string) => {
    if (!session) return;
    try {
      await api.patch(`/page-intelligence/sessions/${session.id}/selections`, { images: { [sectionId]: imageId } });
      await reload(session.id);
      const { data } = await api.get(`/page-intelligence/sessions/${session.id}/check`);
      setChecks(data.checks);
      setPreviewV((v) => v + 1);
    } catch (e) { fail(e, '保存できませんでした'); }
  };

  const alternative = async (c: Candidate, moodText?: string) => {
    if (!session) return;
    setError('');
    try {
      setBusy('別の候補を作っています…');
      const { data } = await api.post(`/page-intelligence/sessions/${session.id}/images/${c.id}/alternative`, moodText ? { mood: moodText } : {});
      await reload(session.id);
      if (data.image?.source === 'generated') await select(c.sectionId, data.image.id);
      setBusy(''); setMoodFor(null); setMood('');
    } catch (e) { fail(e, '別の候補を作れませんでした'); }
  };

  const onUpload = async (file: File) => {
    if (!session || !uploadTarget.current) return;
    setError('');
    try {
      setBusy('写真を送っています…');
      const dataUrl = await resizeImageToDataUrl(file, 1600, 0.85);
      await api.post(`/page-intelligence/sessions/${session.id}/images/upload`, { sectionId: uploadTarget.current, dataUrl });
      await reload(session.id);
      const { data } = await api.get(`/page-intelligence/sessions/${session.id}/check`);
      setChecks(data.checks);
      setPreviewV((v) => v + 1);
      setBusy('');
    } catch (e) { fail(e, 'アップロードできませんでした'); }
  };

  const apply = async () => {
    if (!session) return;
    setError('');
    try {
      setBusy('ページに反映しています…');
      const { data } = await api.post(`/page-intelligence/sessions/${session.id}/apply`, { businessName: businessName.trim(), slug: session.lpId ? undefined : slug, lineAddUrl: lineAddUrl || null, inviteCode: inviteCode || null });
      router.push(`/dashboard?lp=${encodeURIComponent(data.lpId)}&created=1`);
    } catch (e: any) { if (e?.response?.data?.code === 'invite_required') setInviteRequired(true); fail(e, '反映できませんでした'); }
  };

  const slugValid = /^[a-z0-9-]{3,40}$/.test(slug);
  const sectionsWithImage = proposal?.sections.filter((s) => s.image) ?? [];
  const candidatesFor = (sectionId: string) => (session?.images ?? []).filter((c) => c.sectionId === sectionId);
  const chosenId = (sectionId: string) => picked[sectionId] ?? candidatesFor(sectionId).find((c) => c.source === 'generated' || c.source === 'upload')?.id ?? '';

  return (
    <div className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-white px-4 pt-6 pb-24">
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.target.value = ''; }} />
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <Link href="/create" className="text-sm text-gray-500">← もどる</Link>
          <span className="text-xs font-bold text-violet-700 bg-violet-100 rounded-full px-3 py-1">AWP Page Intelligence</span>
        </div>
        <div className="flex gap-1.5 mb-2" aria-hidden>
          {STEPS.map((label, i) => <div key={label} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-gradient-to-r from-fuchsia-500 to-violet-500' : 'bg-gray-200'}`} />)}
        </div>
        <p className="text-xs font-bold text-gray-500 mb-6">STEP {step + 1} / {STEPS.length}・{STEPS[step]}</p>

        {error && <p className="mb-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-sm p-3">{error}</p>}
        {busy && (
          <div className="mb-4 rounded-2xl bg-white border border-violet-100 p-4 flex items-center gap-3">
            <span className="w-5 h-5 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" aria-hidden />
            <p className="text-sm font-bold text-violet-800">{busy}</p>
          </div>
        )}

        {step === 0 && opts && (
          <div className="space-y-7">
            <div>
              <h1 className="text-2xl font-black mb-1">どんなお仕事ですか？</h1>
              <p className="text-gray-600 text-sm">業種に合わせて、人気ページの型を AWP が調べます。</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {opts.industries.map((x) => <button key={x} type="button" onClick={() => setIndustry(x)} className={chip(industry === x)}>{x}</button>)}
            </div>
            {(industry === 'その他' || industry === '') && <input className={inputCls} placeholder="業種を一言で（例: 出張料理）" value={industryFree} onChange={(e) => setIndustryFree(e.target.value)} />}
            <div>
              <p className="font-bold mb-2">ページの目的は？</p>
              <div className="grid grid-cols-1 gap-2">
                {opts.goals.map((g) => <button key={g.key} type="button" onClick={() => setGoal(g.key)} className={chip(goal === g.key)}>{g.label}</button>)}
              </div>
            </div>
            <button type="button" disabled={!industryValue || !goal} onClick={() => setStep(1)} className={primaryBtn}>つぎへ：お客様と雰囲気</button>
          </div>
        )}

        {step === 1 && opts && (
          <div className="space-y-7">
            <div>
              <h1 className="text-2xl font-black mb-1">どんなお客様に？</h1>
              <p className="text-gray-600 text-sm">分からない項目はとばしてOK。AWP が業種から仮置きします。</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[['b2c', '個人のお客様'], ['b2b', '法人・事業者']].map(([k, l]) => <button key={k} type="button" onClick={() => setSegment(k)} className={chip(segment === k)}>{l}</button>)}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {AGES.map((a) => <button key={a} type="button" onClick={() => setAge(a)} className={chip(age === a)}>{a}</button>)}
            </div>
            <input className={inputCls} placeholder="地域（例: 渋谷・オンライン全国）" value={area} onChange={(e) => setArea(e.target.value)} />
            <div>
              <p className="font-bold mb-2">好みの雰囲気</p>
              <div className="grid grid-cols-3 gap-2">
                {opts.tones.map((t) => <button key={t.key} type="button" onClick={() => setTone(t.key)} className={chip(tone === t.key)}>{t.label}</button>)}
              </div>
            </div>
            <div className="space-y-3">
              <button type="button" onClick={() => setStep(2)} className={primaryBtn}>つぎへ：必須要素</button>
              <button type="button" onClick={() => setStep(0)} className={backBtn}>もどる</button>
            </div>
          </div>
        )}

        {step === 2 && opts && (
          <div className="space-y-7">
            <div>
              <h1 className="text-2xl font-black mb-1">ページに必ず入れたいものは？</h1>
              <p className="text-gray-600 text-sm">複数選べます。下の3つは分かる範囲で（なくてもOK）。</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {opts.required.map((r) => { const on = required.includes(r.key); return <button key={r.key} type="button" onClick={() => setRequired(on ? required.filter((k) => k !== r.key) : [...required, r.key])} className={chip(on)}>{on ? '✓ ' : ''}{r.label}</button>; })}
            </div>
            <div className="space-y-3">
              <label className="block"><span className="text-sm font-bold">提供しているサービス・商品</span><input className={`${inputCls} mt-1`} placeholder="例: カット・カラー・ヘッドスパ" value={vp.services} onChange={(e) => setVp({ ...vp, services: e.target.value })} /></label>
              <label className="block"><span className="text-sm font-bold">強み（1〜3つ、「、」区切り）</span><input className={`${inputCls} mt-1`} placeholder="例: 完全個室、再現しやすいカット、駅徒歩3分" value={vp.strengths} onChange={(e) => setVp({ ...vp, strengths: e.target.value })} /></label>
              <label className="block"><span className="text-sm font-bold">事実として書ける実績（任意）</span><input className={`${inputCls} mt-1`} placeholder="例: 開業8年" value={vp.proof} onChange={(e) => setVp({ ...vp, proof: e.target.value })} /><span className="text-xs text-gray-500">書いたものだけがページに載ります。AWP が実績を作ることはありません。</span></label>
            </div>
            <div className="space-y-3">
              <button type="button" disabled={!!busy} onClick={startProposals} className={primaryBtn}>AWP に構成案を3つ出してもらう</button>
              <button type="button" onClick={() => setStep(1)} className={backBtn}>もどる</button>
            </div>
          </div>
        )}

        {step === 3 && session && (
          <div className="space-y-6">
            {!confirmed && (session.assumptions ?? []).length > 0 && session.proposals.length === 0 && !busy && (
              <div className="rounded-3xl bg-white border border-violet-100 shadow-sm p-5">
                <h1 className="text-xl font-black mb-1">この前提で作成しますか？</h1>
                <p className="text-sm text-gray-600 mb-4">未入力だった項目を、業種と目的から仮置きしました。あとから変えられます。</p>
                <ul className="space-y-2 mb-5">
                  {(session.assumptions ?? []).map((a) => (
                    <li key={a.field} className="rounded-2xl bg-violet-50 p-3 text-sm"><span className="font-bold">{a.value}</span><span className="block text-xs text-gray-600 mt-0.5">{a.reason}</span></li>
                  ))}
                </ul>
                <div className="space-y-2">
                  <button type="button" className={primaryBtn} onClick={() => { setConfirmed(true); void startProposals(); }}>この前提で進める</button>
                  <button type="button" className={backBtn} onClick={() => { setSession(null); setStep(1); }}>入力し直す</button>
                </div>
              </div>
            )}
            {session.proposals.length > 0 && (
              <>
                <div>
                  <h1 className="text-2xl font-black mb-1">構成案を3つ用意しました</h1>
                  <p className="text-gray-600 text-sm">同業種（{session.industry}）の人気ページの型をもとに、狙いの違う3案です。1つ選ぶと、各セクションの画像候補を用意します。</p>
                </div>
                {session.researchSnapshot && (
                  <details className="rounded-2xl bg-white border border-gray-100 p-4 text-sm">
                    <summary className="font-bold cursor-pointer">調べた内容を見る</summary>
                    <ul className="mt-3 space-y-1.5 text-gray-700 list-disc pl-5">{session.researchSnapshot.patterns.slice(0, 5).map((x, i) => <li key={i}>{x}</li>)}</ul>
                    <p className="mt-3 text-xs text-gray-500">{session.researchSnapshot.sourceSummary}</p>
                  </details>
                )}
                <div className="space-y-4">
                  {session.proposals.map((p, i) => (
                    <div key={p.id} className="rounded-3xl bg-white border-2 border-gray-100 shadow-sm p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="text-[11px] font-bold text-violet-700 tracking-widest">案 {String.fromCharCode(65 + i)}</p><p className="text-lg font-black">{p.name}</p></div>
                        <span className="text-[11px] font-bold text-gray-500 bg-gray-100 rounded-full px-2 py-1 shrink-0">確信度 {Math.round(p.confidence * 100)}%</span>
                      </div>
                      <p className="text-sm text-gray-800 mt-2 font-bold">{p.concept}</p>
                      <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{p.whyItWorks}</p>
                      <ol className="mt-4 space-y-1.5">
                        {p.sections.map((s, j) => (
                          <li key={s.id} className="flex gap-2 text-sm">
                            <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-800 text-[11px] font-bold flex items-center justify-center shrink-0">{j + 1}</span>
                            <span className="min-w-0"><span className="font-bold">{s.name}</span>{s.heading && <span className="text-gray-600">：{s.heading}</span>}
                              {s.image && <span className="block text-xs text-gray-500">画像: {s.image.subject}（{s.image.mood}）</span>}
                              {!s.image && <span className="block text-xs text-gray-400">画像なし（文字で十分）</span>}
                            </span>
                          </li>
                        ))}
                      </ol>
                      <button type="button" disabled={!!busy} onClick={() => chooseProposal(p)} className={`${primaryBtn} mt-4 text-base py-3.5`}>この構成で画像候補を見る</button>
                    </div>
                  ))}
                </div>
                <button type="button" disabled={!!busy} onClick={() => { setConfirmed(true); void startProposals(); }} className={backBtn}>別の3案を出し直す</button>
              </>
            )}
          </div>
        )}

        {step === 4 && session && proposal && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-black mb-1">画像を確認して、必要なら差し替え</h1>
              <p className="text-gray-600 text-sm">AWP が各セクションに合う画像を仮置きしました。選ばなくても最適な候補が使われ、あとから差し替えられます。</p>
            </div>

            {/* プレビュー（iframe で 375px / 1024px を描き、カード幅に縮小） */}
            <div className="rounded-3xl bg-white border border-gray-100 shadow-sm p-3">
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-sm font-bold">プレビュー</p>
                <div className="flex gap-1 text-xs font-bold">
                  <button type="button" onClick={() => setPreviewMode('mobile')} className={`px-3 py-1.5 rounded-full ${previewMode === 'mobile' ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>スマホ</button>
                  <button type="button" onClick={() => setPreviewMode('desktop')} className={`px-3 py-1.5 rounded-full ${previewMode === 'desktop' ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}>PC</button>
                </div>
              </div>
              <ScaledFrame src={previewUrl} width={previewMode === 'mobile' ? 375 : 1024} height={previewMode === 'mobile' ? 740 : 640} />
            </div>

            {/* 公開前チェック */}
            {checks.length > 0 && (
              <ul className="grid grid-cols-2 gap-2">
                {checks.map((c) => (
                  <li key={c.key} className={`rounded-2xl p-3 text-xs border ${c.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                    <p className="font-bold">{c.ok ? '✓ ' : '！ '}{c.label}</p>
                    <p className="text-gray-700 mt-0.5 leading-relaxed">{c.note}</p>
                  </li>
                ))}
              </ul>
            )}

            {/* セクションごとの画像候補 */}
            <div className="space-y-4">
              {sectionsWithImage.map((s) => {
                const cands = candidatesFor(s.id);
                const current = chosenId(s.id);
                const none = picked[s.id] === 'none';
                return (
                  <div key={s.id} className="rounded-3xl bg-white border border-gray-100 shadow-sm p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div><p className="font-black">{s.name}</p><p className="text-xs text-gray-500">役割: {s.image!.role}・{s.image!.aspect}・{s.image!.mediaType}</p></div>
                      <button type="button" onClick={() => select(s.id, 'none')} className={`text-xs font-bold px-3 py-1.5 rounded-full border ${none ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600'}`}>画像なし</button>
                    </div>
                    <ul className="space-y-3">
                      {cands.map((c) => {
                        const has = c.source === 'generated' || c.source === 'upload';
                        const selected = !none && current === c.id;
                        const thumb = c.source === 'generated' || (c.source === 'upload' && !c.uploadId) ? `/api/page-intelligence/images/${c.id}` : null;
                        return (
                          <li key={c.id} className={`rounded-2xl border-2 p-3 ${selected ? 'border-violet-500' : 'border-gray-100'} ${c.status === 'rejected' ? 'opacity-50' : ''}`}>
                            <div className="flex gap-3">
                              <div className="w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center text-[10px] text-gray-500 text-center p-1">
                                {thumb ? <img src={thumb} alt={c.altText} width={96} height={96} className="w-full h-full object-cover" loading="lazy" /> : c.source === 'upload' ? 'あなたの写真' : c.status === 'failed' ? '生成に失敗' : '未生成（指示書）'}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold leading-snug">{c.subject}</p>
                                <p className="text-xs text-gray-600 mt-1 leading-relaxed line-clamp-2">{c.reason}</p>
                                <p className="text-[10px] text-gray-400 mt-1">{c.licenseInfo}</p>
                              </div>
                            </div>
                            {reasonOpen === c.id && (
                              <div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
                                <p><span className="font-bold">理由:</span> {c.reason}</p>
                                <p><span className="font-bold">色調:</span> {c.tone}</p>
                                {c.cropPolicy && <p><span className="font-bold">スマホでの見せ方:</span> {c.cropPolicy}</p>}
                                <p><span className="font-bold">代替テキスト:</span> {c.altText}</p>
                                {c.alternatives?.length ? <p><span className="font-bold">他の方向:</span> {c.alternatives.map((a) => a.subject).join(' / ')}</p> : null}
                              </div>
                            )}
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold">
                              <button type="button" disabled={!has || !!busy} onClick={() => select(s.id, c.id)} className={`py-2.5 rounded-xl ${selected ? 'bg-violet-600 text-white' : 'bg-gray-900 text-white disabled:opacity-40'}`}>{selected ? '使用中' : 'この画像を使う'}</button>
                              <button type="button" disabled={!!busy} onClick={() => alternative(c)} className="py-2.5 rounded-xl bg-gray-100">別の候補を見る</button>
                              <button type="button" disabled={!!busy} onClick={() => { setMoodFor(moodFor === c.id ? null : c.id); setMood(''); }} className="py-2.5 rounded-xl bg-gray-100">雰囲気を変更する</button>
                              <button type="button" onClick={() => setReasonOpen(reasonOpen === c.id ? null : c.id)} className="py-2.5 rounded-xl bg-gray-100">この画像の理由を見る</button>
                            </div>
                            {moodFor === c.id && (
                              <div className="mt-2 flex gap-2">
                                <input className="flex-1 p-3 border border-gray-200 rounded-xl text-sm" placeholder="例: もっと明るく／夜の落ち着いた雰囲気" value={mood} onChange={(e) => setMood(e.target.value)} />
                                <button type="button" disabled={!mood.trim() || !!busy} onClick={() => alternative(c, mood.trim())} className="px-4 rounded-xl bg-gray-900 text-white text-xs font-bold disabled:opacity-40">作る</button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    <button type="button" disabled={!!busy} onClick={() => { uploadTarget.current = s.id; fileRef.current?.click(); }} className="mt-3 w-full py-3 rounded-2xl border-2 border-dashed border-violet-300 bg-violet-50 text-violet-800 text-sm font-bold">自分の画像をアップロードする</button>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3">
              <button type="button" disabled={!!busy} onClick={() => setStep(5)} className={primaryBtn}>つぎへ：公開の準備</button>
              <button type="button" onClick={() => setStep(3)} className={backBtn}>構成案を選び直す</button>
            </div>
          </div>
        )}

        {step === 5 && session && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-black mb-1">あと少しで公開</h1>
              <p className="text-gray-600 text-sm">名前とURLを決めて、ページに反映します。公開後も内容・画像は変えられます。</p>
            </div>
            <label className="block"><span className="text-sm font-bold">お店・サービス・活動の名前</span><input className={`${inputCls} mt-1`} value={businessName} onChange={(e) => setBusinessName(e.target.value)} /></label>
            {!session.lpId && (
              <label className="block">
                <span className="text-sm font-bold">ページのURL</span>
                <div className="mt-1 flex items-center rounded-2xl border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-violet-400">
                  <span className="pl-4 text-gray-400 text-sm">/</span>
                  <input type="text" inputMode="url" autoCapitalize="none" placeholder="my-shop" className="flex-1 p-4 pl-1 rounded-2xl text-base bg-transparent focus:outline-none" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
                </div>
                <span className={`text-xs ${slug && !slugValid ? 'text-red-600' : 'text-gray-500'}`}>半角の英小文字・数字・ハイフンで3〜40文字</span>
              </label>
            )}
            <label className="block"><span className="text-sm font-bold">LINE公式アカウントの友だち追加URL（任意）</span><input type="url" className={`${inputCls} mt-1`} placeholder="https://lin.ee/..." value={lineAddUrl} onChange={(e) => setLineAddUrl(e.target.value)} /></label>
            {inviteRequired && (
              <label className="block"><span className="text-sm font-bold">招待コード</span><input className={`${inputCls} mt-1`} autoCapitalize="none" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="いまは招待制で運用しています" /><span className="text-xs text-gray-500">招待コードをお持ちでない方は、公開のお知らせをお待ちください。</span></label>
            )}
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">公開の最終確認はあなたが行います。AWP が勝手に公開することはありません。ページは反映後、ダッシュボードから確認・修正できます。</div>
            <div className="space-y-3">
              <button type="button" disabled={!!busy || !businessName.trim() || (!session.lpId && !slugValid)} onClick={apply} className={primaryBtn}>{session.lpId ? 'このページに反映する' : 'ページを作成する'}</button>
              <button type="button" onClick={() => setStep(4)} className={backBtn}>もどる</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 指定幅で描いた iframe を、カードの幅に合わせて縮小表示する（スマホ用スタイルのまま確認できる）
function ScaledFrame({ src, width, height }: { src: string; width: number; height: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / width));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={boxRef} className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-gray-50" style={{ height: scale ? height * scale : height }}>
      {scale > 0 && src && (
        <iframe src={src} title="プレビュー" style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left', border: 0 }} />
      )}
    </div>
  );
}
