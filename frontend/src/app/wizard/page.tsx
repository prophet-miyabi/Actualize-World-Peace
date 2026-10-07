'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import TemplateGallery from '@/components/lp/TemplateGallery';

type Purpose = 'business' | 'creator';

const STEPS = ['はじめる', 'あなたのこと', '見た目', 'しあげ'] as const;

// 目的ごとに入力欄の言葉づかいを変える（AIの書き方もサーバー側で切り替わる）
const COPY: Record<Purpose, {
  aiPlaceholder: string; name: string; catch: string; strength: string; slugExample: string;
}> = {
  business: {
    aiPlaceholder: '例：渋谷にある20代向けの小さな美容室',
    name: 'お店・サービスの名前',
    catch: 'キャッチコピー（お客様の「こうなりたい」に応える一言）',
    strength: '強み',
    slugExample: 'my-shop'
  },
  creator: {
    aiPlaceholder: '例：ゆるい動物のイラストを描いています。グッズも販売中',
    name: '活動名・アーティスト名',
    catch: 'キャッチコピー（あなたの世界観をひとことで）',
    strength: '魅力',
    slugExample: 'my-art'
  }
};

const primaryBtn = 'w-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white py-4 rounded-2xl font-bold text-lg shadow-lg shadow-violet-200 disabled:opacity-40 disabled:shadow-none';
const backBtn = 'w-full bg-gray-100 text-gray-700 py-4 rounded-2xl font-bold';
const inputCls = 'w-full p-4 border border-gray-200 rounded-2xl text-base bg-white focus:outline-none focus:ring-2 focus:ring-violet-400';

