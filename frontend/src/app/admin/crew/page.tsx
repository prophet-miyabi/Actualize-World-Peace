'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';

type Block = { start: string; end: string; kind: 'task' | 'routine' | 'break'; taskKey?: string; title: string; part?: string };
type Task = {
  key: string; title: string; area: string; epic: string; owner: 'user' | 'agent'; agents: string[]; estimateMin: number; remainingMin: number;
  priority: number; planDay: string; dependsOn: string[]; status: string; steps: string | null; acceptance: string; notes: string | null;
  issueUrl: string | null; prUrl: string | null; reviewState: string | null;
};
type Status = {
  config: { discord: boolean; discordOwner: boolean; discordSetup: boolean; github: boolean; encryptionKey: boolean; askAi: boolean; interactionsUrl: string };
  paused: boolean;
  today: { day: string; label: string; now: string; blocks: Block[] };
  launchDay: string;
  tasks: Task[];
  logs: { id: string; agent: string; kind: string; taskKey: string | null; message: string; createdAt: string }[];
};

const STATUS_LABEL: Record<string, string> = { todo: '未着手', doing: '進行中', waiting: '返事待ち', blocked: '詰まっている', review: 'レビュー', done: '完了', skipped: 'スキップ' };
const STATUS_CLS: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-600', doing: 'bg-sky-100 text-sky-700', waiting: 'bg-amber-100 text-amber-700', blocked: 'bg-red-100 text-red-700',
  review: 'bg-violet-100 text-violet-700', done: 'bg-green-100 text-green-700', skipped: 'bg-gray-100 text-gray-400'
};
const PERSONA: Record<string, string> = { mina: '🗓️ミナ', sora: '🧭ソラ', kei: '🔍ケイ', tetsu: '🧪テツ', ritsu: '⚖️リツ', haru: '📣ハル' };

