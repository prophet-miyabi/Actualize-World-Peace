'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

type Harness = 'line' | 'x' | 'instagram';
type Addon = { id: string; key: string; harness: Harness; name: string; description: string; priceYen: number; isInstall: boolean };
type Order = {
  id: string;
  items: { name: string; priceYen: number; harness: Harness }[];
  totalYen: number;
  status: 'requested' | 'in_progress' | 'done' | 'canceled';
  paymentStatus: 'unpaid' | 'not_required' | 'paid';
  createdAt: string;
};

// 各Harnessの説明と「自分で導入する」手順。内容は開発元の公式情報（the-harness.com・GitHub）に基づく
const GUIDE: Record<Harness, {
  title: string; tagline: string; needs: string[]; command: string | null; costs: string; official: string; repo: string;
}> = {
  line: {
    title: 'LINE（L Harness）',
    tagline: 'LINE公式アカウントの顧客管理、ステップ配信、一斉配信、フォーム、予約。',
    needs: ['LINE公式アカウント（Messaging API）', 'Cloudflareのアカウント（無料から使えます）', 'パソコン（自分で導入する場合）'],
    command: 'npx create-line-harness',
    costs: 'ソフトの利用料は0円。LINEの配信料金、Cloudflareの利用料は別途かかる場合があります。',
    official: 'https://the-harness.com/line-harness/',
    repo: 'https://github.com/Shudesu/line-harness-oss'
  },
  x: {
    title: 'X（X Harness）',
    tagline: 'Xの予約投稿、リサーチ、エンゲージメントの管理。',
    needs: ['X API（従量課金のクレジット購入が必要）', 'Cloudflareのアカウント', 'パソコン（自分で導入する場合）'],
    command: 'npx create-x-harness',
    costs: 'ソフトの利用料は0円。X APIの利用料、Cloudflareの利用料は別途かかります。',
    official: 'https://the-harness.com/x-harness/',
    repo: 'https://github.com/Shudesu/x-harness-oss'
  },
  instagram: {
    title: 'Instagram（IG Harness）',
    tagline: 'コメントへの自動返信、DMの自動化。',
    needs: ['Instagramのビジネス／プロアカウント', 'Metaのアプリ（Instagram API・Messaging API）', 'Cloudflareのアカウント', 'パソコン（自分で導入する場合）'],
    command: 'npx create-ig-harness',
    costs: 'ソフトの利用料は0円。Cloudflareの利用料などは別途かかる場合があります。',
    official: 'https://the-harness.com/ig-harness/',
    repo: 'https://github.com/Shudesu/ig-harness-oss'
  }
};
const ORDER: Harness[] = ['line', 'x', 'instagram'];
const STATUS_LABEL: Record<Order['status'], string> = { requested: '受付済み', in_progress: '対応中', done: '完了', canceled: '取り消し' };
const PAYMENT_LABEL: Record<Order['paymentStatus'], string> = { unpaid: 'お支払い前', not_required: 'お支払い不要', paid: 'お支払い済み' };
const yen = (n: number) => (n === 0 ? '無料' : `¥${n.toLocaleString('ja-JP')}`);

