import { NextRequest, NextResponse } from 'next/server';

// このサービス自身のホスト名（管理画面やログイン画面を出すドメイン）。
// 「.」で始まる値はそのドメイン配下すべてに一致する（例: .trycloudflare.com）
const MAIN_HOSTS = (process.env.MAIN_HOSTS || 'localhost,127.0.0.1')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// サーバー内部からAPIを呼ぶときの接続先（画面側の /api 中継とは別。相対URLは使えない）
const API = process.env.API_INTERNAL_URL || 'http://localhost:8000/api';

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function isMainHost(host: string) {
  return MAIN_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

// 顧客の独自ドメイン（例: www.example.jp）でアクセスされたら、その顧客のLPを表示する
export async function proxy(req: NextRequest) {
  // /api はどのドメインでもバックエンドへの中継（next.config.js）に任せる。
  // 独自ドメインのLPも自分の /api からデータを読むため、ここでLPに振り替えてはいけない
  if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();

  const host = (req.headers.get('host') || '').split(':')[0].toLowerCase();

  // 自サービスのドメイン、またはIPアドレス直打ち（同じWi-Fi内のスマホからの確認など）はそのまま
  if (!host || isMainHost(host) || IPV4.test(host)) return NextResponse.next();

  try {
    const res = await fetch(`${API}/lp/by-domain/${encodeURIComponent(host)}`, { cache: 'no-store' });
    if (res.ok) {
      const { slug } = await res.json();
      const url = req.nextUrl.clone();
      url.pathname = `/${slug}`;
      return NextResponse.rewrite(url);
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
