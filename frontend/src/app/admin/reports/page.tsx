'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Report = {
  id: string; targetType: 'page' | 'profile'; targetId: string; reason: string; detail: string | null;
  reporterId: string | null; status: 'open' | 'resolved' | 'dismissed'; createdAt: string;
};

const REASON_LABEL: Record<string, string> = {
  scam: '詐欺・誇大な表現', illegal: '違法な内容', adult: 'わいせつ・暴力的', harassment: '誹謗中傷・嫌がらせ', copyright: '著作権・肖像権', other: 'その他'
};
const STATUS_LABEL: Record<Report['status'], string> = { open: '未対応', resolved: '非公開にした', dismissed: '問題なし' };

// 運営者専用: ページ・プロフィールへの通報を確認し、非公開にする／問題なしとして閉じる
export default function AdminReportsPage() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await api.get('/community/admin/reports');
    setReports(data.reports);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e?.response?.status === 403 ? '管理者のみ利用できます。' : '読み込みに失敗しました。'));
  }, [load]);

  const act = async (r: Report, action: 'hide' | 'unhide' | 'dismiss') => {
    if (action === 'hide' && !confirm(`${r.targetType === 'page' ? 'ページ' : 'プロフィール'}「${r.targetId}」を非公開にしますか？`)) return;
    setBusy(r.id);
    setError('');
    try {
      await api.put(`/community/admin/reports/${r.id}`, { action });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || '処理できませんでした。');
    } finally {
      setBusy(null);
    }
  };

  const open = reports?.filter((r) => r.status === 'open') || [];
  const closed = reports?.filter((r) => r.status !== 'open') || [];

  return (
    <div className="px-4 py-6 md:px-8 max-w-3xl">
      <h1 className="text-2xl font-black">通報</h1>
      <p className="text-sm text-gray-600 mt-1">
        利用者から届いた通報です。内容を確認し、規約違反なら「非公開にする」を押してください（公開URL・発見・サイトマップから外れます。データは消えません）。
      </p>
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      <h2 className="font-bold text-sm mt-6 mb-2">未対応（{open.length}）</h2>
      {reports === null ? <p className="text-sm text-gray-400">読み込み中…</p> : open.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white border rounded-xl p-4">未対応の通報はありません 🎉</p>
      ) : (
        <div className="space-y-3">
          {open.map((r) => (
            <div key={r.id} className="bg-white border-2 border-amber-200 rounded-2xl p-4">
              <p className="text-[11px] font-bold text-amber-700">{REASON_LABEL[r.reason] || r.reason}・{new Date(r.createdAt).toLocaleString('ja-JP')}</p>
              <a href={`/${r.targetId}`} target="_blank" rel="noopener noreferrer" className="font-bold underline break-all">
                {r.targetType === 'page' ? 'ページ' : 'プロフィール'}: /{r.targetId}
              </a>
              {r.detail && <p className="text-sm text-gray-700 mt-2 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap break-words">{r.detail}</p>}
              <p className="text-[11px] text-gray-400 mt-1">{r.reporterId ? 'ログイン中のユーザーからの通報' : '未ログインの訪問者からの通報'}</p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => act(r, 'hide')} disabled={busy === r.id} className="rounded-full bg-red-600 text-white font-bold text-sm px-5 py-2 disabled:opacity-40">非公開にする</button>
                <button onClick={() => act(r, 'dismiss')} disabled={busy === r.id} className="rounded-full border text-sm px-5 py-2 text-gray-600">問題なし</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <>
          <h2 className="font-bold text-sm mt-8 mb-2">対応済み</h2>
          <ul className="bg-white border rounded-xl divide-y text-sm">
            {closed.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate">/{r.targetId}</span>
                  <span className="block text-xs text-gray-500">{REASON_LABEL[r.reason] || r.reason}・{STATUS_LABEL[r.status]}</span>
                </span>
                {r.status === 'resolved' && (
                  <button onClick={() => act(r, 'unhide')} disabled={busy === r.id} className="shrink-0 text-xs text-violet-700 underline">公開に戻す</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
