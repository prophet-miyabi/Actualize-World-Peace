'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';

type Field = { key: string; label: string; type: 'text' | 'textarea'; required?: boolean; placeholder?: string; help?: string };
type Feature = {
  id: string; name: string; description: string; fields: Field[];
  added: boolean; inputs: Record<string, string>; promptBy: 'gemini' | 'template' | null;
};

// ページに追加できる機能の一覧と、機能ごとの質問フォーム。
// 回答をもとに Gemini がその機能専用の指示文を設計し、Claude が内容を作成してページに追加する。
export default function Features() {
  return (
    <Suspense fallback={<p className="p-8">読み込み中...</p>}>
      <FeaturesInner />
    </Suspense>
  );
}

function FeaturesInner() {
  const searchParams = useSearchParams();
  const lpId = searchParams.get('lp') || '';
  const backHref = lpId ? `/dashboard?lp=${encodeURIComponent(lpId)}` : '/dashboard';

  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [hasLp, setHasLp] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [needsPlan, setNeedsPlan] = useState(false);
  const [doneId, setDoneId] = useState<string | null>(null);
  const [slug, setSlug] = useState('');

  const load = useCallback(async () => {
    const params = lpId ? { lpId } : {};
    const [f, s] = await Promise.all([api.get('/lp/features', { params }), api.get('/lp/dashboard/stats', { params })]);
    setFeatures(f.data.features);
    setHasLp(f.data.hasLp);
    setSlug(s.data.lp?.slug ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpId]);

  useEffect(() => { load().catch(() => setError('読み込みに失敗しました。')); }, [load]);

  const open = (f: Feature) => {
    setOpenId(openId === f.id ? null : f.id);
    setInputs(f.inputs ?? {});
    setError('');
    setNeedsPlan(false);
    setDoneId(null);
  };

  const submit = async (f: Feature) => {
    const missing = f.fields.find((x) => x.required && !inputs[x.key]?.trim());
    if (missing) { setError(`「${missing.label}」を入力してください。`); return; }
    setError('');
    setNeedsPlan(false);
    setBusy(true);
    // 実際の処理はサーバー側で「指示文の設計 → 実行」の順に行われる
    setStep('Geminiがこの機能に合わせた指示文を設計しています…');
    const timer = setTimeout(() => setStep('Claudeが内容を作成しています…'), 4000);
    try {
      await api.post(`/lp/features/${f.id}`, lpId ? { inputs, lpId } : { inputs });
      await load();
      setDoneId(f.id);
      setOpenId(null);
    } catch (err: any) {
      if (err?.response?.status === 402) setNeedsPlan(true);
      setError(err?.response?.data?.error || '作成に失敗しました。');
    } finally {
      clearTimeout(timer);
      setBusy(false);
      setStep('');
    }
  };

  const remove = async (f: Feature) => {
    if (!window.confirm(`「${f.name}」をページから外しますか？`)) return;
    await api.delete(`/lp/features/${f.id}`, lpId ? { params: { lpId } } : undefined);
    setOpenId(null);
    await load();
  };

  if (!features) return <p className="p-8">{error || '読み込み中...'}</p>;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href={backHref} className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">機能を追加する</h1>
        <p className="text-sm text-gray-500 mb-6">
          追加したい機能を選んで質問に答えると、Geminiがその機能に合わせた指示文を設計し、Claudeが内容を作成してページに追加します。
          料金・日付・実績などは、入力された事実だけが使われます。
        </p>

        {!hasLp && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6 text-sm text-yellow-800">
            先にページを作成してください。<Link href="/wizard" className="underline ml-1">ページを作成する</Link>
          </div>
        )}

        {doneId && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-sm text-green-800">
            ページに追加しました。{slug && <a href={`/${slug}`} target="_blank" rel="noopener noreferrer" className="underline ml-1">ページで確認する</a>}
          </div>
        )}

        <div className="space-y-3">
          {features.map((f) => (
            <div key={f.id} className="bg-white border rounded-xl">
              <button type="button" onClick={() => open(f)} disabled={!hasLp || busy}
                className="w-full text-left p-5 flex items-start justify-between gap-4 disabled:opacity-60">
                <div>
                  <p className="font-bold">{f.name}</p>
                  <p className="text-sm text-gray-500 mt-1">{f.description}</p>
                  {f.added && f.promptBy && (
                    <p className="text-xs text-gray-400 mt-2">
                      {f.promptBy === 'gemini' ? 'Geminiが設計した指示文で、Claudeが作成' : '標準の指示文で、Claudeが作成'}
                    </p>
                  )}
                </div>
                <span className={`text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap ${f.added ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {f.added ? '追加済み' : '未追加'}
                </span>
              </button>

              {openId === f.id && (
                <div className="border-t p-5 space-y-4">
                  {f.fields.map((field) => (
                    <label key={field.key} className="block">
                      <span className="text-sm font-bold">
                        {field.label}{field.required && <span className="text-red-600 ml-1">必須</span>}
                      </span>
                      {field.type === 'textarea' ? (
                        <textarea rows={5} value={inputs[field.key] ?? ''} placeholder={field.placeholder}
                          onChange={(e) => setInputs({ ...inputs, [field.key]: e.target.value })}
                          className="mt-1 w-full p-3 border rounded-lg" />
                      ) : (
                        <input type="text" value={inputs[field.key] ?? ''} placeholder={field.placeholder}
                          onChange={(e) => setInputs({ ...inputs, [field.key]: e.target.value })}
                          className="mt-1 w-full p-3 border rounded-lg" />
                      )}
                      {field.help && <span className="block text-xs text-gray-500 mt-1">{field.help}</span>}
                    </label>
                  ))}

                  {error && <p className="text-red-600 text-sm">{error}</p>}
                  {needsPlan && <Link href="/billing" className="text-blue-600 underline text-sm">有料プランに加入する</Link>}
                  {busy && <p className="text-sm text-blue-700">{step}</p>}

                  <div className="flex gap-3">
                    <button type="button" onClick={() => submit(f)} disabled={busy}
                      className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-bold disabled:opacity-50">
                      {busy ? '作成中…' : f.added ? '作り直す' : 'ページに追加する'}
                    </button>
                    {f.added && (
                      <button type="button" onClick={() => remove(f)} disabled={busy}
                        className="px-5 py-3 rounded-lg border text-red-600 font-bold disabled:opacity-50">外す</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
