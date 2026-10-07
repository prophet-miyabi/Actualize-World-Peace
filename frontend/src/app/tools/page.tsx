'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';

type CatalogItem = { key: string; name: string; category: string; description: string; embeddable: boolean; allowedHosts: string[] };
type MyTool = { id: string; toolKey: string; label: string; url: string; display: string };

// 提携ツール（予約・ネットショップ・フォーム等）を自分のサイトに追加する画面。
// ツールへの登録は運営者のアフィリエイトリンク経由（PR表記が必要）。アカウントはユーザー本人の名義で作られ、
// 顧客データはツール側に保存される。AWPが保存するのは公開用のURLだけ。
function ToolsInner() {
  const searchParams = useSearchParams();
  const lpId = searchParams.get('lp') || '';
  const withLp = (params: Record<string, string> = {}) => (lpId ? { ...params, lpId } : params);

  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [mine, setMine] = useState<MyTool[]>([]);
  const [error, setError] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [display, setDisplay] = useState<'button' | 'embed'>('button');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([api.get('/tools/catalog'), api.get('/tools/mine', { params: withLp() })]);
    setCatalog(c.data.items);
    setMine(m.data.tools);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpId]);

  useEffect(() => { load().catch(() => setError('読み込みに失敗しました。')); }, [load]);

  const openForm = (item: CatalogItem) => {
    setOpenKey(openKey === item.key ? null : item.key);
    setUrl('');
    setLabel(item.name);
    setDisplay('button');
    setError('');
  };

  const add = async (e: React.FormEvent, item: CatalogItem) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/tools/mine', { ...withLp(), toolKey: item.key, url: url.trim(), label: label.trim(), display });
      setOpenKey(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || '追加に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: MyTool) => {
    if (!window.confirm(`「${t.label}」をサイトから外しますか？（ツール側のアカウントやデータは消えません）`)) return;
    try {
      await api.delete(`/tools/mine/${t.id}`);
      await load();
    } catch {
      setError('削除に失敗しました。');
    }
  };

  if (!catalog) return <p className="p-8">{error || '読み込み中...'}</p>;

  const categories = catalog.map((c) => c.category).filter((c, i, all) => all.indexOf(c) === i);
  const nameOf = (key: string) => catalog.find((c) => c.key === key)?.name || key;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <h1 className="text-2xl font-bold mt-3 mb-2">提携ツールを追加</h1>
        <p className="text-sm text-gray-600 mb-4">
          予約・ネットショップ・問い合わせフォームなどのツールを、あなたのサイトにボタンや埋め込みで追加できます。
        </p>

        <div className="bg-white border rounded-xl p-4 mb-6 text-xs text-gray-600 space-y-2">
          <p>
            <span className="inline-block bg-gray-200 text-gray-700 font-bold px-1.5 rounded mr-1">PR</span>
            「公式サイトで登録する」のリンクには、広告（アフィリエイト）リンクが含まれます。リンク経由で登録・利用されると、AWPの運営者に紹介料が支払われる場合があります。
          </p>
          <p>
            ツールのアカウントは<strong>あなた自身の名義</strong>で作成されます。お客様の予約・注文などの情報はツール側のあなたのアカウントに保存され、AWPには保存されません。AWPの利用をやめても、ツールはそのまま使い続けられます。
          </p>
        </div>

        {error && !openKey && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <h2 className="font-bold mb-2">このサイトに追加済み</h2>
        {mine.length === 0 ? (
          <p className="text-sm text-gray-500 mb-8">まだありません。</p>
        ) : (
          <ul className="space-y-2 mb-8">
            {mine.map((t) => (
              <li key={t.id} className="bg-white border rounded-xl p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold truncate">{t.label}</p>
                  <p className="text-xs text-gray-500 truncate">{nameOf(t.toolKey)}・{t.display === 'embed' ? '埋め込み' : 'ボタン'}・{t.url}</p>
                </div>
                <button onClick={() => remove(t)} className="text-sm text-red-600 shrink-0">外す</button>
              </li>
            ))}
          </ul>
        )}

        {catalog.length === 0 ? (
          <p className="text-sm text-gray-500">追加できるツールは現在準備中です。</p>
        ) : (
          categories.map((cat) => (
            <section key={cat} className="mb-8">
              <h2 className="font-bold mb-2">{cat}</h2>
              <div className="space-y-3">
                {catalog.filter((c) => c.category === cat).map((item) => (
                  <div key={item.key} className="bg-white border rounded-xl p-4">
                    <p className="font-bold">{item.name}</p>
                    <p className="text-sm text-gray-600 mt-1">{item.description}</p>
                    <div className="flex flex-col sm:flex-row gap-2 mt-3">
                      <a href={`/api/tools/go/${encodeURIComponent(item.key)}?src=tools`} target="_blank" rel="sponsored noopener noreferrer"
                        className="text-center bg-blue-600 text-white font-bold text-sm px-4 py-3 rounded-lg">
                        公式サイトで登録する（PR）
                      </a>
                      <button onClick={() => openForm(item)}
                        className="text-center border border-blue-600 text-blue-600 font-bold text-sm px-4 py-3 rounded-lg">
                        {openKey === item.key ? '閉じる' : '登録済みならサイトに追加'}
                      </button>
                    </div>

                    {openKey === item.key && (
                      <form onSubmit={(e) => add(e, item)} className="mt-4 space-y-3 border-t pt-4">
                        <label className="block text-sm">
                          <span className="font-bold">あなたの{item.name}のページURL</span>
                          <input value={url} onChange={(e) => setUrl(e.target.value)} required inputMode="url"
                            placeholder={`https://${item.allowedHosts[0] ?? ''}/...`}
                            className="mt-1 w-full border rounded-lg px-3 py-3 text-base" />
                          <span className="text-xs text-gray-500">ツールの管理画面に表示される、お客様向けページのURLを貼り付けてください。</span>
                        </label>
                        <label className="block text-sm">
                          <span className="font-bold">ボタンの文言</span>
                          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40}
                            className="mt-1 w-full border rounded-lg px-3 py-3 text-base" />
                        </label>
                        {item.embeddable && (
                          <fieldset className="text-sm">
                            <span className="font-bold">表示方法</span>
                            <div className="flex gap-4 mt-1">
                              <label className="flex items-center gap-1">
                                <input type="radio" checked={display === 'button'} onChange={() => setDisplay('button')} /> ボタン
                              </label>
                              <label className="flex items-center gap-1">
                                <input type="radio" checked={display === 'embed'} onChange={() => setDisplay('embed')} /> ページ内に埋め込む
                              </label>
                            </div>
                          </fieldset>
                        )}
                        {error && <p className="text-red-600 text-sm">{error}</p>}
                        <button disabled={saving} className="w-full bg-gray-900 text-white font-bold py-3 rounded-lg disabled:opacity-50">
                          {saving ? '追加中...' : 'サイトに追加する'}
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export default function ToolsPage() {
  return (
    <Suspense fallback={<p className="p-8">読み込み中...</p>}>
      <ToolsInner />
    </Suspense>
  );
}
