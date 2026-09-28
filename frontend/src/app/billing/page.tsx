'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

export default function Billing() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<'welcome' | 'cancel' | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('welcome') === '1') setNotice('welcome');
    else if (q.get('checkout') === 'cancel') setNotice('cancel');
  }, []);

  const handleSubscribe = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post('/billing/checkout');
      window.location.href = data.url;
    } catch (err: any) {
      setError(err?.response?.data?.error || '手続きを開始できませんでした。');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-gray-50">
      {notice === 'welcome' && (
        <div className="w-full max-w-md bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl p-4 mb-4">
          アカウントを作成しました。プランにお申し込みいただくと、ページが公開され、LINE連携も有効になります。
        </div>
      )}
      {notice === 'cancel' && (
        <div className="w-full max-w-md bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-xl p-4 mb-4">
          お申し込みは完了していません。いつでもこの画面から再開できます。
        </div>
      )}
      <div className="bg-white p-8 sm:p-10 rounded-2xl shadow-sm border border-gray-200 w-full max-w-md text-center">
        <h1 className="text-2xl font-bold mb-2">スタンダードプラン</h1>
        <p className="text-4xl font-black mb-1">¥2,980<span className="text-base font-normal text-gray-500">/月（税込）</span></p>
        <p className="text-sm text-gray-500 mb-6">契約期間の縛りなし・いつでも解約できます</p>
        <ul className="text-left text-sm text-gray-700 space-y-2 mb-8">
          <li>✓ 試作したページの公開（独自URL）</li>
          <li>✓ AIによる文章・デザインの作成と作り直し</li>
          <li>✓ 機能の追加（メニュー・よくある質問など）</li>
          <li>✓ LINE公式アカウント連携・自動応答（お持ちの方は追加料金なし）</li>
          <li>✓ お問い合わせの管理</li>
        </ul>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        <button onClick={handleSubscribe} disabled={loading}
          className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 disabled:opacity-50">
          {loading ? '処理中...' : 'このプランに申し込む'}
        </button>
        <p className="text-xs text-gray-400 mt-4">お支払い情報の入力は、安全なStripeの決済画面で行われます。カード情報が当サイトに保存されることはありません。</p>
        <p className="text-xs text-gray-400 mt-3 space-x-3">
          <a href="/legal" className="underline">特定商取引法に基づく表記</a>
          <a href="/privacy" className="underline">プライバシーポリシー</a>
        </p>
      </div>
      <Link href="/dashboard" className="text-sm text-gray-500 mt-6">あとで申し込む（ダッシュボードへ）</Link>
    </div>
  );
}