export default function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [purpose, setPurpose] = useState<Purpose>('business');
  const [form, setForm] = useState({
    businessName: '', slug: '', heroTitle: '',
    strengths: ['', '', ''], socialProof: '', scarcityOffer: '',
    siteType: 'lp' as 'lp' | 'hp', templateKey: null as string | null,
    lineAddUrl: ''
  });
  const [aiDesc, setAiDesc] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const c = COPY[purpose];

  const choosePurpose = (p: Purpose) => {
    setPurpose(p);
    setStep(1);
  };

  const handleAiGenerate = async () => {
    if (!aiDesc.trim()) { setAiError('まずは一言、書いてみてください'); return; }
    setAiLoading(true);
    setAiError('');
    try {
      const { data } = await api.post('/lp/ai-generate', { description: aiDesc, purpose });
      setForm(f => ({
        ...f,
        // 実績・特典は事実が必要なためAIには作らせない（本人が入力した値を残す）
        heroTitle: data.heroTitle,
        strengths: data.strengths,
        slug: f.slug || data.suggestedSlug
      }));
    } catch (err: any) {
      setAiError(err?.response?.data?.error || 'AIがうまく書けませんでした。もう一度ためしてみてください');
    } finally {
      setAiLoading(false);
    }
  };

  const slugValid = /^[a-z0-9-]{3,40}$/.test(form.slug);
  const step1Valid = form.businessName.trim() && slugValid && form.heroTitle.trim() && form.strengths.every(s => s.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError('');
    try {
      const { data } = await api.post('/lp/wizard', { ...form, purpose, description: aiDesc });
      router.push(`/dashboard?lp=${encodeURIComponent(data.lp.id)}&created=1`);
    } catch (err: any) {
      setSubmitError(err?.response?.data?.error || '作成できませんでした。時間をおいてもう一度お試しください');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-fuchsia-50 via-white to-white px-4 pt-6 pb-10">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <Link href="/dashboard" className="text-sm text-gray-500">← もどる</Link>
          <span className="text-xs font-bold text-violet-700 bg-violet-100 rounded-full px-3 py-1">公開まで無料</span>
        </div>

        {/* 進み具合 */}
        <div className="flex gap-1.5 mb-2" aria-hidden>
          {STEPS.map((label, i) => (
            <div key={label} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-gradient-to-r from-fuchsia-500 to-violet-500' : 'bg-gray-200'}`} />
          ))}
        </div>
        <p className="text-xs font-bold text-gray-500 mb-6">STEP {step + 1} / {STEPS.length}・{STEPS[step]}</p>

        {step === 0 && (
          <div>
            <h1 className="text-2xl font-black mb-2">なにを、はじめる？</h1>
            <p className="text-gray-600 mb-6">えらんだ内容にあわせて、AIが文章の雰囲気を変えてくれます。</p>
            <div className="space-y-4">
              <button type="button" onClick={() => choosePurpose('business')}
                className="w-full text-left p-5 rounded-3xl bg-white border-2 border-gray-100 shadow-sm active:scale-[0.99] transition hover:border-violet-400">
                <p className="text-lg font-black">お店・ビジネス</p>
                <p className="text-sm text-gray-600 mt-1">お店、サロン、教室、個人事業、副業のサービスなど。お客様に見つけてもらうページに。</p>
              </button>
              <button type="button" onClick={() => choosePurpose('creator')}
                className="w-full text-left p-5 rounded-3xl bg-white border-2 border-gray-100 shadow-sm active:scale-[0.99] transition hover:border-fuchsia-400">
                <p className="text-lg font-black">クリエイター活動</p>
                <p className="text-sm text-gray-600 mt-1">音楽、イラスト、写真、動画、ハンドメイドなど。作品と世界観を届けるページに。</p>
              </button>
            </div>
            <Link href="/builder" className="mt-6 block text-center rounded-3xl border-2 border-dashed border-violet-300 bg-violet-50 p-4">
              <span className="block font-black text-violet-700">💬 AIとおしゃべりして作る</span>
              <span className="block text-xs text-gray-600 mt-1">入力フォームが苦手なら、質問に答えるだけでもOK</span>
            </Link>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-black mb-2">{purpose === 'creator' ? 'あなたの活動を教えて' : 'あなたのお店・サービスを教えて'}</h1>
              <p className="text-gray-600">一言書くだけで、AIが下の項目をうめてくれます。あとから自由に直せます。</p>
            </div>

            <div className="rounded-3xl bg-white border border-violet-100 shadow-sm p-5">
              <p className="font-bold mb-3">AIにおまかせ</p>
              <textarea rows={2} placeholder={c.aiPlaceholder} className={inputCls}
                value={aiDesc} onChange={e => setAiDesc(e.target.value)} />
              <button type="button" onClick={handleAiGenerate} disabled={aiLoading}
                className="mt-3 w-full bg-gray-900 text-white py-3.5 rounded-2xl font-bold disabled:opacity-50">
                {aiLoading ? 'AIが考え中…' : 'AIに書いてもらう'}
              </button>
              {aiError && <p className="text-red-600 text-sm mt-2">{aiError}</p>}
            </div>

            <div className="space-y-4">
              <label className="block">
                <span className="text-sm font-bold">{c.name}</span>
                <input type="text" className={`${inputCls} mt-1`} value={form.businessName}
                  onChange={e => setForm({ ...form, businessName: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-sm font-bold">ページのURL</span>
                <div className="mt-1 flex items-center rounded-2xl border border-gray-200 bg-white focus-within:ring-2 focus-within:ring-violet-400">
                  <span className="pl-4 text-gray-400 text-sm">/</span>
                  <input type="text" inputMode="url" autoCapitalize="none" placeholder={c.slugExample}
                    className="flex-1 p-4 pl-1 rounded-2xl text-base bg-transparent focus:outline-none"
                    value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase() })} />
                </div>
                <span className={`text-xs ${form.slug && !slugValid ? 'text-red-600' : 'text-gray-500'}`}>半角の英小文字・数字・ハイフンで3〜40文字</span>
              </label>
              <label className="block">
                <span className="text-sm font-bold">{c.catch}</span>
                <input type="text" className={`${inputCls} mt-1`} value={form.heroTitle}
                  onChange={e => setForm({ ...form, heroTitle: e.target.value })} />
              </label>
              {form.strengths.map((v, i) => (
                <label key={i} className="block">
                  <span className="text-sm font-bold">{c.strength} {i + 1}</span>
                  <input type="text" className={`${inputCls} mt-1`} value={v}
                    onChange={e => {
                      const s = [...form.strengths];
                      s[i] = e.target.value;
                      setForm({ ...form, strengths: s });
                    }} />
                </label>
              ))}
            </div>

            <div className="space-y-3">
              <button type="button" disabled={!step1Valid} onClick={() => setStep(2)} className={primaryBtn}>つぎへ：見た目をえらぶ</button>
              <button type="button" onClick={() => setStep(0)} className={backBtn}>もどる</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-8">
            <div>
              <h1 className="text-2xl font-black mb-2">見た目をえらぼう</h1>
              <p className="text-gray-600">入力した内容で、実際の仕上がりを見ながら選べます。あとから変えてもOK。</p>
            </div>
            <section>
              <p className="font-bold mb-3">ページのかたち</p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ['lp', '1ページ', 'ぜんぶを縦に並べる。シンプルに伝えたい人に'],
                  ['hp', '複数ページ', '内容ごとにページを分ける。情報が多い人に']
                ] as const).map(([key, title, body]) => (
                  <button key={key} type="button" onClick={() => setForm({ ...form, siteType: key })}
                    className={`text-left p-4 rounded-2xl border-2 ${form.siteType === key ? 'border-violet-500 bg-violet-50' : 'border-gray-200 bg-white'}`}>
                    <p className="font-bold">{title}</p>
                    <p className="text-xs text-gray-600 mt-1">{body}</p>
                  </button>
                ))}
              </div>
            </section>
            <section>
              <p className="font-bold mb-3">デザイン</p>
              <TemplateGallery
                businessName={form.businessName}
                heroTitle={form.heroTitle}
                strengths={form.strengths}
                purpose={purpose}
                value={form.templateKey}
                onChange={(key) => setForm({ ...form, templateKey: key })}
              />
            </section>
            <div className="space-y-3">
              <button type="button" disabled={!form.templateKey} onClick={() => setStep(3)} className={primaryBtn}>つぎへ：しあげ</button>
              <button type="button" onClick={() => setStep(1)} className={backBtn}>もどる</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <h1 className="text-2xl font-black mb-2">あと少し！</h1>
              <p className="text-gray-600">ここは全部「なくてもOK」です。あとからダッシュボードで追加できます。</p>
            </div>

            <label className="block">
              <span className="text-sm font-bold">LINE公式アカウントの友だち追加URL</span>
              <input type="url" inputMode="url" autoCapitalize="none" placeholder="https://lin.ee/..." className={`${inputCls} mt-1`}
                value={form.lineAddUrl} onChange={e => setForm({ ...form, lineAddUrl: e.target.value })} />
              <span className="text-xs text-gray-500">登録すると、ページに「LINEで友だち追加」ボタンが出ます。</span>
            </label>

            <div className="rounded-3xl bg-amber-50 border border-amber-200 p-5 space-y-4">
              <p className="text-sm text-amber-900">
                <strong>本当のことだけ</strong>書いてください。事実とちがう実績や特典を書くと、法律（景品表示法）に触れるおそれがあります。
              </p>
              <label className="block">
                <span className="text-sm font-bold">実績</span>
                <input type="text" placeholder={purpose === 'creator' ? '例：個展を3回開催' : '例：開業10年'} className={`${inputCls} mt-1`}
                  value={form.socialProof} onChange={e => setForm({ ...form, socialProof: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-sm font-bold">いま実施中の特典</span>
                <input type="text" placeholder={purpose === 'creator' ? '例：初回のご依頼は送料無料' : '例：初回限定 カット20%オフ'} className={`${inputCls} mt-1`}
                  value={form.scarcityOffer} onChange={e => setForm({ ...form, scarcityOffer: e.target.value })} />
              </label>
            </div>

            {submitError && <p className="text-red-600 text-sm">{submitError}</p>}
            <div className="space-y-3">
              <button type="submit" disabled={submitting} className={primaryBtn}>
                {submitting ? 'ページをつくっています…' : '無料で公開する！'}
              </button>
              <button type="button" onClick={() => setStep(2)} className={backBtn}>もどる</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
