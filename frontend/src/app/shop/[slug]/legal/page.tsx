import Link from 'next/link';
import { notFound } from 'next/navigation';

const API = process.env.API_INTERNAL_URL || 'http://localhost:8000/api';

type Data = {
  businessName: string;
  legal: { sellerName: string; responsible: string; address: string; phone: string; email: string; priceNote: string; extraFees: string; deliveryTime: string; returns: string };
  paymentMethods: string[];
  shipping: { feeYen: number; freeOverYen: number | null };
};

export const metadata = { title: '特定商取引法に基づく表記' };

// 出品者（ページの持ち主）ごとの特定商取引法に基づく表記。出品者が入力した内容をそのまま表示する
export default async function SellerLegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await fetch(`${API}/shop/legal/${encodeURIComponent(slug)}`, { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) notFound();
  const d = (await res.json()) as Data;
  const rows: [string, string][] = [
    ['販売事業者', d.legal.sellerName],
    ['運営責任者', d.legal.responsible],
    ['所在地', d.legal.address],
    ['電話番号', d.legal.phone],
    ['メールアドレス', d.legal.email],
    ['販売価格', d.legal.priceNote],
    ['商品代金以外の必要料金', `${d.legal.extraFees}${d.shipping.feeYen ? `（送料 ¥${d.shipping.feeYen.toLocaleString('ja-JP')}${d.shipping.freeOverYen != null ? `、¥${d.shipping.freeOverYen.toLocaleString('ja-JP')}以上で無料` : ''}）` : ''}`],
    ['お支払い方法', d.paymentMethods.join(' / ')],
    ['引き渡し時期', d.legal.deliveryTime],
    ['返品・キャンセル', d.legal.returns]
  ];
  return (
    <main className="max-w-2xl mx-auto p-6 sm:p-10 bg-white min-h-screen text-gray-800">
      <h1 className="text-xl font-bold">特定商取引法に基づく表記</h1>
      <p className="text-sm text-gray-500 mt-1">{d.businessName}</p>
      <dl className="mt-6 divide-y border-y text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="py-3 sm:flex gap-4">
            <dt className="font-bold sm:w-48 shrink-0">{k}</dt>
            <dd className="mt-1 sm:mt-0 whitespace-pre-wrap break-words">{v || '—'}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-gray-500 mt-6">この表記は販売事業者が入力したものです。売買契約はお客様と販売事業者の間で結ばれ、AWPは代金を預かりません。</p>
      <p className="mt-6 text-sm"><Link href={`/${slug}`} className="underline text-violet-700">{d.businessName}のページへ戻る</Link></p>
    </main>
  );
}
