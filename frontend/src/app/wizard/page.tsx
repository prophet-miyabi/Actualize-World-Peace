'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import TemplateGallery from '@/components/lp/TemplateGallery';

const STEPS = ['基本情報', '完成イメージ', '詳細・LINE連携'] as const;

export default function Wizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    businessName: '', slug: '', heroTitle: '',
    strengths: ['', '', ''], socialProof: '', scarcityOffer: '',
    siteType: 'lp' as 'lp' | 'hp', templateKey: null as string | null,
    channelId: '', channelSecret: '', channelAccessToken: ''
  });
  const [hasLine, setHasLine] = useState<'yes' | 'no' | null>(null);
  const [aiDesc, setAiDesc] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAiGenerate = async () => {
    if (!aiDesc.trim()) { setAiError('事業内容を一言入力してください'); return; }
    setAiLoading(true);
    setAiError('');
    try {
      const { data } = await api.post('/lp/ai-generate', { description: aiDesc });
      setForm(f => ({
        ...f,
        // 実績・特典は事実が必要なためAIには作らせない（店主が入力した値を残す）
        heroTitle: data.heroTitle,
        strengths: data.strengths,
        slug: f.slug || data.suggestedSlug
      }));
    } catch (err: any) {
      setAiError(err?.response?.data?.error || 'AI生成に失敗しました');
    } finally {
      setAiLoading(false);
    }
  };

  const step1Valid = form.businessName.trim() && /^[a-z0-9-]{3,40}$/.test(form.slug) && form.heroTitle.trim() && form.strengths.every(s => s.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // 事業内容の一言は、AIによるデザイン作成の手がかりとしても使う
      const payload = hasLine === 'yes'
        ? { ...form, description: aiDesc }
        : { ...form, channelId: '', channelSecret: '', channelAccessToken: '', description: aiDesc };
      const { data } = await api.post('/lp/wizard', payload);
      if (data.webhook && data.webhook.ok === false) {
        alert(`LPは作成できましたが、LINEのWebhook自動設定でエラーが出ました：\n${data.webhook.reason}\n\n入力したトークンをご確認のうえ、ダッシュボードから再設定してください。`);
      }
      router.push(`/dashboard?lp=${encodeURIComponent(data.lp.id)}`);
    } catch (err: any) {
      alert(err?.response?.data?.error || '作成に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 sm:py-12 px-3">
      <div className="max-w-3xl mx-auto bg-white p-5 sm:p-10 rounded-2xl shadow-sm border">
        <h1 className="text-2xl sm:text-3xl font-bold mb-2">LP & LINE自動設定ウィザード</h1>
        <p className="text-gray-500 mb-6">3ステップで試作できます。<strong className="text-gray-700">お支払いは、仕上がりを確認してからで大丈夫です。</strong></p>

        {/* 進捗（スマホでも一目でわかるように） */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1 flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${i <= step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {i + 1}
              </div>
              <span className={`text-xs sm:text-sm font-bold hidden sm:inline ${i <= step ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 ${i < step ? 'bg-blue-600' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-6">
            <div className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-5 sm:p-6">
              <div className="flex items-start gap-3 mb-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-white">
                    <path d="M12 3l1.8 4.6L18 9.5l-4.2 1.9L12 16l-1.8-4.6L6 9.5l4.2-1.9L12 3z" fill="currentColor" />
                    <path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z" fill="currentColor" opacity="0.7" />
                  </svg>
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-gray-900">AIにおまかせ入力</h2>
                    <span className="text-[10px] font-bold tracking-wide text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full">AI</span>
                  </div>
                  <p className="text-sm text-gray-600 mt-1">事業内容を一言書くだけで、下の項目をAIが自動で埋めます。あとから自由に編集できます。</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <input type="text" placeholder="例：渋谷にある20代女性向けの小さな美容室"
                  className="flex-1 p-3 border border-gray-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={aiDesc} onChange={e => setAiDesc(e.target.value)} />
                <button type="button" onClick={handleAiGenerate} disabled={aiLoading}
                  className="bg-gradient-to-br from-blue-600 to-indigo-600 text-white px-6 py-3 rounded-lg font-bold shadow-sm hover:shadow-md transition-shadow disabled:opacity-50 whitespace-nowrap">
                  {aiLoading ? '生成中...' : 'AIで自動入力'}
                </button>
              </div>
              {aiError && <p className="text-red-600 text-sm mt-2">{aiError}</p>}
            </div>

            <section>
              <h2 className="text-xl font-bold border-b pb-2 mb-4">基本情報</h2>
              <input type="text" placeholder="事業名/店舗名" className="w-full p-3 border rounded-lg mb-4"
                value={form.businessName} onChange={e => setForm({ ...form, businessName: e.target.value })} required />
              <input type="text" placeholder="公開用URL (半角英数字 ex: my-shop)" className="w-full p-3 border rounded-lg mb-4"
                value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} required />
              <input type="text" placeholder="メインキャッチコピー (悩みを解決する一言)" className="w-full p-3 border rounded-lg mb-4"
                value={form.heroTitle} onChange={e => setForm({ ...form, heroTitle: e.target.value })} required />
              {form.strengths.map((_, i) => (
                <input key={i} type="text" placeholder={`強み ${i + 1}`} className="w-full p-3 border rounded-lg mb-4"
                  value={form.strengths[i]} onChange={e => {
                    const s = [...form.strengths];
                    s[i] = e.target.value;
                    setForm({ ...form, strengths: s });
                  }} required />
              ))}
            </section>

            <button type="button" disabled={!step1Valid} onClick={() => setStep(1)}
              className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 disabled:opacity-40">
              次へ：完成イメージを見る
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-8">
            <section>
              <h2 className="text-xl font-bold border-b pb-2 mb-4">ページの種類</h2>
              <p className="text-sm text-gray-500 mb-4">中身（メニューやアクセスなどの機能）はどちらでも同じものが使えます。見せ方だけが変わります。</p>
              <div className="grid sm:grid-cols-2 gap-4">
                <button type="button" onClick={() => setForm({ ...form, siteType: 'lp' })}
                  className={`text-left p-5 rounded-xl border-2 ${form.siteType === 'lp' ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}>
                  <p className="font-bold mb-1">LP（1ページで完結）</p>
                  <p className="text-sm text-gray-600">すべての内容を1つのページに縦に並べます。申し込み・予約への行動に集中させたい方向け。</p>
                </button>
                <button type="button" onClick={() => setForm({ ...form, siteType: 'hp' })}
                  className={`text-left p-5 rounded-xl border-2 ${form.siteType === 'hp' ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}>
                  <p className="font-bold mb-1">HP（複数ページ）</p>
                  <p className="text-sm text-gray-600">ホームと、機能ごとの専用ページに分かれ、上部のナビゲーションで移動できます。情報量が多い方向け。</p>
                </button>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-bold border-b pb-2 mb-4">完成イメージから選ぶ</h2>
              <p className="text-sm text-gray-500 mb-4">入力した店名・キャッチコピーが、実際にこのように仕上がります。気に入ったものを選んでください（あとから変更できます）。</p>
              <TemplateGallery
                businessName={form.businessName}
                heroTitle={form.heroTitle}
                strengths={form.strengths}
                value={form.templateKey}
                onChange={(key) => setForm({ ...form, templateKey: key })}
              />
            </section>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(0)} className="flex-1 bg-gray-100 text-gray-700 py-4 rounded-xl font-bold hover:bg-gray-200">
                戻る
              </button>
              <button type="button" disabled={!form.templateKey} onClick={() => setStep(2)}
                className="flex-1 bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-40">
                次へ
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <form onSubmit={handleSubmit} className="space-y-6">
            <section>
              <h2 className="text-xl font-bold border-b pb-2 mb-4">実績とオファー（任意）</h2>
              <p className="text-sm text-gray-500 mb-2">
                <strong>実際の実績・実施中の特典だけ</strong>を入力してください（事実と異なる表示は景品表示法に触れるおそれがあります）。
              </p>
              <input type="text" placeholder="実績（任意・事実のみ）例: 開業10年・のべ3,000名のご来店" className="w-full p-3 border rounded-lg mb-4"
                value={form.socialProof} onChange={e => setForm({ ...form, socialProof: e.target.value })} />
              <input type="text" placeholder="特典（任意・実施中のもののみ）例: 初回限定 カット20%オフ" className="w-full p-3 border rounded-lg"
                value={form.scarcityOffer} onChange={e => setForm({ ...form, scarcityOffer: e.target.value })} />
            </section>

            <section>
              <h2 className="text-xl font-bold border-b pb-2 mb-4">LINE連携 (L-Harness連携基盤)</h2>
              <p className="text-sm text-gray-500 mb-4">LINE公式アカウントをお持ちですか?（あとからでも設定・変更できます）</p>
              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <button type="button" onClick={() => setHasLine('yes')}
                  className={`text-left p-4 rounded-xl border-2 ${hasLine === 'yes' ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}>
                  <p className="font-bold">持っている</p>
                  <p className="text-sm text-gray-600 mt-1">チャンネル情報を入力して、今すぐ連携の準備をします。</p>
                </button>
                <button type="button" onClick={() => setHasLine('no')}
                  className={`text-left p-4 rounded-xl border-2 ${hasLine === 'no' ? 'border-blue-600 bg-blue-50' : 'border-gray-200'}`}>
                  <p className="font-bold">まだ持っていない</p>
                  <p className="text-sm text-gray-600 mt-1">ページ作成を先に進め、作り方はダッシュボードでご案内します。</p>
                </button>
              </div>
              {hasLine === 'yes' && (
                <>
                  <p className="text-sm text-gray-500 mb-4">LINE Developersから取得した情報を入力してください。有料プランへの加入後、Webhookの接続と自動応答が有効になります。</p>
                  <input type="text" placeholder="Channel ID" className="w-full p-3 border rounded-lg mb-4"
                    value={form.channelId} onChange={e => setForm({ ...form, channelId: e.target.value })} required />
                  <input type="text" placeholder="Channel Secret" className="w-full p-3 border rounded-lg mb-4"
                    value={form.channelSecret} onChange={e => setForm({ ...form, channelSecret: e.target.value })} required />
                  <input type="text" placeholder="Channel Access Token" className="w-full p-3 border rounded-lg"
                    value={form.channelAccessToken} onChange={e => setForm({ ...form, channelAccessToken: e.target.value })} required />
                </>
              )}
            </section>

            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(1)} className="flex-1 bg-gray-100 text-gray-700 py-4 rounded-xl font-bold hover:bg-gray-200">
                戻る
              </button>
              <button type="submit" disabled={submitting || !hasLine} className="flex-1 bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 disabled:opacity-50">
                {submitting ? '作成しています…' : '無料でページを試作する'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