// ローンチ・クルー: 公開までのタスクと、今日の15分刻みの予定。Discordが未接続でも、ここで進み具合を確認・編集できる
export default function CrewPage() {
  const [s, setS] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'user' | 'agent' | 'open'>('open');

  const load = useCallback(async () => setS((await api.get('/crew/admin/status')).data), []);
  useEffect(() => { load().catch((e) => setError(e?.response?.status === 403 ? '管理者のみ利用できます。' : '読み込みに失敗しました。')); }, [load]);

  const run = async (name: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(name);
    setError('');
    setMsg('');
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || '処理できませんでした。');
    } finally {
      setBusy('');
    }
  };

  const update = (key: string, data: Record<string, unknown>) => run(`task:${key}`, () => api.put(`/crew/admin/tasks/${key}`, data), `${key} を更新しました。`);

  const byDay = useMemo(() => {
    const list = (s?.tasks ?? []).filter((t) => filter === 'all' || (filter === 'open' ? !['done', 'skipped'].includes(t.status) : t.owner === filter));
    const map = new Map<string, Task[]>();
    for (const t of list) map.set(t.planDay, [...(map.get(t.planDay) ?? []), t]);
    return Array.from(map.entries());
  }, [s, filter]);

  if (!s) return <div className="p-6 text-sm text-gray-500">{error || '読み込み中…'}</div>;

  const done = s.tasks.filter((t) => ['done', 'skipped'].includes(t.status)).length;
  const checks: [string, boolean, string][] = [
    ['暗号化キー（SECRET_ENCRYPTION_KEY）', s.config.encryptionKey, 'T04'],
    ['GitHub（GITHUB_OPS_TOKEN / GITHUB_REPO）', s.config.github, 'T02'],
    ['Discordの環境変数（4つ）', s.config.discord, 'T03'],
    ['運営者のDiscord ID（DISCORD_OWNER_ID）', s.config.discordOwner, 'T03'],
    ['Discordの初期設定（チャンネル作成）', s.config.discordSetup, 'T03'],
    ['/ask 用のAI（ANTHROPIC_API_KEY）', s.config.askAi, '任意']
  ];

  return (
    <div className="px-4 py-6 md:px-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-black">ローンチ・クルー</h1>
        <p className="text-sm text-gray-600 mt-1">
          公開日 {s.launchDay} まで。進み具合 {done}/{s.tasks.length}。Discordで、ミナが15分刻みの予定を出し、ソラ・ケイ・テツ・リツ・ハルがGitHubで実装とレビューを進めます（本番反映はあなたのマージだけ）。
        </p>
        {s.paused && <p className="mt-2 text-sm font-bold text-red-600">⏸ 緊急コントロールで停止中です</p>}
      </div>

      <section className="bg-white border rounded-2xl p-4">
        <h2 className="font-bold text-sm mb-2">接続の状態</h2>
        <ul className="text-sm space-y-1">
          {checks.map(([label, ok, task]) => (
            <li key={label} className="flex justify-between gap-3">
              <span>{ok ? '✅' : '⬜'} {label}</span>
              <span className="text-xs text-gray-400 shrink-0">{task}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-gray-500 mt-2 break-all">Discord開発者ポータルの Interactions Endpoint URL: <code>{s.config.interactionsUrl}</code></p>
        <div className="flex flex-wrap gap-2 mt-3">
          <button disabled={!!busy || !s.config.discord} onClick={() => run('setup', () => api.post('/crew/admin/setup'), 'Discordの初期設定が完了しました！Discordを見てね。')}
            className="rounded-full bg-violet-600 text-white text-sm font-bold px-4 py-2 disabled:opacity-40">{busy === 'setup' ? '設定中…' : 'Discordを初期設定'}</button>
          <button disabled={!!busy} onClick={() => run('replan', () => api.post('/crew/admin/replan'), '今日の残りの予定を組み直しました。')}
            className="rounded-full border text-sm px-4 py-2">今日の予定を組み直す</button>
          <button disabled={!!busy || !s.config.github} onClick={() => run('tick', () => api.post('/crew/admin/tick'), 'GitHubの状況を確認し、次のタスクを進めました。')}
            className="rounded-full border text-sm px-4 py-2 disabled:opacity-40">いますぐ進行を確認</button>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        {msg && <p className="text-sm text-green-700 mt-2">{msg}</p>}
      </section>

      <section className="bg-white border rounded-2xl p-4">
        <h2 className="font-bold text-sm mb-2">{s.today.label} の予定（15分刻み）・いま {s.today.now}</h2>
        {s.today.blocks.length === 0 ? <p className="text-sm text-gray-500">まだ予定がありません（毎朝9:30に自動で作成。「今日の予定を組み直す」でも作れます）</p> : (
          <ol className="text-sm divide-y max-h-96 overflow-y-auto">
            {s.today.blocks.map((b) => {
              const now = b.start <= s.today.now && s.today.now < b.end;
              return (
                <li key={b.start} className={`py-1.5 flex gap-3 ${now ? 'bg-violet-50 font-bold' : ''} ${b.kind === 'break' ? 'text-gray-400' : ''}`}>
                  <span className="w-24 shrink-0 tabular-nums text-gray-500">{b.start}-{b.end}</span>
                  <span className="min-w-0">{b.taskKey && <span className="text-violet-700">{b.taskKey} </span>}{b.title}{b.part && <span className="text-gray-400 text-xs">（{b.part}）</span>}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="font-bold text-sm">タスク（目標日ごと）</h2>
          <div className="flex gap-1 text-xs">
            {([['open', '未完了'], ['user', 'あなた'], ['agent', 'エージェント'], ['all', 'すべて']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded-full px-3 py-1 ${filter === k ? 'bg-gray-900 text-white' : 'bg-white border'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {byDay.map(([day, list]) => (
            <div key={day}>
              <p className="text-xs font-bold text-gray-500 mb-1">{day}</p>
              <ul className="bg-white border rounded-2xl divide-y">
                {list.map((t) => (
                  <li key={t.key} className="px-4 py-3">
                    <button onClick={() => setOpen(open === t.key ? null : t.key)} className="w-full text-left flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="text-xs font-bold text-violet-700">{t.key}</span>{' '}
                        <span className="text-sm font-bold">{t.title}</span>
                        <span className="block text-[11px] text-gray-500">{t.owner === 'user' ? 'あなた' : 'エージェント'}・{t.agents.map((a) => PERSONA[a] ?? a).join(' ')}・{t.estimateMin}分{t.dependsOn.length ? `・前提 ${t.dependsOn.join(',')}` : ''}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_CLS[t.status] ?? ''}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                    </button>
                    {open === t.key && (
                      <div className="mt-3 space-y-2 text-sm">
                        {t.steps && <pre className="whitespace-pre-wrap bg-gray-50 rounded-xl p-3 text-xs font-sans">{t.steps}</pre>}
                        <p className="text-xs"><span className="font-bold">完了の条件:</span></p>
                        <pre className="whitespace-pre-wrap bg-gray-50 rounded-xl p-3 text-xs font-sans">{t.acceptance}</pre>
                        {t.notes && <p className="text-xs bg-amber-50 rounded-xl p-3 whitespace-pre-wrap">メモ: {t.notes}</p>}
                        <div className="flex flex-wrap gap-3 text-xs">
                          {t.issueUrl && <a href={t.issueUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 underline">課題</a>}
                          {t.prUrl && <a href={t.prUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 underline">PR{t.reviewState ? `（${t.reviewState}）` : ''}</a>}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <select value={t.status} onChange={(e) => update(t.key, { status: e.target.value })} className="border rounded-lg px-2 py-1 text-sm" disabled={busy === `task:${t.key}`}>
                            {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                          <input type="date" defaultValue={t.planDay} onBlur={(e) => e.target.value !== t.planDay && update(t.key, { planDay: e.target.value })} className="border rounded-lg px-2 py-1 text-sm" />
                          <input type="number" min={15} step={15} defaultValue={t.estimateMin} onBlur={(e) => Number(e.target.value) !== t.estimateMin && update(t.key, { estimateMin: Number(e.target.value) })} className="border rounded-lg px-2 py-1 text-sm w-24" aria-label="見込み時間（分）" />
                          <span className="text-xs text-gray-400">分</span>
                        </div>
                        <p className="text-[11px] text-gray-400">「未着手」に戻すと、GitHubの課題・PRとの紐づけを外して最初からやり直します。</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {s.logs.length > 0 && (
        <section>
          <h2 className="font-bold text-sm mb-2">最近の動き</h2>
          <ul className="bg-white border rounded-2xl divide-y text-xs">
            {s.logs.map((l) => (
              <li key={l.id} className="px-4 py-2 flex gap-3">
                <span className="text-gray-400 shrink-0">{new Date(l.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span>{PERSONA[l.agent] ?? l.agent} {l.kind} {l.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
