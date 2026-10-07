'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';

type Turn = { role: 'user' | 'assistant'; content: string; tools?: string[] };
type Proposal = {
  id: string; kind: 'code_change' | 'setting'; title: string; body: string;
  status: 'awaiting_approval' | 'approved' | 'rejected' | 'failed';
  githubIssueNumber: number | null; githubIssueUrl: string | null; error: string | null; createdAt: string;
};

const TOOL_LABEL: Record<string, string> = {
  get_overview: 'システムの状況を確認',
  list_open_errors: 'エラーを確認',
  list_harness_orders: '申し込みを確認',
  get_progress_checklist: '開発の進み具合を確認',
  list_proposals: 'これまでの提案を確認',
  propose_setting_change: '設定変更の提案を作成',
  propose_code_change: '実装の提案を作成'
};
const STATUS_LABEL: Record<Proposal['status'], string> = { awaiting_approval: '承認待ち', approved: '承認済み', rejected: '却下', failed: '失敗' };
// AIの返答によく出る **太字** と ## 見出し だけを読みやすく表示する（HTMLとしては解釈しない）
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const heading = /^#{1,3}\s+/.test(line);
        const body = line.replace(/^#{1,3}\s+/, '');
        const parts = body.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
          part.startsWith('**') && part.endsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>
        );
        return <span key={i} className={`block ${heading ? 'font-bold mt-2' : ''}`}>{parts.length ? parts : ' '}</span>;
      })}
    </>
  );
}

const QUICK = ['今のシステムの状況を教えて', '公開までの課題を整理して', '未解決のエラーを確認して', 'Harnessの申し込み状況は？'];

