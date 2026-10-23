'use client';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

// LINE 公式アカウントの接続（スマホだけで完結）。
// AWP のアカウントがあれば、LINE Developers で発行した 3 つの値を貼るだけ。Webhook の登録と疎通確認は AWP が行う。
type Account = { id: string; label: string; channelId: string; botBasicId: string | null; webhookActivated: boolean; isDefault: boolean; active: boolean; healthScore: number; errorCount: number; cooldownUntil: string | null; lastError: string | null; friendsAdded: number; addUrl: string | null; webhookUrl: string };
const input = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-base';
const btn = 'rounded-full bg-violet-600 text-white text-sm font-bold px-5 py-2 disabled:opacity-40';

export default function LineSetup({ onChanged }: { onChanged?: () => void }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [form, setForm] = useState({ label: '', channelId: '', channelSecret: '', channelAccessToken: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => { const { data } = await api.get('/harness/crm/line-accounts'); setAccounts(data.accounts); }, []);
  useEffect(() => { load().catch(() => setError('読み込めませんでした')); }, [load]);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(''); setMsg('');
    try {
      const { data } = await api.post('/harness/crm/line-accounts', form);
      setMsg(data.webhook.ok ? `「${data.bot.displayName}」をつなぎました。LINE から「テスト」と送ると、受信箱に届きます。` : `アカウントは登録しましたが、Webhook の設定で止まりました: ${data.webhook.reason}`);
      setForm({ label: '', channelId: '', channelSecret: '', channelAccessToken: '' });
      setOpen(false);
      await load(); onChanged?.();
    } catch (err: any) { setError(err?.response?.data?.error || '接続できませんでした'); } finally { setBusy(false); }
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(''); setMsg('');
    try { await fn(); setMsg(ok); await load(); onChanged?.(); } catch (err: any) { setError(err?.response?.data?.error || '処理できませんでした'); } finally { setBusy(false); }
  };

  return (
    <section className="bg-white border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">LINE 公式アカウント</h2>
        <button type="button" onClick={() => setOpen(!open)} className="text-xs font-bold text-violet-700">{open ? '閉じる' : '＋ つなぐ'}</button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {msg && <p className="text-sm text-emerald-700">{msg}</p>}
      {open && (
        <form onSubmit={connect} className="rounded-2xl bg-violet-50 p-3 space-y-2 text-sm">
          <p className="font-bold">スマホだけで 5 分。パソコンもターミナルも要りません。</p>
          <ol className="list-decimal pl-5 space-y-1 text-xs text-gray-700">
            <li>LINE 公式アカウントをお持ちでなければ、LINE Official Account Manager（<a className="underline" href="https://manager.line.biz/" target="_blank" rel="noopener noreferrer">manager.line.biz</a>）で無料で作ります。</li>
            <li>同じ画面の「設定 → Messaging API」で Messaging API を有効にし、表示された <b>Channel ID</b> と <b>Channel secret</b> を控えます。</li>
            <li>LINE Developers（<a className="underline" href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer">developers.line.biz</a>）で同じチャネルを開き、「Messaging API 設定」の一番下で <b>チャネルアクセストークン（長期）</b> を発行して控えます。</li>
            <li>3 つを下に貼って「つなぐ」。Webhook の URL 登録と疎通確認は AWP が自動で行います。あとは「応答設定」で「Webhook」をオン、「応答メッセージ」をオフにしてください。</li>
          </ol>
          <input className={input} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="名前（任意。例: 本店）" />
          <input className={input} value={form.channelId} inputMode="numeric" autoCapitalize="none" onChange={(e) => setForm({ ...form, channelId: e.target.value.trim() })} placeholder="Channel ID" required />
          <input className={input} value={form.channelSecret} autoCapitalize="none" onChange={(e) => setForm({ ...form, channelSecret: e.target.value.trim() })} placeholder="Channel secret" required />
          <textarea className={`${input} min-h-[72px]`} value={form.channelAccessToken} autoCapitalize="none" onChange={(e) => setForm({ ...form, channelAccessToken: e.target.value.trim() })} placeholder="チャネルアクセストークン（長期）" required />
          <p className="text-[11px] text-gray-500">値は AWP のデータベースに暗号化通信で保存し、LINE の公式 API（api.line.me）にだけ使います。他のサーバーには送りません。</p>
          <button disabled={busy} className={btn}>{busy ? '確認中…' : 'つなぐ'}</button>
        </form>
      )}
      {accounts === null ? <p className="text-xs text-gray-400">読み込み中…</p> : accounts.length === 0 ? (
        <p className="text-sm text-gray-600">まだつないでいません。「＋ つなぐ」から、LINE の 3 つの値を貼るだけで始められます。</p>
      ) : (
        <ul className="space-y-2">
          {accounts.map((a) => (
            <li key={a.id} className={`rounded-2xl border p-3 text-sm ${a.active ? '' : 'opacity-60'}`}>
              <div className="flex justify-between gap-2">
                <p className="font-bold min-w-0 truncate">{a.label}{a.isDefault ? <span className="ml-1 text-[10px] rounded-full bg-violet-100 text-violet-700 px-2 py-0.5">既定</span> : null}</p>
                <span className={`font-black ${a.healthScore >= 70 ? 'text-emerald-600' : a.healthScore >= 40 ? 'text-amber-600' : 'text-red-600'}`}>{a.healthScore}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">{a.botBasicId ?? a.channelId}・友だち {a.friendsAdded}・{a.webhookActivated ? 'Webhook 接続済み' : 'Webhook 未接続'}{a.cooldownUntil && new Date(a.cooldownUntil) > new Date() ? '・休止中' : ''}</p>
              {a.lastError && <p className="text-[11px] text-red-600 mt-1 break-all">{a.lastError}</p>}
              {a.addUrl && <p className="text-xs mt-1 break-all">友だち追加: <a className="underline text-violet-700" href={a.addUrl} target="_blank" rel="noopener noreferrer">{a.addUrl}</a></p>}
              <div className="flex flex-wrap gap-3 mt-2 text-xs">
                <button type="button" disabled={busy} onClick={() => act(() => api.post(`/harness/crm/line-accounts/${a.id}/reconnect`), 'Webhook を登録し直しました')} className="underline text-violet-700">再接続</button>
                {!a.isDefault && <button type="button" disabled={busy} onClick={() => act(() => api.put(`/harness/crm/line-accounts/${a.id}`, { isDefault: true }), '既定にしました')} className="underline text-violet-700">既定にする</button>}
                {(a.healthScore < 70 || a.cooldownUntil) && <button type="button" disabled={busy} onClick={() => act(() => api.put(`/harness/crm/line-accounts/${a.id}`, { reset: true, active: true }), '健全性を戻しました')} className="underline text-violet-700">健全性を戻す</button>}
                <button type="button" disabled={busy} onClick={() => act(() => api.put(`/harness/crm/line-accounts/${a.id}`, { active: !a.active }), a.active ? '止めました' : '動かしました')} className="underline text-violet-700">{a.active ? '止める' : '動かす'}</button>
                <button type="button" disabled={busy} onClick={() => { if (confirm(`「${a.label}」の接続を外しますか？`)) void act(() => api.delete(`/harness/crm/line-accounts/${a.id}`), '外しました'); }} className="underline text-red-600">外す</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
