'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';

type Variant = {
  id: string;
  label: string;
  heroTitle: string;
  isControl: boolean;
  enabled: boolean;
  impressions: number;
  conversions: number;
};

// 見出し（ヒーローコピー）のA/Bテストを管理する画面。
// 最初の1件を追加すると、その時点のheroTitleが「既定（対照群）」として自動的に控えとして作られる。
// 判定・改善提案は成長分析担当エージェントが行い、結果は/agentsの「成長分析担当」に表示される。
function GrowthInner() {
  const searchParams = useSearchParams();
  const lpId = searchParams.get('lp') || '';
  const withLp = (params: Record<string, string> = {}) => (lpId ? { ...params, lpId } : params);

  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [label, setLabel] = useState('');
  const [heroTitle, setHeroTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/lp/variants', { params: withLp() });
    setVariants(data.variants);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpId]);

  useEffect(() => { load().catch(() => setError('読み込みに失敗しました。')); }, [load]);

  const addVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !heroTitle.trim()) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/lp/variants', { ...withLp(), label: label.trim(), heroTitle: heroTitle.trim() });
      setLabel('');
      setHeroTitle('');
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || '追加に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (v: Variant) => {
    try {
      await api.put(`/lp/variants/${v.id}`, { ...withLp(), enabled: !v.enabled });
      await load();
    } catch {
      setError('更新に失敗しました。');
    }
  };

  const remove = async (v: Variant) => {
    if (!window.confirm(`「${v.label}」を削除しますか？（記録した表示・成約の数値も消えます）`)) return;
    try {
      await api.delete(`/lp/variants/${v.id}`, { params: withLp() });
      await load();
    } catch {
      setError('削除に失敗しました。');
    }
  };

  if (!variants) return <p className="p-8">{error || '読み込み中...'}</p>;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">見出しのA/Bテスト</h1>
        <p className="text-sm text-gray-500 mb-6">
          公開ページの見出し（ヒーローコピー）を複数用意すると、訪問者ごとにランダムで表示し、
          LINE友だち追加につながった割合（CVR）を比較できます。十分な件数が集まると、
          結果は<Link href="/agents" className="text-blue-600 underline">AIエージェント（成長分析担当）</Link>に表示されます。
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <form onSubmit={addVariant} className="bg-white border rounded-xl p-5 mb-8 space-y-3">
          <p className="font-bold text-sm">新しい見出しを追加</p>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="管理用のラベル（例: パターンB）"
            className="w-full border rounded-lg px-3 py-2 text-sm" />
          <textarea value={heroTitle} onChange={(e) => setHeroTitle(e.target.value)} placeholder="試したい見出しの文章"
            className="w-full border rounded-lg px-3 py-2 text-sm" rows={2} />
          <button type="submit" disabled={saving} className="bg-blue-600 text-white px-5 py-2 rounded-lg font-bold text-sm disabled:opacity-50">
            {saving ? '追加中...' : '追加する'}
          </button>
        </form>

        {variants.length === 0 ? (
          <p className="text-gray-400 text-sm">まだテストは始まっていません。上のフォームから追加してください。</p>
        ) : (
          <div className="space-y-3">
            {variants.map((v) => {
              const rate = v.impressions ? (v.conversions / v.impressions) * 100 : 0;
              return (
                <div key={v.id} className={`bg-white border rounded-xl p-5 ${v.enabled ? '' : 'opacity-50'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-bold text-sm">
                      {v.label}{v.isControl && <span className="ml-2 text-xs text-gray-400">（対照群）</span>}
                    </p>
                    <div className="flex gap-3 shrink-0">
                      <button onClick={() => toggle(v)} className="text-xs font-bold text-blue-600">
                        {v.enabled ? '停止する' : '再開する'}
                      </button>
                      <button onClick={() => remove(v)} className="text-xs font-bold text-gray-400">削除</button>
                    </div>
                  </div>
                  <p className="text-sm mt-2 whitespace-pre-wrap">{v.heroTitle}</p>
                  <p className="text-xs text-gray-500 mt-3">
                    表示 {v.impressions}回 / 成約 {v.conversions}回 / CVR {rate.toFixed(1)}%
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Growth() {
  return (
    <Suspense fallback={<p className="p-8">読み込み中...</p>}>
      <GrowthInner />
    </Suspense>
  );
}
