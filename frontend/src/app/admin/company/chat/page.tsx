'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import Thinking from '@/components/Thinking';
import AiHealthBanner from '@/components/admin/AiHealthBanner';

type Action = { id: string; tool: string; reason: string; status?: string };
type Msg = { role: 'user' | 'assistant'; content: string; tools?: string[]; actions?: Action[] };
type ChatSummary = { id: string; agent: string; title: string; costUsd: number; updatedAt: string };
type Agent = { key: string; name: string; department: string; mission: string };

const TOOL_LABEL: Record<string, string> = {
  get_overview: '現況を確認', get_metrics: '指標を確認', get_costs: 'AI費用を確認', get_goals: '目標を確認', list_tasks: 'タスクを確認', get_task: 'タスクの詳細を確認',
  read_memory: 'メモリを読む', write_memory: 'メモリに保存', create_task: 'タスクを作成', report_to_owner: 'オーナーに報告', get_launch_plan: '開発の進み具合を確認',
  request_implementation: '実装を依頼', list_open_errors: 'エラーを確認', draft_content: '下書きを保存', get_support_signals: 'つまずきを集計', get_ledger: '台帳を確認',
  get_plan_config: '料金設定を確認', propose_plan_config: '料金変更を提案', get_tool_catalog: '提携カタログを確認', propose_tool_catalog: 'カタログ変更を提案',
  list_events: 'ログを確認', list_actions: '承認待ちを確認', propose_flag: '停止/再開を提案', web_search: 'ウェブ検索'
};
const QUICK: Record<string, string[]> = {
  ceo: ['いまの経営状況を3行で教えて', '今日の重点を決めてCOOに委任して', 'オーナーの判断が必要なことはある？'],
  coo: ['未完了のタスクと詰まりを整理して', 'この指示を担当に振り分けて：', '今週の成果をまとめて'],
  research: ['日本のクリエイター向け競合サービスの最新動向を調べて', 'ASPで提携できそうなサービスを3つ調べて'],
  product: ['オンボーディングの改善案を1つ、実装依頼まで作って', 'いまのデータから最優先の改善点は？'],
  engineering: ['未解決エラーを分類して修正依頼を作って', '実装依頼の進み具合を教えて'],
  data: ['直近30日の指標を計画と比べて', '計測できていないKPIはどれ？'],
  marketing: ['公開日の告知文（X用）を3本下書きして', '獲得ループの現状と次の一手は？'],
  finance: ['今月の収支とAI費用を報告して', '無料枠のAI費用のリスクを見積もって'],
  auditor: ['直近の完了タスクで自己申告だけのものはない？', '今週の経営判断を監査して']
};

function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const heading = /^#{1,3}\s+/.test(line);
        const body = line.replace(/^#{1,3}\s+/, '');
        const parts = body.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
          part.startsWith('**') && part.endsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>
        );
        return <span key={i} className={`block ${heading ? 'font-bold mt-2' : ''}`}>{parts.length ? parts : ' '}</span>;
      })}
    </>
  );
}

