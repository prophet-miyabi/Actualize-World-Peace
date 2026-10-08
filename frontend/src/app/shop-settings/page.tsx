'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Field = { key: string; label: string; max: number };
type Legal = Record<string, any>;
type Bank = { bank: string; branch: string; type: string; number: string; holder: string };

// ショップの設定（直接払い）: 特定商取引法に基づく表記・支払い方法・送料。そろうと「販売する」をオンにできる
export default function ShopSettingsPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [legal, setLegal] = useState<Legal>({});
  const [bank, setBank] = useState<Bank>({ bank: '', branch: '', type: '普通', number: '', holder: '' });
  const [form, setForm] = useState({ enabled: false, bankEnabled: false, inPersonEnabled: false, inPersonNote: '', shippingFeeYen: '0', freeShippingOverYen: '', paymentDays: '7' });
  const [missing, setMissing] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data } = await api.get('/shop/settings');
    setFields(data.fields);
    setMissing(data.missing);
    if (data.profile) {
      setLegal(data.profile.legal);
      setForm({
        enabled: data.profile.enabled, bankEnabled: data.profile.bankEnabled, inPersonEnabled: data.profile.inPersonEnabled,
        inPersonNote: data.profile.inPersonNote ?? '', shippingFeeYen: String(data.profile.shippingFeeYen ?? 0),
        freeShippingOverYen: data.profile.freeShippingOverYen == null ? '' : String(data.profile.freeShippingOverYen), paymentDays: String(data.profile.paymentDays ?? 7)
      });
    }
    if (data.bank) setBank(data.bank);
    setLoaded(true);
  }, []);
  useEffect(() => { load().catch(() => setError('読み込めませんでした。')); }, [load]);

  const save = async (enabled: boolean) => {
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const { data } = await api.put('/shop/settings', { ...form, enabled, legal, bank: form.bankEnabled ? bank : undefined });
      setMissing(data.missing);
      setMsg(data.enabled ? '保存しました！販売中です 🎉 商品の編集で「AWPで購入できるようにする」をオンにしてね。' : enabled ? 'まだ足りない項目があるため、販売は始まっていません。' : '保存しました（販売は停止中）。');
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || '保存できませんでした。');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <main className="p-6 text-sm text-gray-400">{error || '読み込み中…'}</main>;
  const input = 'mt-1 w-full border rounded-xl px-3 py-2.5 text-base bg-white';

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <Link href="/dashboard" className="text-sm text-violet-700 font-bold">← ホーム</Link>
        <div>
          <h1 className="text-2xl font-black">ショップの設定</h1>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">
            AWPのショップは<span className="font-bold">手数料0円</span>。お客様からの代金は、あなたの口座に直接振り込まれます（AWPは代金を預かりません）。
            ネットで販売するには、法律（特定商取引法）で決められた表記が必要です。
          </p>
        </div>

        <section className={`rounded-2xl p-4 ${form.enabled ? 'bg-green-50 border border-green-200' : 'bg-white border'}`}>
          <p className="font-black">{form.enabled ? '🟢 販売中' : '⚪ 販売していません'}</p>
          {missing.length > 0 && (
            <div className="mt-2 text-xs text-amber-800">
              <p className="font-bold">販売を始めるには、次の項目が必要です</p>
              <ul className="list-disc pl-5 mt-1">{missing.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
        </section>

        <section className="bg-white border rounded-2xl p-4 space-y-3">
          <h2 className="font-black">特定商取引法に基づく表記</h2>
          <p className="text-[11px] text-gray-500">お客様に公開されます（/shop/あなたのページ/legal）。事実どおりに書いてください。</p>
          {fields.map((f) => (
            <label key={f.key} className="block text-sm font-bold">{f.label}
              {f.max > 120 ? (
                <textarea className={input} rows={2} maxLength={f.max} value={legal[f.key] ?? ''} onChange={(e) => setLegal({ ...legal, [f.key]: e.target.value })} />
              ) : (
                <input className={input} maxLength={f.max} value={legal[f.key] ?? ''} onChange={(e) => setLegal({ ...legal, [f.key]: e.target.value })} />
              )}
            </label>
          ))}
          <label className="flex items-start gap-2 text-xs text-gray-600">
            <input type="checkbox" className="mt-0.5" checked={!!legal.disclosureOnRequest} onChange={(e) => setLegal({ ...legal, disclosureOnRequest: e.target.checked })} />
            <span>個人のため、所在地・電話番号は「請求があれば遅滞なく開示」と表示する（この表示が認められる条件は、消費者庁のガイドラインで確認してください）</span>
          </label>
        </section>

        <section className="bg-white border rounded-2xl p-4 space-y-3">
          <h2 className="font-black">お支払い方法</h2>
          <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.bankEnabled} onChange={(e) => setForm({ ...form, bankEnabled: e.target.checked })} />銀行振込（あなたの口座へ直接）</label>
          {form.bankEnabled && (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label>銀行名<input className={input} value={bank.bank} onChange={(e) => setBank({ ...bank, bank: e.target.value })} /></label>
              <label>支店名<input className={input} value={bank.branch} onChange={(e) => setBank({ ...bank, branch: e.target.value })} /></label>
              <label>種別<select className={input} value={bank.type} onChange={(e) => setBank({ ...bank, type: e.target.value })}><option>普通</option><option>当座</option></select></label>
              <label>口座番号<input className={input} inputMode="numeric" value={bank.number} onChange={(e) => setBank({ ...bank, number: e.target.value })} /></label>
              <label className="col-span-2">口座名義（カナ）<input className={input} value={bank.holder} onChange={(e) => setBank({ ...bank, holder: e.target.value })} /></label>
              <label className="col-span-2">振込の期限（注文から何日）<input className={input} type="number" min={1} max={30} value={form.paymentDays} onChange={(e) => setForm({ ...form, paymentDays: e.target.value })} /></label>
              <p className="col-span-2 text-[11px] text-gray-500">口座は暗号化して保存し、注文したお客様の「注文の状況」ページにだけ表示します。</p>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={form.inPersonEnabled} onChange={(e) => setForm({ ...form, inPersonEnabled: e.target.checked })} />店頭・手渡しで支払う</label>
          {form.inPersonEnabled && <input className={input} placeholder="例: ご来店時に現金・PayPayでお支払いください" maxLength={200} value={form.inPersonNote} onChange={(e) => setForm({ ...form, inPersonNote: e.target.value })} />}
        </section>

        <section className="bg-white border rounded-2xl p-4 space-y-3">
          <h2 className="font-black">送料</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label>送料（円）<input className={input} type="number" min={0} value={form.shippingFeeYen} onChange={(e) => setForm({ ...form, shippingFeeYen: e.target.value })} /></label>
            <label>この金額以上で送料無料（任意）<input className={input} type="number" min={0} value={form.freeShippingOverYen} onChange={(e) => setForm({ ...form, freeShippingOverYen: e.target.value })} /></label>
          </div>
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {msg && <p className="text-sm text-green-700 font-bold">{msg}</p>}
        <div className="grid gap-2">
          <button disabled={busy} onClick={() => save(true)} className="rounded-full bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white font-bold py-3.5 disabled:opacity-40">保存して販売する</button>
          <button disabled={busy} onClick={() => save(false)} className="rounded-full border py-3 text-sm">保存（販売は止める）</button>
        </div>
        <p className="text-[11px] text-gray-500">売買の契約はあなたとお客様の間で結ばれます。発送・返品・お問い合わせへの対応はあなたが行います。<Link href="/terms" className="underline">利用規約</Link>もご確認ください。</p>
        <Link href="/orders" className="block text-center text-sm font-bold text-violet-700">注文を見る →</Link>
      </div>
    </main>
  );
}
