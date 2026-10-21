'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';

type Asset = { key: string; prompt: string; mimeType: string; updatedAt: string };

// アプリ自体の外装（マーケティングLPやウィザードの装飾画像）を、
// 導入済みの画像生成 intelligence（Cloudflare Workers AI / Gemini）でその場で作り、差し替えるための管理画面。
// 管理者だけが使う（一般の顧客には表示・提供しない）。
// prompt があるスロットは、選ぶと推奨の指示文も入る（スマホ見本の美容院サイト用の写真など）
const PRESET_SLOTS: { key: string; label: string; prompt?: string }[] = [
  { key: 'marketing_hero', label: 'トップページ ヒーロー画像' },
  { key: 'marketing_steps', label: 'トップページ 使い方セクション' },
  { key: 'wizard_hero', label: 'ウィザード 上部の装飾画像' },
  {
    key: 'mockup_salon_hero', label: 'スマホ見本 メイン写真',
    prompt: 'editorial photograph of a calm high-end Japanese hair salon, soft natural window light, warm beige and light wood interior, a woman with glossy shoulder-length brown hair seen from behind, shallow depth of field, minimal, refined, film photography, vertical composition, no text, no letters, no signage'
  },
  {
    key: 'mockup_salon_style_1', label: 'スマホ見本 スタイル1',
    prompt: 'close-up editorial hair photography of glossy ash beige medium-length hair with soft waves, studio lighting, plain neutral background, no face, no text, no letters, no signage'
  },
  {
    key: 'mockup_salon_style_2', label: 'スマホ見本 スタイル2',
    prompt: 'close-up editorial hair photography of a milk tea brown bob haircut with natural shine, soft light, plain beige background, no face, no text, no letters, no signage'
  },
  {
    key: 'mockup_salon_style_3', label: 'スマホ見本 スタイル3',
    prompt: 'close-up editorial hair photography of sleek glossy dark brown long straight hair, soft light, minimal plain background, no face, no text, no letters, no signage'
  }
];