// エージェントとの会話: 指示を送ると、その場で道具を使って実行し、結果を報告する。高リスクの操作は承認ボタンが出る
export default function CompanyChatPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [agentKey, setAgentKey] = useState('ceo');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [actionStatus, setActionStatus] = useState<Record<string, string>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [devToken, setDevToken] = useState('');
  const [devBusy, setDevBusy] = useState(false);
  const issueDevToken = async () => {
    if (!confirm('Claude Code 用の管理者トークン（90日有効）を発行します。よろしいですか？')) return;
    setDevBusy(true);
    try { setDevToken((await api.post('/auth/devenv-token')).data.token); } catch (e: any) { setError(e?.response?.data?.error || '発行できませんでした。'); } finally { setDevBusy(false); }
  };
  const [showList, setShowList] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const loadChats = useCallback(async () => setChats((await api.get('/company/chats')).data.chats), []);
  useEffect(() => {
    api.get('/company/status').then((r) => setAgents(r.data.org)).catch(() => setError('読み込みに失敗しました。'));
    loadChats().catch(() => {});
  }, [loadChats]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);

  const openChat = async (id: string) => {
    const { data } = await api.get(`/company/chats/${id}`);
    setChatId(id);
    setAgentKey(data.chat.agent);
    setMsgs(data.chat.messages);
    setActionStatus(Object.fromEntries((data.actions as Action[]).map((a) => [a.id, a.status ?? 'pending'])));
    setShowList(false);
    setError('');
  };
  const newChat = () => { setChatId(null); setMsgs([]); setActionStatus({}); setShowList(false); setError(''); };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    setError('');
    setInput('');
    let id = chatId;
    try {
      if (!id) {
        id = (await api.post('/company/chats', { agent: agentKey })).data.chat.id as string;
        setChatId(id);
      }
      setMsgs((m) => [...m, { role: 'user', content }, { role: 'assistant', content: '', tools: [], actions: [] }]);
      const update = (fn: (t: Msg) => Msg) => setMsgs((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));
      const res = await fetch(`/api/company/chats/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: JSON.stringify({ text: content })
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'エージェントに接続できませんでした。');
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
          const e = JSON.parse(line.slice(6));
          if (e.type === 'text') { update((t) => ({ ...t, content: t.content + e.text })); setStatus(''); }
          else if (e.type === 'status') setStatus(e.text);
          else if (e.type === 'tool') update((t) => ({ ...t, tools: [...(t.tools || []), e.name] }));
          else if (e.type === 'action') { update((t) => ({ ...t, actions: [...(t.actions || []), { id: e.id, tool: e.tool, reason: e.reason }] })); setActionStatus((s) => ({ ...s, [e.id]: 'pending' })); }
          else if (e.type === 'error') setError(e.message);
        }
      }
    } catch (e: any) {
      setError(e?.message || 'エージェントの応答に失敗しました。');
    } finally {
      setBusy(false);
      setStatus('');
      loadChats().catch(() => {});
    }
  };

  const decide = async (a: Action, decision: 'approve' | 'reject') => {
    try {
      const note = decision === 'reject' ? prompt('却下の理由（エージェントに伝わります）') ?? '' : '';
      await api.post(`/company/actions/${a.id}/${decision}`, { note });
      setActionStatus((s) => ({ ...s, [a.id]: decision === 'approve' ? 'executed' : 'rejected' }));
      if (decision === 'approve') await send(`操作「${a.tool}」を承認して実行しました。結果を確認して、続きを進めてください。`);
    } catch (e: any) {
      setError(e?.response?.data?.error || '処理できませんでした。');
    }
  };

  const agent = agents.find((a) => a.key === agentKey);
  const STATUS: Record<string, string> = { pending: '承認待ち', approved: '承認済み', executed: '実行済み', rejected: '却下', failed: '失敗' };

  return (
    <div className="px-4 py-6 md:px-8 max-w-3xl pb-44">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">AWP Intelligence</h1>
          <p className="text-sm text-gray-600 mt-1">指示を送ると、その場で道具を使って実行し、結果を報告します。お金・設定・公開に関わる操作は、この画面の承認ボタンを押したときだけ実行されます。</p>
        </div>
        <Link href="/admin/company" className="shrink-0 text-xs text-violet-700 underline">AI企業の画面</Link>
      </div>

      {/* Claude Code（開発環境）から同じエージェント・道具を使うための接続。トークンは一度だけ表示する */}
      <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold">Claude Code を AWP の開発環境兼管理画面にする</p>
          <button onClick={issueDevToken} disabled={devBusy} className="rounded-full bg-violet-600 text-white px-3 py-1 font-bold disabled:opacity-40">{devBusy ? '発行中…' : 'Claude Code に接続（トークン発行）'}</button>
        </div>
        {devToken && (
          <div className="mt-2 space-y-1">
            <p>1. 下のトークンをコピーし、パソコンの <code>~/.claude/awp-admin-token</code> に1行で保存（90日有効。この画面を閉じると二度と見られません。チャットには貼らないでください）</p>
            <textarea readOnly value={devToken} onFocus={(e) => e.currentTarget.select()} className="w-full border rounded p-2 text-[11px] font-mono bg-white" rows={3} />
            <p>2. リポジトリ（webline-sync）を Claude Code で開くと、<code>.mcp.json</code> の <b>awp</b> サーバーと <code>.claude/agents</code> のエージェント（awp-intelligence など）が使えます。例: 「/awp-status」「AWP Intelligence に公開までの優先順位を聞いて」</p>
          </div>
        )}
      </div>

      <div className="mt-4"><AiHealthBanner /></div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select value={agentKey} disabled={!!chatId} onChange={(e) => setAgentKey(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
          {agents.map((a) => <option key={a.key} value={a.key}>{a.name}</option>)}
        </select>
        <button onClick={newChat} className="rounded-full bg-gray-900 text-white text-xs font-bold px-4 py-2">＋ 新しい会話</button>
        <button onClick={() => setShowList(!showList)} className="rounded-full border text-xs font-bold px-4 py-2">過去の会話（{chats.length}）</button>
      </div>
      {agent && !chatId && <p className="mt-2 text-xs text-gray-500 whitespace-pre-wrap">{agent.mission.split('\n')[0]}</p>}

      {showList && (
        <ul className="mt-3 bg-white border rounded-2xl divide-y text-sm max-h-64 overflow-y-auto">
          {chats.length === 0 && <li className="px-4 py-3 text-gray-400">まだ会話はありません</li>}
          {chats.map((c) => (
            <li key={c.id} className="px-4 py-2 flex items-center gap-3">
              <button onClick={() => openChat(c.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-bold">{c.title}</span>
                <span className="block text-[11px] text-gray-500">{agents.find((a) => a.key === c.agent)?.name ?? c.agent}・{new Date(c.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}・${c.costUsd.toFixed(2)}</span>
              </button>
              <button onClick={async () => { await api.delete(`/company/chats/${c.id}`); if (chatId === c.id) newChat(); loadChats(); }} className="text-xs text-gray-400">削除</button>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-5 space-y-4">
        {msgs.length === 0 && (
          <div className="bg-white border rounded-2xl p-4">
            <p className="text-sm text-gray-600 mb-3">たとえば、こんなふうに指示できます。</p>
            <div className="flex flex-wrap gap-2">
              {(QUICK[agentKey] ?? QUICK.ceo).map((q) => (
                <button key={q} onClick={() => (q.endsWith('：') ? setInput(q) : send(q))} className="rounded-full bg-violet-50 text-violet-700 text-xs font-bold px-3 py-2">{q}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${m.role === 'user' ? 'bg-violet-600 text-white whitespace-pre-wrap' : 'bg-white border'}`}>
              {m.tools && m.tools.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {m.tools.map((name, j) => <span key={j} className="text-[10px] font-bold bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{TOOL_LABEL[name] || name}</span>)}
                </div>
              )}
              {m.content ? (m.role === 'assistant' ? <RichText text={m.content} /> : m.content) : (busy && i === msgs.length - 1 ? <Thinking text={status} phases={['考えて、動いています', '道具で確かめています', 'まとめています']} /> : '')}
              {m.actions && m.actions.length > 0 && m.actions.map((a) => (
                <div key={a.id} className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-gray-800">
                  <p className="text-[11px] font-bold text-amber-700">🧑‍⚖️ 承認が必要な操作: {TOOL_LABEL[a.tool] || a.tool}</p>
                  <p className="text-xs mt-1 whitespace-pre-wrap">{a.reason}</p>
                  {(actionStatus[a.id] ?? 'pending') === 'pending' ? (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => decide(a, 'approve')} disabled={busy} className="rounded-full bg-violet-600 text-white text-xs font-bold px-4 py-1.5 disabled:opacity-40">承認して実行</button>
                      <button onClick={() => decide(a, 'reject')} disabled={busy} className="rounded-full border text-xs px-4 py-1.5">却下</button>
                    </div>
                  ) : <p className="text-[11px] font-bold mt-1">{STATUS[actionStatus[a.id]] ?? actionStatus[a.id]}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </section>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="fixed bottom-0 inset-x-0 md:left-60 z-30 bg-white/95 backdrop-blur border-t px-4 py-3"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
        {error && <p className="text-red-600 text-xs mb-2 max-w-3xl">{error}</p>}
        <div className="flex gap-2 max-w-3xl">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder={`${agent?.name ?? 'エージェント'}に指示する（Ctrl+Enterで送信）`}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(input); } }}
            className="flex-1 border rounded-2xl px-4 py-3 text-base resize-none" />
          <button disabled={busy || !input.trim()} className="rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold px-5 disabled:opacity-40">送信</button>
        </div>
      </form>
    </div>
  );
}