// AIオペレーター: 運営者とAIが対話して、状況確認・課題整理・提案を行う。返答は少しずつ（ストリーミングで）表示する。
// 設定変更やコード変更は提案として作られ、この画面の「承認」を押したときだけ実行される
export default function OpsPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [githubReady, setGithubReady] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadProposals = useCallback(async () => {
    const { data } = await api.get('/ops/proposals');
    setProposals(data.proposals);
    setGithubReady(data.githubConfigured);
  }, []);

  useEffect(() => { loadProposals().catch(() => {}); }, [loadProposals]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [turns]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setError('');
    setInput('');
    const history: Turn[] = [...turns, { role: 'user', content }];
    setTurns([...history, { role: 'assistant', content: '', tools: [] }]);
    setBusy(true);

    const update = (fn: (t: Turn) => Turn) =>
      setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));

    try {
      const res = await fetch('/api/ops/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ messages: history.map(({ role, content: c }) => ({ role, content: c })) })
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'AIに接続できませんでした。');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() || '';
        for (const ev of events) {
          const line = ev.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const msg = JSON.parse(line.slice(6));
          if (msg.type === 'text') update((t) => ({ ...t, content: t.content + msg.text }));
          else if (msg.type === 'tool') update((t) => ({ ...t, tools: [...(t.tools || []), msg.name] }));
          else if (msg.type === 'proposal') loadProposals().catch(() => {});
          else if (msg.type === 'error') setError(msg.message);
        }
      }
    } catch (e: any) {
      setError(e?.message || 'AIの応答に失敗しました。');
    } finally {
      setBusy(false);
      loadProposals().catch(() => {});
    }
  };

  const decide = async (p: Proposal, action: 'approve' | 'reject') => {
    setDeciding(p.id);
    setError('');
    try {
      await api.post(`/ops/proposals/${p.id}/${action}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || '処理できませんでした。');
    } finally {
      setDeciding(null);
      loadProposals().catch(() => {});
    }
  };

  const waiting = proposals.filter((p) => p.status === 'awaiting_approval');
  const recent = proposals.filter((p) => p.status !== 'awaiting_approval').slice(0, 8);

  return (
    <div className="px-4 py-6 md:px-8 max-w-3xl pb-40">
      <h1 className="text-2xl font-black">AIオペレーター</h1>
      <p className="text-sm text-gray-600 mt-1">
        システムの状況確認・課題の整理・改善の提案をチャットで。設定変更やコードの実装は「提案」として作られ、あなたが承認したときだけ実行されます。
      </p>

      {waiting.length > 0 && (
        <section className="mt-5 space-y-3">
          <h2 className="font-bold text-sm">承認待ちの提案（{waiting.length}）</h2>
          {waiting.map((p) => (
            <div key={p.id} className="bg-white border-2 border-violet-300 rounded-2xl p-4">
              <p className="text-[11px] font-bold text-violet-700">{p.kind === 'code_change' ? 'コード変更・新機能の実装' : 'システム設定の変更'}</p>
              <p className="font-bold mt-0.5">{p.title}</p>
              <details className="mt-2">
                <summary className="text-xs text-gray-500 cursor-pointer">{p.kind === 'code_change' ? '実装の指示書を見る' : '理由を見る'}</summary>
                <div className="text-xs text-gray-700 mt-2 bg-gray-50 rounded-lg p-3"><RichText text={p.body} /></div>
              </details>
              <p className="text-[11px] text-gray-500 mt-2">
                {p.kind === 'code_change'
                  ? githubReady
                    ? '承認するとGitHubに課題が作られ、Claude Code が実装してプルリクエストを出します。本番反映はあなたがマージしたときだけです。'
                    : 'GitHub連携が未設定のため、まだ承認できません（設定方法はダッシュボードの「設定の状態」参照）。'
                  : '承認するとすぐに反映されます。'}
              </p>
              <div className="flex gap-2 mt-3">
                <button onClick={() => decide(p, 'approve')} disabled={deciding === p.id || (p.kind === 'code_change' && !githubReady)}
                  className="rounded-full bg-violet-600 text-white font-bold text-sm px-5 py-2 disabled:opacity-40">承認する</button>
                <button onClick={() => decide(p, 'reject')} disabled={deciding === p.id}
                  className="rounded-full border text-sm px-5 py-2 text-gray-600">却下</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="mt-6 space-y-4">
        {turns.length === 0 && (
          <div className="bg-white border rounded-2xl p-4">
            <p className="text-sm text-gray-600 mb-3">たとえば、こんなふうに話しかけてください。</p>
            <div className="flex flex-wrap gap-2">
              {QUICK.map((q) => (
                <button key={q} onClick={() => send(q)} className="rounded-full bg-violet-50 text-violet-700 text-xs font-bold px-3 py-2">{q}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${t.role === 'user' ? 'whitespace-pre-wrap' : ''} ${t.role === 'user' ? 'bg-violet-600 text-white' : 'bg-white border'}`}>
              {t.tools && t.tools.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {t.tools.map((name, j) => (
                    <span key={j} className="text-[10px] font-bold bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{TOOL_LABEL[name] || name}</span>
                  ))}
                </div>
              )}
              {t.content ? (t.role === 'assistant' ? <RichText text={t.content} /> : t.content) : (busy && i === turns.length - 1 ? '考えています…' : '')}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </section>

      {recent.length > 0 && (
        <section className="mt-8">
          <h2 className="font-bold text-sm mb-2">最近の提案</h2>
          <ul className="bg-white border rounded-xl divide-y text-sm">
            {recent.map((p) => (
              <li key={p.id} className="px-4 py-3 flex justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate">{p.title}</span>
                  {p.error && <span className="block text-xs text-red-600">{p.error}</span>}
                </span>
                <span className="shrink-0 text-xs">
                  {p.githubIssueUrl ? <a href={p.githubIssueUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 underline">GitHub #{p.githubIssueNumber}</a> : STATUS_LABEL[p.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="fixed bottom-0 inset-x-0 md:left-60 z-30 bg-white/95 backdrop-blur border-t px-4 py-3"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        {error && <p className="text-red-600 text-xs mb-2 max-w-3xl">{error}</p>}
        <div className="flex gap-2 max-w-3xl">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} placeholder="AIオペレーターに話しかける"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(input); } }}
            className="flex-1 border rounded-2xl px-4 py-3 text-base resize-none" />
          <button disabled={busy || !input.trim()} className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold px-5 disabled:opacity-40">
            送信
          </button>
        </div>
      </form>
    </div>
  );
}
