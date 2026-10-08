'use client';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import { resizeImageToDataUrl } from '@/lib/image';

type Product = {
  id: string; name: string; priceYen: number | null; priceNote: string | null; description: string | null;
  buyUrl: string | null; soldOut: boolean; image: string | null; purchasable: boolean; stock: number | null; requiresShipping: boolean;
};
const EMPTY = { name: '', priceYen: '', priceNote: '税込', description: '', buyUrl: '', soldOut: false, purchasable: false, stock: '', requiresShipping: true, imageDataUrl: undefined as string | null | undefined, preview: '' };

export default function ProductsPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-gray-400">読み込み中…</main>}>
      <Products />
    </Suspense>
  );
}

// 商品カタログの管理。購入は、あなたが使っているネットショップ（BASE・STORES など）のページへ案内する
function Products() {
  const lpId = useSearchParams()?.get('lp') || '';
  const [page, setPage] = useState<{ id: string; slug: string } | null | undefined>(undefined);
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/products/mine', { params: lpId ? { lpId } : {} });
    setPage(data.page);
    setProducts(data.products);
  }, [lpId]);
  useEffect(() => { load().catch(() => setError('読み込めませんでした。')); }, [load]);

  const startNew = () => { setForm({ ...EMPTY }); setEditing(null); setOpen(true); setError(''); };
  const startEdit = (p: Product) => {
    setForm({ name: p.name, priceYen: p.priceYen == null ? '' : String(p.priceYen), priceNote: p.priceNote || '', description: p.description || '', buyUrl: p.buyUrl || '', soldOut: p.soldOut, purchasable: p.purchasable, stock: p.stock == null ? '' : String(p.stock), requiresShipping: p.requiresShipping, imageDataUrl: undefined, preview: p.image || '' });
    setEditing(p.id);
    setOpen(true);
    setError('');
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      setForm((f) => ({ ...f, imageDataUrl: dataUrl, preview: dataUrl }));
    } catch (e: any) {
      setError(e?.message || '画像を読み込めませんでした');
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = { lpId: page!.id, name: form.name, priceYen: form.priceYen, priceNote: form.priceNote, description: form.description, buyUrl: form.buyUrl, soldOut: form.soldOut, purchasable: form.purchasable, stock: form.stock, requiresShipping: form.requiresShipping, ...(form.imageDataUrl !== undefined ? { imageDataUrl: form.imageDataUrl } : {}) };
    try {
      if (editing) await api.put(`/products/mine/${editing}`, body);
      else await api.post('/products/mine', body);
      setOpen(false);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || '保存できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Product) => {
    if (!confirm(`「${p.name}」を削除しますか？`)) return;
    await api.delete(`/products/mine/${p.id}`);
    await load();
  };

  if (page === undefined) return <main className="p-6 text-sm text-gray-400">{error || '読み込み中…'}</main>;
  if (page === null) return <main className="p-6 text-sm text-gray-600">まだページがありません。<Link href="/builder" className="text-violet-700 underline">ページをつくる</Link></main>;

  const input = 'mt-1 w-full border rounded-xl px-3 py-2.5 text-base bg-white';

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <Link href={`/dashboard${lpId ? `?lp=${encodeURIComponent(lpId)}` : ''}`} className="text-sm text-violet-700 font-bold">← ホーム</Link>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-black">商品</h1>
            <p className="text-xs text-gray-500 mt-1">ページに商品を並べられるよ。AWPで直接売る（手数料0円）か、あなたのネットショップへ案内できるよ。</p>
          </div>
          <button onClick={startNew} className="shrink-0 rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white text-sm font-bold px-4 py-2">＋ 追加</button>
        </div>

        {products.length === 0 ? (
          <p className="text-sm text-gray-500 bg-white border rounded-2xl p-5 text-center">まだ商品はありません</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3">
            {products.map((p) => (
              <li key={p.id} className="bg-white border rounded-2xl overflow-hidden">
                <button onClick={() => startEdit(p)} className="block w-full text-left">
                  <div className="aspect-square bg-gray-100">
                    {p.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-bold text-sm truncate">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.priceYen != null ? `¥${p.priceYen.toLocaleString('ja-JP')}` : '価格なし'}{p.soldOut ? '・売り切れ' : ''}{p.purchasable ? `・AWPで販売中${p.stock != null ? `（在庫${p.stock}）` : ''}` : ''}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-gray-500">価格・説明は事実どおりに書いてね（実際と違う表示は法律で禁止されています）。</p>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={() => setOpen(false)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="bg-white w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 space-y-3"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
            <div className="flex items-center justify-between">
              <p className="font-black">{editing ? '商品を編集' : '商品を追加'}</p>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500">閉じる</button>
            </div>
            <label className="block">
              <span className="text-sm font-bold">写真</span>
              <div className="mt-1 flex items-center gap-3">
                <div className="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                  {form.preview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.preview} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <input type="file" accept="image/*" onChange={(e) => pickImage(e.target.files?.[0])} className="text-sm" />
              </div>
              {form.preview && <button type="button" onClick={() => setForm({ ...form, imageDataUrl: null, preview: '' })} className="text-xs text-gray-500 underline mt-1">写真を外す</button>}
            </label>
            <label className="block text-sm font-bold">商品名<input className={input} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm font-bold">価格（円・任意）<input className={input} type="number" inputMode="numeric" min={0} value={form.priceYen} onChange={(e) => setForm({ ...form, priceYen: e.target.value })} /></label>
              <label className="block text-sm font-bold">価格の補足<input className={input} value={form.priceNote} maxLength={30} placeholder="税込・送料別など" onChange={(e) => setForm({ ...form, priceNote: e.target.value })} /></label>
            </div>
            <label className="block text-sm font-bold">説明（任意）<textarea className={input} rows={3} maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label className="block text-sm font-bold">購入ページのURL（任意）
              <input className={input} type="url" inputMode="url" value={form.buyUrl} placeholder="https://〇〇.base.shop/items/..." onChange={(e) => setForm({ ...form, buyUrl: e.target.value })} />
              <span className="block text-[11px] font-normal text-gray-500 mt-1">BASE・STORES・Shopify・minne・Creema・BOOTH・メルカリShops・楽天・Amazon・SUZURI などのURLが使えます</span>
            </label>
            <div className="rounded-xl bg-violet-50 border border-violet-100 p-3 space-y-2">
              <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.purchasable} onChange={(e) => setForm({ ...form, purchasable: e.target.checked })} />AWPで購入できるようにする（手数料0円・直接払い）</label>
              {form.purchasable && (
                <>
                  <label className="block text-sm">在庫数（空欄なら数を管理しない）<input className={input} type="number" min={0} inputMode="numeric" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requiresShipping} onChange={(e) => setForm({ ...form, requiresShipping: e.target.checked })} />配送が必要（お届け先と送料をお客様に聞く）</label>
                </>
              )}
              <p className="text-[11px] text-gray-500">先に <Link href="/shop-settings" className="underline">ショップの設定</Link> で特定商取引法の表記と支払い方法をそろえてね。</p>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.soldOut} onChange={(e) => setForm({ ...form, soldOut: e.target.checked })} />売り切れにする</label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button disabled={busy} className="w-full rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold py-3 disabled:opacity-40">{busy ? '保存中…' : '保存する'}</button>
            {editing && <button type="button" onClick={() => { const p = products.find((x) => x.id === editing); if (p) { setOpen(false); remove(p); } }} className="w-full text-sm text-red-600 py-2">この商品を削除</button>}
          </form>
        </div>
      )}
    </main>
  );
}
