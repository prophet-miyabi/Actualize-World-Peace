'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

type Item = {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string;
  officialUrl: string;
  affiliateUrl: string | null;
  allowedHosts: string[];
  embeddable: boolean;
  enabled: boolean;
  sortOrder: number;
  clicks: number;
};

const EMPTY = { key: '', name: '', category: '', description: '', officialUrl: '', affiliateUrl: '', allowedHosts: '', embeddable: false, enabled: true, sortOrder: 0 };

// 運営者専用: ユーザーに案内する提携ツールと、ASPで発行したアフィリエイトリンクを登録する。
// 説明文はユーザーへの広告表示になるため、公式サイトで確認できる事実だけを書く（誇張・比較優良の表現はしない）。
export default function AdminToolsPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get('/tools/admin/catalog');
    setItems(data.items);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e?.response?.status === 403 ? '管理者のみ利用できます。' : '読み込みに失敗しました。'));
  }, [load]);

  const set = (k: keyof typeof EMPTY, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const edit = (it: Item) => {
    setEditingId(it.id);
    setForm({ ...it, affiliateUrl: it.affiliateUrl ?? '', allowedHosts: it.allowedHosts.join(', ') });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) await api.put(`/tools/admin/catalog/${editingId}`, form);
      else await api.post('/tools/admin/catalog', form);
      setForm({ ...EMPTY });
      setEditingId(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (it: Item) => {
    if (!window.confirm(`「${it.name}」をカタログから削除しますか？（すでにサイトに追加したユーザーの表示は残ります）`)) return;
    await api.delete(`/tools/admin/catalog/${it.id}`);
    await load();
  };

  const input = 'mt-1 w-full border rounded-lg px-3 py-2 text-base';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <h1 className="text-2xl font-bold mt-3 mb-2">提携ツールのカタログ（運営者用）</h1>
        <p className="text-sm text-gray-600 mb-6">
          ASP（A8.net など）で提携・発行したアフィリエイトリンクを登録します。説明文には、公式サイトで確認できる事実だけを書いてください。
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <form onSubmit={save} className="bg-white border rounded-xl p-4 space-y-3 mb-8">
          <p className="font-bold">{editingId ? `編集中: ${form.name}` : '新しいツールを登録'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">キー（英小文字・変更不可）<input className={input} value={form.key} disabled={!!editingId} onChange={(e) => set('key', e.target.value)} placeholder="airreserve" /></label>
            <label className="text-sm">ツール名<input className={input} value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
            <label className="text-sm">カテゴリ<input className={input} value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="予約 / ネットショップ / フォーム" /></label>
            <label className="text-sm">並び順<input className={input} type="number" value={form.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} /></label>
          </div>
          <label className="block text-sm">説明（事実のみ・300文字まで）<textarea className={input} rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} /></label>
          <label className="block text-sm">公式サイトURL<input className={input} value={form.officialUrl} onChange={(e) => set('officialUrl', e.target.value)} placeholder="https://..." /></label>
          <label className="block text-sm">アフィリエイトURL（ASPの成果測定リンク。未登録なら公式サイトへ移動）<input className={input} value={form.affiliateUrl} onChange={(e) => set('affiliateUrl', e.target.value)} placeholder="https://px.a8.net/..." /></label>
          <label className="block text-sm">ユーザーが貼れるURLのホスト（カンマ区切り）<input className={input} value={form.allowedHosts} onChange={(e) => set('allowedHosts', e.target.value)} placeholder="airrsv.net" /></label>
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.embeddable} onChange={(e) => set('embeddable', e.target.checked)} />ページ内への埋め込みを許可</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} />ユーザーに表示</label>
          </div>
          <div className="flex gap-2">
            <button disabled={saving} className="bg-blue-600 text-white font-bold px-4 py-2 rounded-lg disabled:opacity-50">{saving ? '保存中...' : editingId ? '更新する' : '登録する'}</button>
            {editingId && <button type="button" onClick={() => { setEditingId(null); setForm({ ...EMPTY }); }} className="text-gray-600 px-4 py-2">キャンセル</button>}
          </div>
        </form>

        <h2 className="font-bold mb-2">登録済み</h2>
        {!items ? <p className="text-sm text-gray-500">読み込み中...</p> : items.length === 0 ? (
          <p className="text-sm text-gray-500">まだありません。</p>
        ) : (
          <ul className="space-y-2">
            {items.map((it) => (
              <li key={it.id} className="bg-white border rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{it.name} <span className="text-xs text-gray-500">（{it.category}）{it.enabled ? '' : '・非表示'}</span></p>
                    <p className="text-xs text-gray-500 truncate">クリック {it.clicks}回・{it.affiliateUrl ? 'アフィリエイトURLあり' : '⚠ アフィリエイトURL未登録'}・{it.allowedHosts.join(', ')}</p>
                  </div>
                  <div className="flex gap-3 shrink-0 text-sm">
                    <button onClick={() => edit(it)} className="text-blue-600">編集</button>
                    <button onClick={() => remove(it)} className="text-red-600">削除</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
