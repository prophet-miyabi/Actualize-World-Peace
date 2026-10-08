'use client';
import { useState } from 'react';

type Shop = { methods: { bank: boolean; inPerson: boolean }; shippingFeeYen: number; freeShippingOverYen: number | null };
type Product = { id: string; name: string; priceYen: number | null; stock: number | null; requiresShipping: boolean };
type Props = { slug: string; businessName: string; product: Product; shop: Shop; primary: string; onPrimary: string; siteUrl: string };

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

// 「購入する」→ 注文フォーム。代金は出品者へ直接支払う（AWPは代金を預からない・カード情報も扱わない）
export default function OrderButton({ slug, businessName, product, shop, primary, onPrimary, siteUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState(1);
  const [method, setMethod] = useState<'bank' | 'in_person'>(shop.methods.bank ? 'bank' : 'in_person');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [postal, setPostal] = useState('');
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState('');
  const [agree, setAgree] = useState(false);
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');

  const subtotal = (product.priceYen ?? 0) * qty;
  const shipping = product.requiresShipping && !(shop.freeShippingOverYen != null && subtotal >= shop.freeShippingOverYen) ? shop.shippingFeeYen : 0;
  const maxQty = Math.min(99, product.stock ?? 99);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/shop/orders/${slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ productId: product.id, qty }], paymentMethod: method, buyerName: name, buyerContact: contact,
          shipping: product.requiresShipping ? { postal, address, name } : undefined, message, agree, website
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || '注文できませんでした');
      setCode(d.code);
    } catch (err: any) {
      setError(err?.message || '注文できませんでした');
    } finally {
      setBusy(false);
    }
  };

  const input = 'mt-1 w-full border border-gray-300 rounded-xl px-3 py-2.5 text-base bg-white';

  return (
    <>
      <button onClick={() => setOpen(true)} className="mt-2 block w-full text-center text-xs font-bold py-2 rounded-full" style={{ background: primary, color: onPrimary }}>
        購入する
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center text-gray-800" onClick={() => setOpen(false)} style={{ fontFamily: 'var(--font-sans-jp)' }}>
          <div className="bg-white w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 text-left" onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}>
            {code ? (
              <div className="text-center py-4">
                <p className="text-4xl" aria-hidden>🧾</p>
                <p className="font-black text-lg mt-2">注文を受け付けました</p>
                <p className="text-sm text-gray-600 mt-2">{method === 'bank' ? 'お支払い方法（振込先）は、次のページで確認できます。' : 'お支払いは、お店で直接どうぞ。'}</p>
                <a href={`${siteUrl}/order/${code}`} className="mt-4 block rounded-full font-bold py-3" style={{ background: primary, color: onPrimary }}>注文の状況とお支払い方法</a>
                <p className="text-[11px] text-gray-500 mt-2">このページのURLをブックマークしておいてね</p>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-black">注文する</p>
                  <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-500">閉じる</button>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-sm">
                  <p className="font-bold">{product.name}</p>
                  <div className="flex items-center justify-between mt-2">
                    <span>{yen(product.priceYen ?? 0)} × </span>
                    <select value={qty} onChange={(e) => setQty(Number(e.target.value))} className="border rounded-lg px-2 py-1 text-base">
                      {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <p className="mt-2 text-xs text-gray-600">小計 {yen(subtotal)}{product.requiresShipping ? `・送料 ${yen(shipping)}` : ''}</p>
                  <p className="font-black">合計 {yen(subtotal + shipping)}</p>
                </div>
                <div>
                  <p className="text-sm font-bold">お支払い方法</p>
                  <div className="mt-1 grid gap-2">
                    {shop.methods.bank && (
                      <label className={`rounded-xl border px-3 py-2 text-sm flex gap-2 ${method === 'bank' ? 'border-violet-500 bg-violet-50' : ''}`}>
                        <input type="radio" checked={method === 'bank'} onChange={() => setMethod('bank')} />銀行振込（お店の口座へ直接）
                      </label>
                    )}
                    {shop.methods.inPerson && (
                      <label className={`rounded-xl border px-3 py-2 text-sm flex gap-2 ${method === 'in_person' ? 'border-violet-500 bg-violet-50' : ''}`}>
                        <input type="radio" checked={method === 'in_person'} onChange={() => setMethod('in_person')} />店頭・手渡しで支払う
                      </label>
                    )}
                  </div>
                </div>
                <label className="block text-sm font-bold">お名前<input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" required /></label>
                <label className="block text-sm font-bold">連絡先（メールまたは電話番号）<input className={input} value={contact} onChange={(e) => setContact(e.target.value)} maxLength={100} autoComplete="email" required /></label>
                {product.requiresShipping && (
                  <>
                    <label className="block text-sm font-bold">郵便番号<input className={input} value={postal} onChange={(e) => setPostal(e.target.value)} inputMode="numeric" autoComplete="postal-code" placeholder="123-4567" required /></label>
                    <label className="block text-sm font-bold">お届け先の住所<input className={input} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} autoComplete="street-address" required /></label>
                  </>
                )}
                <label className="block text-sm font-bold">メッセージ（任意）<textarea className={input} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} /></label>
                <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="hidden" aria-hidden />
                <label className="flex items-start gap-2 text-xs text-gray-600">
                  <input type="checkbox" className="mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
                  <span>
                    {businessName}の<a href={`${siteUrl}/shop/${slug}/legal`} className="underline" target="_blank" rel="noopener noreferrer">特定商取引法に基づく表記</a>（返品・お届け時期など）を確認し、入力内容が{businessName}に届くことに同意します（<a href={`${siteUrl}/privacy`} className="underline" target="_blank" rel="noopener noreferrer">プライバシーポリシー</a>）。
                  </span>
                </label>
                <p className="text-[11px] text-gray-500">売買の契約はお客様と{businessName}の間で結ばれます。AWPは代金を預からず、カード情報も扱いません。</p>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <button disabled={busy} className="w-full rounded-full font-bold py-3.5 disabled:opacity-50" style={{ background: primary, color: onPrimary }}>
                  {busy ? '送信中…' : `注文を確定する（${yen(subtotal + shipping)}）`}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
