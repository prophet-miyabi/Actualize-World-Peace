'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';

// 管理者用の自動ログインリンク（?code=...）を受け取り、トークンを保存してダッシュボードへ進む。
// テスト専用。バックエンド側でENABLE_DEV_LOGINが有効なときだけ機能する。
export default function DevLogin() {
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) { setError('リンクにコードが含まれていません。'); return; }
    api.get(`/auth/dev-login?code=${encodeURIComponent(code)}`)
      .then(({ data }) => {
        localStorage.setItem('token', data.token);
        router.replace('/dashboard');
      })
      .catch(() => setError('このリンクは無効です。'));
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <p className="text-gray-500">{error || 'ログインしています…'}</p>
    </div>
  );
}