export default function HarnessPage() {
  const [addons, setAddons] = useState<Addon[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [openGuide, setOpenGuide] = useState<Harness | null>(null);

  const load = useCallback(async () => {
    const [c, o] = await Promise.all([api.get('/harness/catalog'), api.get('/harness/orders/mine')]);
    setAddons(c.data.addons);
    setOrders(o.data.orders);
  }, []);

  useEffect(() => { load().catch(() => setError('読み込みに失敗しました。')); }, [load]);

  const total = useMemo(() => (addons ?? []).filter((a) => selected.includes(a.id)).reduce((s, a) => s + a.priceYen, 0), [addons, selected]);

  const toggle = (id: string) => {
    setDone(false);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await api.post('/harness/orders', { addonIds: selected, note });
      setSelected([]);
      setNote('');
      setDone(true);
      await load();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err?.response?.data?.error || '申し込みに失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id: string) => {
    if (!window.confirm('この申し込みを取り消しますか？')) return;
    try {
      await api.post(`/harness/orders/${id}/cancel`);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || '取り消せませんでした。');
    }
  };

  if (!addons) return <p className="p-8">{error || '読み込み中...'}</p>;

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-6 pb-40">
      <div className="max-w-2xl mx-auto">
        <Link href="/dashboard" className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <h1 className="text-2xl font-black mt-3 mb-1">LINE・X・Instagramを自動化</h1>
        <p className="text-sm text-gray-600 mb-4">必要なものを選んで申し込むだけ。<strong>導入は無料</strong>です。ボットや投稿の自動作成などの機能は、表示の料金で追加できます。</p>

        {done && (
          <div className="rounded-2xl p-4 mb-4 text-white bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500">
            <p className="font-bold">お申し込みを受け付けました！</p>
            <p className="text-sm opacity-90">運営者から、登録のメールアドレスにご連絡します。お支払い方法は準備中のため、あわせてご案内します。</p>
          </div>
        )}
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {ORDER.map((h) => {
          const g = GUIDE[h];
          const items = addons.filter((a) => a.harness === h);
          return (
            <section key={h} className="bg-white border rounded-3xl p-5 mb-5">
              <h2 className="text-lg font-black">{g.title}</h2>
              <p className="text-sm text-gray-600 mt-1 mb-4">{g.tagline}</p>

              {items.length === 0 ? (
                <p className="text-sm text-gray-500 mb-3">お申し込みメニューは準備中です。</p>
              ) : (
                <ul className="space-y-2 mb-3">
                  {items.map((a) => {
                    const on = selected.includes(a.id);
                    return (
                      <li key={a.id}>
                        <button type="button" onClick={() => toggle(a.id)} aria-pressed={on}
                          className={`w-full text-left rounded-2xl border-2 p-4 flex gap-3 items-start transition ${on ? 'border-violet-500 bg-violet-50' : 'border-gray-200'}`}>
                          <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center text-[11px] font-black ${on ? 'bg-violet-600 border-violet-600 text-white' : 'border-gray-300'}`}>{on ? '✓' : ''}</span>
                          <span className="flex-1 min-w-0">
                            <span className="flex justify-between gap-2">
                              <span className="font-bold">{a.name}</span>
                              <span className={`font-black shrink-0 ${a.priceYen === 0 ? 'text-emerald-600' : ''}`}>{yen(a.priceYen)}</span>
                            </span>
                            <span className="block text-xs text-gray-600 mt-1">{a.description}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <button type="button" onClick={() => setOpenGuide(openGuide === h ? null : h)} className="text-sm font-bold text-violet-600">
                {openGuide === h ? '▲ 閉じる' : '▼ 自分で導入する方法（無料）'}
              </button>
              {openGuide === h && (
                <div className="mt-3 text-sm text-gray-700 space-y-3">
                  <div>
                    <p className="font-bold mb-1">必要なもの</p>
                    <ul className="list-disc pl-5 space-y-0.5">{g.needs.map((n) => <li key={n}>{n}</li>)}</ul>
                  </div>
                  {g.command && (
                    <div>
                      <p className="font-bold mb-1">パソコンで次のコマンドを実行（約5分）</p>
                      <code className="block bg-gray-900 text-white rounded-xl px-4 py-3 text-xs break-all">{g.command}</code>
                      <p className="text-xs text-gray-500 mt-1">画面の案内に沿って進めると、あなたのCloudflareに設置されます。詳しくは公式の手順をご覧ください。</p>
                    </div>
                  )}
                  <p className="text-xs text-gray-500">{g.costs}</p>
                  <p className="text-xs">
                    <a href={g.official} target="_blank" rel="noopener noreferrer" className="underline text-violet-700">公式サイト</a>
                    {' ・ '}
                    <a href={g.repo} target="_blank" rel="noopener noreferrer" className="underline text-violet-700">GitHub</a>
                  </p>
                </div>
              )}
            </section>
          );
        })}

        <p className="text-[11px] text-gray-500 leading-relaxed mb-8">
          L Harness・X Harness・IG Harness は、AIエージェント株式会社（野田修一 氏）が公開しているオープンソースソフトウェア（MIT License）です。
          AWPは開発元と提携しておらず、独立した導入支援として紹介しています。導入先は、あなた自身のCloudflareアカウントです。
        </p>

        {orders.length > 0 && (
          <section className="mb-8">
            <h2 className="font-bold mb-2">申し込み履歴</h2>
            <ul className="space-y-2">
              {orders.map((o) => (
                <li key={o.id} className="bg-white border rounded-2xl p-4">
                  <div className="flex justify-between items-center gap-2 mb-1">
                    <span className="text-xs text-gray-500">{new Date(o.createdAt).toLocaleDateString('ja-JP')}</span>
                    <span className="text-xs font-bold">
                      {STATUS_LABEL[o.status]}・{PAYMENT_LABEL[o.paymentStatus]}
                    </span>
                  </div>
                  <p className="text-sm">{o.items.map((i) => i.name).join('、')}</p>
                  <div className="flex justify-between items-center mt-1">
                    <span className="font-bold text-sm">合計 {yen(o.totalYen)}</span>
                    {o.status === 'requested' && <button onClick={() => cancel(o.id)} className="text-xs text-red-600">取り消す</button>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* 選択中の内容と申し込みボタン（スマホでは下のタブバーの上に固定） */}
      {selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-[68px] md:bottom-0 z-30 px-4 pb-3">
          <div className="max-w-2xl mx-auto bg-white border shadow-xl rounded-3xl p-4">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2}
              placeholder="ご要望（任意）例: 美容室の予約にLINEを使いたい"
              className="w-full border rounded-2xl p-3 text-base mb-3" />
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs text-gray-500">{selected.length}件を選択中</p>
                <p className="font-black text-lg">合計 {yen(total)}</p>
              </div>
              <button onClick={submit} disabled={submitting}
                className="bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold rounded-full px-6 py-3 disabled:opacity-50">
                {submitting ? '送信中…' : '申し込む'}
              </button>
            </div>
            <p className="text-[11px] text-gray-500 mt-2">お支払い方法は準備中です。お申し込み後に運営者からご案内します。</p>
          </div>
        </div>
      )}
    </div>
  );
}
