'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Page = {
  id: string; slug: string; businessName: string; customDomain: string; customDomainVerified: boolean; customDomainMode: string | null;
  customDomainNote: string | null; customDomainReviewUntil: string | null;
  user: { id: string; name: string; domainReferrals: { toolKey: string; clickedAt: string }[] };
};
const MODE: Record<string, string> = { affiliate: '無料（提携）', paid: '有料プラン', review: '確認待ち' };

// 運営者専用: 独自ドメインの公開条件の確認。RDAPで自動確認できないドメイン（.jp など）は、
// 提携先（ASP）の成果と照らして「提携リンクから取得した」か確認し、承認／非承認を決める
export default function AdminDomainsPage() {
  const [pages, setPages] = useState<Page[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => setPages((await api.get('/lp/admin/domains')).data.pages), []);
  useEffect(() => { load().catch((e) => setError(e?.response?.status === 403 ? '管理者のみ利用できます。' : '読み込みに失敗しました。')); }, [load]);

  const act = async (p: Page, action: 'approve' | 'reject') => {
    const note = prompt(action === 'approve' ? '確認した内容（例: A8の成果 10/12 確定）' : '非承認の理由（利用者に表示されます）') ?? '';
    try {
      await api.post(`/lp/admin/domains/${p.id}/${action}`, { note });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || '処理できませんでした。');
    }
  };

  if (!pages) return <div className="p-6 text-sm text-gray-500">{error || '読み込み中…'}</div>;
  const review = pages.filter((p) => p.customDomainMode === 'review' || p.customDomainMode === null);

  return (
    <div className="px-4 py-6 md:px-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-black">独自ドメイン</h1>
        <p className="text-sm text-gray-600 mt-1">提携リンクから取得したドメインは無料、それ以外は有料プランが必要です。自動で確認できなかったものを、ASPの成果と照らして判断してください。</p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section>
        <h2 className="font-bold text-sm mb-2">確認待ち（{review.length}）</h2>
        {review.length === 0 ? <p className="text-sm text-gray-500 bg-white border rounded-xl p-4">確認待ちはありません</p> : (
          <ul className="space-y-2">
            {review.map((p) => (
              <li key={p.id} className="bg-white border-2 border-amber-200 rounded-2xl p-4 text-sm">
                <p className="font-black">{p.customDomain}</p>
                <p>{p.businessName}（/{p.slug}）・{p.user.name}</p>
                <p className="text-xs text-gray-500">提携リンクを開いた記録: {p.user.domainReferrals.length ? p.user.domainReferrals.map((r) => `${r.toolKey} ${new Date(r.clickedAt).toLocaleString('ja-JP')}`).join(' / ') : 'なし'}</p>
                <p className="text-xs text-gray-500">猶予期限: {p.customDomainReviewUntil ? new Date(p.customDomainReviewUntil).toLocaleDateString('ja-JP') : '-'}・{p.customDomainNote ?? ''}</p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => act(p, 'approve')} className="rounded-full bg-green-600 text-white font-bold px-5 py-2">提携経由と確認（無料）</button>
                  <button onClick={() => act(p, 'reject')} className="rounded-full border px-5 py-2 text-gray-600">確認できない（有料）</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-bold text-sm mb-2">すべての独自ドメイン</h2>
        <ul className="bg-white border rounded-xl divide-y text-sm">
          {pages.map((p) => (
            <li key={p.id} className="px-4 py-3 flex justify-between gap-3">
              <span className="min-w-0 truncate">{p.customDomain} <span className="text-xs text-gray-400">/{p.slug}</span></span>
              <span className="shrink-0 text-xs">{p.customDomainVerified ? '接続済み' : '未接続'}・{MODE[p.customDomainMode ?? ''] ?? '未判定'}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
