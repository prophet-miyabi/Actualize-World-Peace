import { NextRequest, NextResponse } from 'next/server';

// このサービス自身のホスト名（管理画面やログイン画面を出すドメイン）。
// 「.」で始まる値はそのドメイン配下すべてに一致する（例: .trycloudflare.com）
const MAIN_HOSTS = (process.env.MAIN_HOSTS || 'localhost,127.0.0.1')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// AWP自身が所有するドメイン（例: "awp.jp"）。設定すると、{slug}.{MAIN_DOMAIN} で
// そのLPに直接アクセスできるようになる（ワイルドカードDNS + Renderのワイルドカード証明書が前提。
// 未設定の間はこの機能自体が無効になるだけで、既存の /slug 形式のアクセスには影響しない）
const MAIN_DOMAIN = (process.env.MAIN_DOMAIN || '').toLowerCase().replace(/^\.+/, '');

// サーバー内部からAPIを呼ぶときの接続先（画面側の /api 中継とは別。相対URLは使えない）
const API = process.env.API_INTERNAL_URL || 'http://localhost:8000/api';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
// LP作成時（backend/src/routes/lp.ts）のslugバリデーションと同じ規則。
// a-z・0-9・ハイフンのみを許可することで、Unicode homograph攻撃や不正な文字を構造的に排除する
const SLUG_RE = /^[a-z0-9-]{3,40}$/;

function isMainHost(host: string) {
  return MAIN_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

// Hostヘッダーが自社ドメインの直下1段のサブドメイン（例: miyabi.awp.jp）であれば、
// そのslugを返す。2段以上（foo.bar.awp.jp）や、予約語・不正な文字を含むものはnullにする
// （Hostヘッダーは外部から自由に送られてくる値のため、ここで検証せずslugとして信頼してはいけない）
function ownSubdomainSlug(host: string): string | null {
  if (!MAIN_DOMAIN) return null;
  const suffix = `.${MAIN_DOMAIN}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.') || !SLUG_RE.test(label)) return null;
  return label;
}

function rewriteToSlug(req: NextRequest, slug: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = url.pathname === '/' ? `/${slug}` : `/${slug}${url.pathname}`;
  return NextResponse.rewrite(url);
}

// 顧客の独自ドメイン（例: www.example.jp）、または自社ドメインのサブドメイン（例: miyabi.awp.jp）で
// アクセスされたら、その顧客のLPを表示する
export async function proxy(req: NextRequest) {
  // /api はどのドメインでもバックエンドへの中継（next.config.js）に任せる。
  // 独自ドメインのLPも自分の /api からデータを読むため、ここでLPに振り替えてはいけない
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();

  const host = (req.headers.get('host') || '').split(':')[0].toLowerCase();

  // 自サービスのドメイン、またはIPアドレス直打ち（同じWi-Fi内のスマホからの確認など）はそのまま
  if (!host || isMainHost(host) || IPV4.test(host)) return NextResponse.next();

  // 自社ドメインのサブドメインはDB照会なしでslugとして扱う（存在確認・公開判定は
  // [slug]/page.tsx 側の通常のfetchLp()に任せる。実在しないslugは今まで通り404になる）
  const ownSlug = ownSubdomainSlug(host);
  if (ownSlug) return rewriteToSlug(req, ownSlug);

  try {
    const res = await fetch(`${API}/lp/by-domain/${encodeURIComponent(host)}`, { cache: 'no-store' });
    if (res.ok) {
      const { slug } = await res.json();
      return rewriteToSlug(req, slug);
    }
  } catch {
    // APIに届かない場合は下の404へ
  }
  // 未登録・未接続のドメインで管理画面が表示されないようにする
  return new NextResponse('Not found', { status: 404 });
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico).*)']
};
