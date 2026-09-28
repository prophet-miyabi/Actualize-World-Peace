'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import api from '@/lib/api';

type DomainInfo = {
  hasLp: boolean;
  customDomain: string | null;
  verified: boolean;
  cnameTarget: string | null;
  xserverDomainUrl: string | null;
  xserverUrl: string | null;
};

const OPENED_KEY = 'wls_xserver_opened';

export default function DomainSetup() {
  return (
    <Suspense fallback={<p className="p-8">読み込み中...</p>}>
      <DomainSetupInner />
    </Suspense>
  );
}

function DomainSetupInner() {
  const searchParams = useSearchParams();
  const lpId = searchParams.get('lp') || '';
  const backHref = lpId ? `/dashboard?lp=${encodeURIComponent(lpId)}` : '/dashboard';

  const [info, setInfo] = useState<DomainInfo | null>(null);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [needsPlan, setNeedsPlan] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{ verified: boolean; found: string[] } | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [welcomeBack, setWelcomeBack] = useState(false);
  const [copied, setCopied] = useState('');
  const step2Ref = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get('/lp/domain', { params: lpId ? { lpId } : {} }).then((res) => setInfo(res.data)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpId]);

  useEffect(() => { load(); }, [load]);

  // Xserverのタブから戻ってきたら、次にやること（ドメイン入力）へ誘導する
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      let opened = false;
      try { opened = localStorage.getItem(OPENED_KEY) === '1'; } catch {}
      if (opened && !info?.customDomain) {
        setWelcomeBack(true);
        step2Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        step2Ref.current?.focus();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [info?.customDomain]);

  const markOpened = () => {
    try { localStorage.setItem(OPENED_KEY, '1'); } catch {}
  };

  const verify = useCallback(async () => {
    setChecking(true);
    setVerifyError('');
    try {
      const { data } = await api.post('/lp/domain/verify', lpId ? { lpId } : {});
      setCheckResult({ verified: data.verified, found: data.found });
      if (data.verified) {
        try { localStorage.removeItem(OPENED_KEY); } catch {}
        load();
      }
    } catch (err: any) {
      setVerifyError(err?.response?.data?.error || '確認に失敗しました。');
    } finally {
      setChecking(false);
    }
  }, [load]);

  // DNSの反映待ちの間は、画面を開いている限り30秒ごとに自動で再確認する（最大10分）
  useEffect(() => {
    if (!info?.customDomain || info.verified || !checkResult || checkResult.verified) return;
    let count = 0;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (++count > 20) { clearInterval(timer); return; }
      verify();
    }, 30000);
    return () => clearInterval(timer);
  }, [info?.customDomain, info?.verified, checkResult, verify]);

  const save = async () => {
    setError('');
    setNeedsPlan(false);
    if (!input.trim()) { setError('取得したドメインを入力してください。'); return; }
    setSaving(true);
    try {
      await api.put('/lp/domain', lpId ? { domain: input, lpId } : { domain: input });
      setWelcomeBack(false);
      setCheckResult(null);
      setInput('');
      load();
    } catch (err: any) {
      if (err?.response?.status === 402) setNeedsPlan(true);
      setError(err?.response?.data?.error || '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch {}
  };

  if (!info) return <p className="p-8">読み込み中...</p>;

  if (!info.hasLp) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="mb-4">独自ドメインを設定する前に、LPを作成してください。</p>
        <Link href="/wizard" className="text-blue-600 underline">LPを作成する</Link>
      </div>
    );
  }

  const ready = !!info.customDomain;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link href={backHref} className="text-sm text-gray-500">← ダッシュボードへ戻る</Link>
        <h1 className="text-2xl font-bold mt-2 mb-1">独自ドメインの設定</h1>
        <p className="text-gray-500 text-sm mb-6">3つのステップで、あなたのLPを自分のドメイン（例: www.example.jp）で公開できます。</p>

        {info.verified && info.customDomain && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-6">
            <p className="font-bold text-green-700">接続が完了しました 🎉</p>
            <p className="text-sm text-green-700 mt-1">
              <a href={`https://${info.customDomain}`} target="_blank" rel="noopener noreferrer" className="underline">
                https://{info.customDomain}
              </a>{' '}でLPが表示されます。
            </p>
          </div>
        )}

        {welcomeBack && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-800">
            おかえりなさい。ドメインを取得できたら、下のステップ2に入力してください。
          </div>
        )}

        {/* ステップ1: ドメインを用意（アプリの外に出るのはここだけ） */}
        <section className="bg-white border rounded-xl p-6 mb-4">
          <h2 className="font-bold mb-2">ステップ1　ドメインを用意する</h2>
          {info.xserverDomainUrl ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                まだドメインをお持ちでない方は、XServerドメインで取得できます。新しいタブで開くので、このページは閉じずにそのままお待ちください。
              </p>
              <a href={info.xserverDomainUrl} target="_blank" rel="noopener sponsored" onClick={markOpened}
                className="block text-center bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700">
                XServerドメインでドメインを取得する
              </a>
              {info.xserverUrl && (
                <p className="text-sm text-gray-600 mt-3">
                  ホームページ（WordPress等）もご自身で運営したい方は{' '}
                  <a href={info.xserverUrl} target="_blank" rel="noopener sponsored" onClick={markOpened}
                    className="text-blue-600 underline">エックスサーバー</a>{' '}もご検討ください。
                </p>
              )}
              <p className="text-xs text-gray-400 mt-3">
                <span className="border border-gray-300 px-1 rounded mr-1">PR</span>
                このリンクは広告を含みます。ご契約いただくと当社に紹介料が支払われる場合があります。
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-600">お持ちのドメインをステップ2に入力してください。</p>
          )}
          <p className="text-sm text-gray-500 mt-3">すでにドメインをお持ちの方は、そのままステップ2へ進んでください。</p>
        </section>

        {/* ステップ2: ドメインを入力（アプリ内） */}
        <section className="bg-white border rounded-xl p-6 mb-4">
          <h2 className="font-bold mb-2">ステップ2　取得したドメインを入力する</h2>
          {info.customDomain && (
            <p className="text-sm mb-3">登録済み: <span className="font-bold">{info.customDomain}</span></p>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <input ref={step2Ref} type="text" inputMode="url" autoCapitalize="none" autoCorrect="off"
              placeholder="example.jp" value={input} onChange={(e) => { setInput(e.target.value); setError(''); }}
              className="flex-1 p-3 border rounded-lg" />
            <button onClick={save} disabled={saving}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold disabled:opacity-50 whitespace-nowrap">
              {saving ? '保存中...' : info.customDomain ? '変更する' : '登録する'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">LPは「www.」を付けたアドレスで公開されます（例: example.jp → www.example.jp）。</p>
          {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
          {needsPlan && <Link href="/billing" className="text-blue-600 underline text-sm">有料プランに加入する</Link>}
        </section>

        {/* ステップ3: DNS設定の値を表示し、接続確認はアプリ内で行う */}
        <section className={`bg-white border rounded-xl p-6 ${ready ? '' : 'opacity-50'}`}>
          <h2 className="font-bold mb-2">ステップ3　DNSを設定して接続を確認する</h2>
          {!ready ? (
            <p className="text-sm text-gray-500">ステップ2でドメインを登録すると表示されます。</p>
          ) : !info.cnameTarget ? (
            <p className="text-sm text-gray-500">接続先の準備中です。しばらくお待ちください。</p>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-3">
                ドメインを取得したサービス（XServerドメイン等）の管理画面の「DNS設定」で、次の1件を追加してください。
              </p>
              <div className="border rounded-lg divide-y text-sm mb-4">
                {[
                  { label: '種別', value: 'CNAME', key: 'type' },
                  { label: 'ホスト名', value: 'www', key: 'host' },
                  { label: '内容（値）', value: info.cnameTarget, key: 'value' }
                ].map((row) => (
                  <div key={row.key} className="flex items-center justify-between p-3 gap-3">
                    <span className="text-gray-500 w-24 shrink-0">{row.label}</span>
                    <span className="font-mono font-bold flex-1 break-all">{row.value}</span>
                    <button onClick={() => copy(row.value, row.key)} className="text-blue-600 text-xs whitespace-nowrap">
                      {copied === row.key ? 'コピーしました' : 'コピー'}
                    </button>
                  </div>
                ))}
              </div>
              <button onClick={verify} disabled={checking}
                className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold disabled:opacity-50">
                {checking ? '確認中...' : '設定しました — 接続を確認する'}
              </button>
              {verifyError && <p className="text-red-600 text-sm mt-3">{verifyError}</p>}
              {checkResult && !checkResult.verified && (
                <p className="text-sm text-yellow-700 mt-3">
                  まだ確認できません。DNSの反映には数分〜数時間かかることがあります。
                  このページを開いている間は、30秒ごとに自動で再確認します。
                  {checkResult.found.length > 0 && <> 現在の設定値: {checkResult.found.join(', ')}</>}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