export default function AdminAssets() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [key, setKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  // いま使われる画像生成と、リール（縦動画）の生成
  const [provider, setProvider] = useState<{ provider: string | null; runway: { image: string; video: string } | null } | null>(null);
  const [reel, setReel] = useState({ imagePrompt: '', motionPrompt: 'slow cinematic camera push-in, soft natural light, gentle motion', body: '', duration: 5 as 5 | 10, to: 'official' });
  const [reelBusy, setReelBusy] = useState(false);
  const [reelMsg, setReelMsg] = useState('');

  useEffect(() => {
    api.get('/auth/me').then(({ data }) => setAllowed(!!data.isAdmin)).catch(() => setAllowed(false));
  }, []);

  const loadAssets = () => {
    api.get('/site-assets').then(({ data }) => setAssets(data.assets)).catch(() => {});
  };

  useEffect(() => { if (allowed) { loadAssets(); api.get('/site-assets/provider').then(({ data }) => setProvider(data)).catch(() => {}); } }, [allowed]);

  const makeReel = async (e: React.FormEvent) => {
    e.preventDefault();
    setReelMsg(''); setError('');
    if (!reel.imagePrompt.trim() || !reel.body.trim()) { setError('リールの画像の指示文（英語）と投稿文を入力してください。'); return; }
    setReelBusy(true);
    try {
      const { data } = await api.post('/site-assets/reel', reel);
      setReelMsg(`リールを投稿しました（${data.seconds}秒）。公式ページとタイムラインに出ています: ${data.videoUrl}`);
      setReel((r) => ({ ...r, imagePrompt: '', body: '' }));
    } catch (err: any) {
      setError(err?.response?.data?.error || '動画の生成に失敗しました。');
    } finally {
      setReelBusy(false);
    }
  };

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^[a-z0-9_-]{1,60}$/.test(key)) { setError('キーは半角英数字・ハイフン・アンダースコアのみで入力してください。'); return; }
    if (!prompt.trim()) { setError('画像の指示文を入力してください。'); return; }
    setLoading(true);
    try {
      await api.post('/site-assets/generate', { key, prompt });
      setVersion((v) => v + 1);
      loadAssets();
    } catch (err: any) {
      setError(err?.response?.data?.error || '生成に失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  const remove = async (k: string) => {
    if (!confirm(`「${k}」を削除しますか？（元の見た目に戻ります）`)) return;
    await api.delete(`/site-assets/${encodeURIComponent(k)}`);
    loadAssets();
  };

  if (allowed === null) return <div className="min-h-screen" />;
  if (!allowed) return <div className="text-center p-20 text-xl font-bold">アクセスできません。</div>;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">アプリの外装画像を生成</h1>
        <p className="text-gray-500 mb-3 text-sm">
          導入済みの画像生成 intelligenceで、マーケティングLPやウィザードの装飾画像を作成・差し替えます（顧客のLP画像とは別管理です）。
        </p>
        <p className="text-xs mb-8">
          <span className={`inline-block rounded-full px-3 py-1 font-bold ${provider?.provider === 'runway' ? 'bg-green-100 text-green-800' : provider?.provider ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-700'}`}>
            いまの画像生成: {provider?.provider === 'runway' ? `Runway（画像 ${provider.runway?.image} / 動画 ${provider.runway?.video}）` : provider?.provider === 'cloudflare' ? 'Cloudflare Workers（無料枠・品質は限定的）' : provider?.provider === 'gemini' ? 'Gemini' : provider ? '未設定' : '確認中…'}
          </span>
          {provider && provider.provider !== 'runway' && <span className="ml-2 text-gray-500">Render の環境変数に RUNWAYML_API_SECRET を追加すると Runway に切り替わり、動画も作れます。</span>}
        </p>

        <section className="bg-white border rounded-2xl p-5 mb-8">
          <h2 className="font-bold">リール（縦動画）を作る → AWP公式アカウントに投稿</h2>
          <p className="text-xs text-gray-500 mt-1">Runway で画像→動画（5秒 約40円 / 10秒 約80円）。投稿はタイムラインと公式ページに出て、Instagram運用の予約列からも使えます。</p>
          <form onSubmit={makeReel} className="mt-3 space-y-2 text-sm">
            <textarea value={reel.imagePrompt} onChange={(e) => setReel({ ...reel, imagePrompt: e.target.value })} rows={2} placeholder="画像の指示文（英語。被写体・光・色。文字や顔は入れない）" className="w-full border rounded-lg p-2" />
            <input value={reel.motionPrompt} onChange={(e) => setReel({ ...reel, motionPrompt: e.target.value })} placeholder="動きの指示文（英語。カメラワーク）" className="w-full border rounded-lg p-2" />
            <textarea value={reel.body} onChange={(e) => setReel({ ...reel, body: e.target.value })} rows={2} placeholder="投稿文（日本語）" className="w-full border rounded-lg p-2" />
            <div className="flex flex-wrap gap-2 items-center">
              <select value={reel.duration} onChange={(e) => setReel({ ...reel, duration: Number(e.target.value) as 5 | 10 })} className="border rounded-lg px-2 py-2"><option value={5}>5秒</option><option value={10}>10秒</option></select>
              <input value={reel.to} onChange={(e) => setReel({ ...reel, to: e.target.value })} placeholder="投稿先（official または ユーザー名）" className="border rounded-lg px-2 py-2 w-56" />
              <button type="submit" disabled={reelBusy || provider?.provider !== 'runway'} className="bg-blue-600 text-white font-bold px-4 py-2 rounded-lg disabled:opacity-50">{reelBusy ? '生成中（1〜3分）…' : 'リールを生成して投稿'}</button>
            </div>
            {reelMsg && <p className="text-green-700 text-xs break-all">{reelMsg}</p>}
          </form>
        </section>

        <form onSubmit={generate} className="bg-white p-6 rounded-2xl border shadow-sm mb-8 space-y-4">
          <div>
            <label className="text-sm font-bold text-gray-700 block mb-2">差し替え先</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {PRESET_SLOTS.map((s) => (
                <button key={s.key} type="button" onClick={() => { setKey(s.key); if (s.prompt) setPrompt(s.prompt); }}
                  className={`text-xs px-3 py-1.5 rounded-full border ${key === s.key ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                  {s.label}
                </button>
              ))}
            </div>
            <input type="text" placeholder="キー（例: marketing_hero）" className="w-full p-3 border rounded-lg"
              value={key} onChange={(e) => setKey(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-bold text-gray-700 block mb-2">どんな画像にするか（英語で書くとより高品質です）</label>
            <textarea placeholder="例: a friendly small business owner creating a website on a smartphone, warm modern illustration, soft gradient background"
              className="w-full p-3 border rounded-lg h-24" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button type="submit" disabled={loading} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold disabled:opacity-50">
            {loading ? '生成しています…' : 'この内容で生成する'}
          </button>
        </form>

        <h2 className="text-lg font-bold mb-4">生成済みの画像</h2>
        {assets.length === 0 ? (
          <p className="text-gray-400 text-sm">まだありません。</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-5">
            {assets.map((a) => (
              <div key={a.key} className="bg-white rounded-xl border shadow-sm overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${api.defaults.baseURL}/site-assets/${encodeURIComponent(a.key)}?v=${version}`} alt={a.key} className="w-full aspect-video object-cover" />
                <div className="p-4">
                  <p className="font-bold text-sm">{a.key}</p>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.prompt}</p>
                  <button onClick={() => remove(a.key)} className="text-xs text-red-600 mt-3 underline">削除する</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
