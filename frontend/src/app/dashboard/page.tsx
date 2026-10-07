'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/lib/api';

type PageSummary = { id: string; slug: string; businessName: string; siteType: string; pageViews: number; hidden?: boolean };

export default function Dashboard() {
  return (
    <Suspense fallback={<p>読み込み中...</p>}>
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lpId = searchParams.get('lp') || '';

  const [pages, setPages] = useState<PageSummary[] | null>(null);
  const [data, setData] = useState<any>(null);
  const [domain, setDomain] = useState<{ customDomain: string | null; verified: boolean } | null>(null);
  const [subStatus, setSubStatus] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [design, setDesign] = useState<{ status: string; source: string | null; hasImage: boolean } | null>(null);
  const [designError, setDesignError] = useState('');
  const [checkout, setCheckout] = useState<'confirming' | 'timeout' | null>(null);
  const [hasLineConfig, setHasLineConfig] = useState(true);
  const [lineForm, setLineForm] = useState({ channelId: '', channelSecret: '', channelAccessToken: '' });
  const [lineSaving, setLineSaving] = useState(false);
  const [lineError, setLineError] = useState('');
  const [lineSaved, setLineSaved] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [notifyResult, setNotifyResult] = useState('');
  const [lineUrl, setLineUrl] = useState('');
  const [lineUrlSaving, setLineUrlSaving] = useState(false);
  const [lineUrlMsg, setLineUrlMsg] = useState('');
  const [shareMsg, setShareMsg] = useState('');
  const justCreated = searchParams.get('created') === '1';

  const withLp = (params: Record<string, string> = {}) => (lpId ? { ...params, lpId } : params);

  // Stripeの決済から戻ってきた直後は、加入の反映（Webhook）を数秒待つ
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('checkout') !== 'success') return;
    setCheckout('confirming');
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const { data: s } = await api.get('/billing/status');
        if (s.subscriptionStatus === 'active') {
          clearInterval(timer);
          setSubStatus('active');
          setCheckout(null);
          return;
        }
      } catch {}
      if (tries >= 15) {
        clearInterval(timer);
        setCheckout('timeout');
      }
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // アカウントが持つページの一覧（店舗・事業ごとに複数持てる）
  useEffect(() => {
    api.get('/lp/list').then((res) => setPages(res.data.pages)).catch(() => setPages([]));
    api.get('/billing/status').then((res) => setSubStatus(res.data.subscriptionStatus)).catch(() => {});
    api.get('/auth/me').then((res) => setIsAdmin(!!res.data.isAdmin)).catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/lp/dashboard/stats', { params: withLp() }).then((res) => {
      setData(res.data);
      setHasLineConfig(!!res.data.hasLineConfig);
      setLineUrl(res.data.lp?.lineAddUrl || '');
    }).catch(() => {});
    api.get('/lp/domain', { params: withLp() }).then((res) => setDomain(res.data)).catch(() => {});
    api.get('/lp/design', { params: withLp() }).then((res) => setDesign(res.data)).catch(() => {});
    setLineSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lpId]);

  const switchPage = (id: string) => {
    const params = new URLSearchParams(window.location.search);
    if (id) params.set('lp', id); else params.delete('lp');
    router.push(`/dashboard?${params.toString()}`);
  };

  const saveLineUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setLineUrlSaving(true);
    setLineUrlMsg('');
    try {
      const { data: res } = await api.put('/lp/contact', { ...withLp(), lineAddUrl: lineUrl.trim() });
      setLineUrl(res.lineAddUrl || '');
      setLineUrlMsg(res.lineAddUrl ? '保存しました！ページにLINEボタンが出ています。' : 'LINEボタンを外しました。');
    } catch (err: any) {
      setLineUrlMsg(err?.response?.data?.error || '保存できませんでした。');
    } finally {
      setLineUrlSaving(false);
    }
  };

  // 公開したページをすぐ広められるよう、スマホの共有メニュー（LINE・SNSなど）を開く。非対応ならURLをコピー
  const sharePage = async (slug: string, name: string) => {
    const url = `${window.location.origin}/${slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareMsg('URLをコピーしました！');
    } catch {
      // 共有をキャンセルした場合は何もしない
    }
  };

  const saveLine = async (e: React.FormEvent) => {
    e.preventDefault();
    setLineSaving(true);
    setLineError('');
    try {
      const { data: res } = await api.put('/lp/line', lineForm);
      setHasLineConfig(true);
      setLineSaved(true);
      if (res.webhook && res.webhook.ok === false) {
        setLineError(res.webhook.reason || '設定の確認に失敗しました。');
      }
    } catch (err: any) {
      setLineError(err?.response?.data?.error || '保存に失敗しました。');
    } finally {
      setLineSaving(false);
    }
  };

  // デザイン作成中は数秒ごとに状況を確認し、完成したら表示を更新する
  useEffect(() => {
    if (design?.status !== 'generating') return;
    const timer = setInterval(() => {
      api.get('/lp/design', { params: withLp() }).then((res) => setDesign(res.data)).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design?.status]);

  const regenerateDesign = async () => {
    setDesignError('');
    try {
      await api.post('/lp/design', withLp());
      setDesign((d) => (d ? { ...d, status: 'generating' } : { status: 'generating', source: null, hasImage: false }));
    } catch (err: any) {
      setDesignError(err?.response?.data?.error || '開始できませんでした。');
    }
  };

  const notifySearchEngines = async () => {
    setNotifying(true);
    setNotifyResult('');
    try {
      await api.post('/lp/notify-search-engines', withLp());
      setNotifyResult('検索エンジンに送信しました。');
    } catch (err: any) {
      setNotifyResult(err?.response?.data?.error || '送信に失敗しました。');
    } finally {
      setNotifying(false);
    }
  };

  const isActive = subStatus === 'active';
  const qs = lpId ? `?lp=${encodeURIComponent(lpId)}` : '';

  const [exporting, setExporting] = useState(false);
  // AWPに依存せず運営を続けられるよう、自分のデータをいつでも持ち出せるようにする
  const exportData = async () => {
    setExporting(true);
    try {
      const { data: body } = await api.get('/export', { responseType: 'blob' });
      const href = URL.createObjectURL(body);
      const a = document.createElement('a');
      a.href = href;
      a.download = `awp-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(href);
    } finally {
      setExporting(false);
    }
  };

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const { data } = await api.get('/billing/portal');
      window.location.href = data.url;
    } catch {
      setPortalLoading(false);
    }
  };

  if (!data || !pages) return <p>読み込み中...</p>;

  return (
    <div>
      {checkout === 'confirming' && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-4 mb-6 text-sm">
          お申し込みありがとうございます。お支払いを確認しています…（数秒で完了します）
        </div>
      )}
      {checkout === 'timeout' && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-xl p-4 mb-6 text-sm">
          お支払いの確認に時間がかかっています。しばらくしてからこの画面を再読み込みしてください。
        </div>
      )}

      {/* 店舗・事業が複数ある場合の切り替え（フランチャイズ・複数拠点・複数事業向け） */}
      {pages.length > 0 && (
        <div className="flex items-center gap-2 mb-6 flex-wrap">
          {pages.map((p) => {
            const active = data.lp ? p.id === data.lp.id : !lpId && p === pages[0];
            return (
              <button key={p.id} onClick={() => switchPage(p.id)}
                className={`text-sm font-bold px-4 py-2 rounded-full border ${active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}>
                {p.businessName || p.slug}
              </button>
            );
          })}
          <Link href="/wizard" className="text-sm font-bold px-4 py-2 rounded-full border border-dashed border-gray-400 text-gray-600 hover:border-blue-500 hover:text-blue-600">
            ＋ 新しいページを追加
          </Link>
        </div>
      )}

      {/* 対話で作るページビルダー */}
      <Link href="/builder" className="mb-3 flex items-center gap-3 rounded-2xl bg-white border-2 border-violet-200 p-4">
        <span className="text-2xl" aria-hidden>💬</span>
        <span className="min-w-0">
          <span className="block font-bold text-sm">AIとおしゃべりしてページをつくる</span>
          <span className="block text-[11px] text-gray-500">質問に答えるだけ。確定した情報だけがページに載るよ</span>
        </span>
      </Link>

      {/* SNSの入口: プロフィール（/ユーザー名）と、みんなのページを探す「発見」 */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Link href="/profile" className="rounded-2xl bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 text-white p-4">
          <span className="block text-lg" aria-hidden>🪪</span>
          <span className="block font-bold text-sm mt-1">プロフィール</span>
          <span className="block text-[11px] opacity-90">あなたの名刺ページをつくる</span>
        </Link>
        <Link href="/discover" className="rounded-2xl bg-white border border-gray-200 p-4">
          <span className="block text-lg" aria-hidden>✨</span>
          <span className="block font-bold text-sm mt-1">発見</span>
          <span className="block text-[11px] text-gray-500">みんなのページを見る</span>
        </Link>
        <Link href="/wallet" className="col-span-2 rounded-2xl bg-white border border-gray-200 p-4 flex items-center gap-3">
          <span className="text-lg" aria-hidden>💰</span>
          <span className="min-w-0">
            <span className="block font-bold text-sm">キャッシュと収益化</span>
            <span className="block text-[11px] text-gray-500">ページにPR枠を出して、報酬の78%を受け取る</span>
          </span>
        </Link>
      </div>

      <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
        <h2 className="text-2xl font-black">あなたのページ</h2>
        {!data.lp && (
          <Link href="/wizard" className="bg-gradient-to-r from-fuchsia-500 to-violet-600 text-white px-5 py-2.5 rounded-full font-bold">
            ページをつくる
          </Link>
        )}
      </div>

      <div className="mb-8">
        {data.lp ? (
          <div className="flex items-center gap-3 text-sm flex-wrap">
            {pages.find((p) => p.id === data.lp.id)?.hidden ? (
              <span className="inline-block bg-red-100 text-red-700 px-3 py-1 rounded-full font-bold">運営により非公開中（利用規約に関する確認のため）</span>
            ) : (
              <span className="inline-block bg-green-100 text-green-700 px-3 py-1 rounded-full font-bold">公開中（無料）</span>
            )}
            <Link href={`/tools${qs}`} className="text-blue-600 underline">提携ツールを追加</Link>
            <Link href="/harness" className="text-blue-600 underline">LINE・X・Instagramを自動化</Link>
            <Link href={`/analytics${qs}`} className="text-blue-600 underline">アクセス解析</Link>
            <Link href={`/bookings${qs}`} className="text-blue-600 underline">予約リクエスト</Link>
            <Link href={`/products${qs}`} className="text-blue-600 underline">商品</Link>
            <Link href={`/analytics${qs}#chatbot`} className="text-blue-600 underline">AIチャットボット</Link>
            <Link href="/feed" className="text-blue-600 underline">投稿する</Link>
            <Link href={`/growth${qs}`} className="text-blue-600 underline">A/Bテスト</Link>
            <Link href={`/photos${qs}`} className="text-blue-600 underline">写真・ロゴ</Link>
            {isActive && (
              <>
                <Link href="/social" className="text-blue-600 underline">SNS連携・予約投稿</Link>
                <Link href="/agents" className="text-blue-600 underline">AIエージェント</Link>
                <Link href="/automation" className="text-blue-600 underline">ブラウザ操作の自動化</Link>
                <button onClick={openPortal} disabled={portalLoading} className="text-blue-600 underline">
                  {portalLoading ? '読み込み中...' : '支払い方法・解約の管理'}
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl text-yellow-700 text-sm">
            まだページがありません。さっそくつくってみよう！公開まで無料です。
          </div>
        )}
        {isAdmin && <Link href="/admin" className="text-violet-700 font-bold underline text-sm block mt-2">運営者画面（ダッシュボード・AIオペレーター） →</Link>}
        {isAdmin && <Link href="/admin/assets" className="text-blue-600 underline text-sm block mt-1">サイトの外装画像を管理 →</Link>}
        {isAdmin && <Link href="/admin/monitoring" className="text-blue-600 underline text-sm block mt-1">システム監視 →</Link>}
        {isAdmin && <Link href="/admin/tools" className="text-blue-600 underline text-sm block mt-1">提携ツールのカタログ管理 →</Link>}
        {isAdmin && <Link href="/admin/harness" className="text-blue-600 underline text-sm block mt-1">Harness導入支援の管理（料金・申し込み） →</Link>}
      </div>

      {data.lp && justCreated && (
        <div className="rounded-3xl p-6 mb-8 text-white bg-gradient-to-br from-fuchsia-500 via-violet-500 to-sky-500 shadow-lg">
          <p className="text-2xl font-black mb-1">公開しました！</p>
          <p className="text-sm opacity-90 mb-4">デザインはAIが仕上げ中です。まずはURLをシェアして、見てもらおう。</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={() => sharePage(data.lp.slug, data.lp.businessName)} className="bg-white text-violet-700 font-bold rounded-full px-6 py-3">
              ページをシェアする
            </button>
            <a href={`/${data.lp.slug}`} target="_blank" className="text-center border border-white/70 font-bold rounded-full px-6 py-3">ページを見る</a>
          </div>
          {shareMsg && <p className="text-sm mt-3">{shareMsg}</p>}
        </div>
      )}

      {data.lp ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <p className="text-gray-500 text-sm">このページのアクセス数</p>
            <p className="text-4xl font-bold mt-2">{data.lp.pageViews}</p>
          </div>
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <p className="text-gray-500 text-sm">公開URL</p>
            <a href={`/${data.lp.slug}`} target="_blank" className="text-blue-600 font-bold mt-2 block underline break-all">
              /{data.lp.slug}
            </a>
          </div>
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <p className="text-gray-500 text-sm">データの書き出し</p>
            <p className="text-xs text-gray-500 mt-1">ページ内容・写真・お問い合わせ履歴をファイルで保存できます。</p>
            <button onClick={exportData} disabled={exporting} className="text-blue-600 font-bold mt-2 underline disabled:text-gray-400">
              {exporting ? '書き出し中...' : '書き出す →'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-yellow-50 border border-yellow-200 p-6 rounded-xl mb-8">
          <p className="text-yellow-700">まだLPが作成されていません。ウィザードから作成してください。</p>
        </div>
      )}

      {data.lp && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <p className="text-gray-500 text-sm">デザイン</p>
            {design?.status === 'generating' ? (
              <p className="font-bold mt-1 text-blue-700">Meydaがクライアントの要望にそって作成中です…</p>
            ) : (
              <p className="font-bold mt-1">
                {design?.source === 'ai' ? 'AIが作成したデザイン' : '業種に合わせたデザイン'}
                {design?.hasImage ? '（メイン画像あり）' : ''}
              </p>
            )}
            {designError && <p className="text-red-600 text-sm mt-2">{designError}</p>}
            <button type="button" onClick={regenerateDesign} disabled={design?.status === 'generating'}
              className="mt-4 text-sm font-bold text-blue-600 disabled:text-gray-400">
              AIでデザインを作り直す →
            </button>
          </div>
          <Link href={`/features${qs}`} className="block bg-white rounded-xl border shadow-sm p-6 hover:border-blue-400 transition">
            <p className="text-gray-500 text-sm">機能</p>
            <p className="font-bold mt-1">
              {data.lp.sections?.length ? `${data.lp.sections.length}個の機能を追加済み` : 'メニュー・よくある質問・アクセスなどを追加できます'}
            </p>
            <span className="inline-block mt-4 text-sm font-bold text-blue-600">機能を追加する →</span>
          </Link>
        </div>
      )}

      {data.lp && (
        <Link href={`/domain${qs}`} className="block bg-white rounded-xl border shadow-sm p-6 mb-8 hover:border-blue-400 transition">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-gray-500 text-sm">独自ドメイン</p>
              {domain?.customDomain ? (
                <p className="font-bold mt-1">
                  {domain.customDomain}{' '}
                  <span className={domain.verified ? 'text-green-600' : 'text-yellow-600'}>
                    {domain.verified ? '（接続済み）' : '（接続待ち）'}
                  </span>
                </p>
              ) : (
                <p className="font-bold mt-1">未設定 — 自分のドメインでLPを公開できます</p>
              )}
            </div>
            <span className="text-blue-600 font-bold whitespace-nowrap">設定する →</span>
          </div>
        </Link>
      )}

      {data.lp && (
        <div className="bg-white rounded-xl border shadow-sm p-6 mb-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-gray-500 text-sm">検索エンジンへの通知</p>
              <p className="font-bold mt-1">Bing・Yandex等に、ページの公開・更新を通知します（IndexNow）</p>
              {notifyResult && <p className="text-xs text-gray-500 mt-1">{notifyResult}</p>}
            </div>
            <button onClick={notifySearchEngines} disabled={notifying}
              className="shrink-0 text-blue-600 font-bold whitespace-nowrap disabled:text-gray-400">
              {notifying ? '送信中...' : '今すぐ送信する →'}
            </button>
          </div>
        </div>
      )}

      {data.lp && lineSaved && (
        <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-4 mb-8 text-sm">
          LINE連携情報を保存しました。{isActive ? '' : '有料プランへの加入後、自動的に連携が有効になります。'}
          {lineError && <span className="block text-red-600 mt-1">{lineError}</span>}
        </div>
      )}

      {data.lp && (
        <form onSubmit={saveLineUrl} className="bg-white rounded-xl border shadow-sm p-6 mb-8">
          <p className="text-gray-500 text-sm mb-1">LINEボタン</p>
          <p className="font-bold mb-3">{lineUrl ? 'ページにLINEボタンを表示中' : 'LINE公式アカウントの友だち追加URLを登録すると、ページにLINEボタンが出ます'}</p>
          <input type="url" inputMode="url" autoCapitalize="none" placeholder="https://lin.ee/..." value={lineUrl}
            onChange={(e) => setLineUrl(e.target.value)} className="w-full p-3 border rounded-lg text-base mb-3" />
          <button disabled={lineUrlSaving} className="bg-gray-900 text-white px-6 py-3 rounded-full font-bold disabled:opacity-50">
            {lineUrlSaving ? '保存中…' : '保存する'}
          </button>
          <p className="text-xs text-gray-500 mt-2">
            LINE公式アカウントは
            <a href="https://www.linebiz.com/jp/entry/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline mx-1">こちら</a>
            から無料で作れます。友だち追加URLは、LINE公式アカウントの管理画面で確認できます。空にして保存するとボタンを外せます。
          </p>
          {lineUrlMsg && <p className="text-sm mt-2">{lineUrlMsg}</p>}
        </form>
      )}

      {/* LINE自動応答（Messaging API）の設定。AIの利用料がかかる上位機能のため、有料プラン加入者のみ */}
      {data.lp && !hasLineConfig && isActive && (
        <div className="bg-white rounded-xl border shadow-sm p-6 mb-8">
          <p className="text-gray-500 text-sm mb-1">LINE自動応答</p>
          <p className="font-bold mb-3">まだ連携されていません</p>
          {pages.length > 1 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
              LINE連携は現在アカウント単位です。複数ページをお持ちの場合、自動応答は最初に作成したページの内容を元に返信します（ページごとの個別連携は今後対応予定です）。
            </p>
          )}
          <p className="text-sm text-gray-600 mb-4">
            LINE公式アカウントをお持ちでない場合は、
            <a href="https://www.linebiz.com/jp/entry/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline mx-1">
              LINE公式アカウントの開設ページ
            </a>
            から無料で作成できます。作成後、
            <a href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline mx-1">
              LINE Developersコンソール
            </a>
            でMessaging APIのチャンネル情報を発行し、下のフォームに入力してください。
          </p>
          <form onSubmit={saveLine} className="space-y-3">
            <input type="text" placeholder="Channel ID" className="w-full p-3 border rounded-lg"
              value={lineForm.channelId} onChange={e => setLineForm({ ...lineForm, channelId: e.target.value })} required />
            <input type="text" placeholder="Channel Secret" className="w-full p-3 border rounded-lg"
              value={lineForm.channelSecret} onChange={e => setLineForm({ ...lineForm, channelSecret: e.target.value })} required />
            <input type="text" placeholder="Channel Access Token" className="w-full p-3 border rounded-lg"
              value={lineForm.channelAccessToken} onChange={e => setLineForm({ ...lineForm, channelAccessToken: e.target.value })} required />
            {!lineSaved && lineError && <p className="text-red-600 text-sm">{lineError}</p>}
            <button type="submit" disabled={lineSaving} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold disabled:opacity-50">
              {lineSaving ? '保存しています...' : 'LINE連携情報を保存する'}
            </button>
          </form>
        </div>
      )}

      {hasLineConfig && (<>
      <h3 className="text-xl font-bold mb-4">LINE お問い合わせ履歴{pages.length > 1 ? '（アカウント共通）' : ''}</h3>
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {data.inquiries.length > 0 ? (
          <ul className="divide-y">
            {data.inquiries.map((inq: any) => (
              <li key={inq.id} className="p-4">
                <span className="text-sm text-gray-500 block">{new Date(inq.createdAt).toLocaleString()}</span>
                <p className="font-bold">{inq.message}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-6 text-gray-500">まだお問い合わせはありません。</p>
        )}
      </div>
      </>)}
    </div>
  );
}
