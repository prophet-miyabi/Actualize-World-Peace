'use client';
import { useEffect, useState } from 'react';
import api from '@/lib/api';

// 管理画面のAIを使うページの上に出す。実際に1回だけ小さな呼び出しをして、つながらない場合は原因と直し方をそのまま表示する
export default function AiHealthBanner() {
  const [state, setState] = useState<{ ok: boolean; problem?: string; model?: string; stage?: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      setState((await api.get('/ops/ai-check')).data);
    } catch (e: any) {
      setState({ ok: false, problem: e?.response?.data?.error || 'AI接続の確認に失敗しました' });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => { check(); }, []);

  if (!state || state.ok) return null;
  return (
    <div className="mb-4 rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900">
      <p className="font-bold">⚠ AIにつながっていません</p>
      <p className="mt-1 whitespace-pre-wrap">{state.problem}</p>
      <p className="mt-2 text-xs text-red-800">
        直し方: Console（platform.claude.com）→ APIキー → 「キーを作成」→ 表示された完全なキーをコピー → Render の awp-backend → Environment → <code>ANTHROPIC_API_KEY</code> を貼り替えて Save Changes。再デプロイ後にこの表示が消えます。
      </p>
      <button onClick={check} disabled={checking} className="mt-2 rounded-full border border-red-400 px-3 py-1 text-xs font-bold disabled:opacity-40">{checking ? '確認中…' : 'もう一度確認'}</button>
    </div>
  );
}
