/** @type {import('next').NextConfig} */
const nextConfig = {
  // 画面から /api/... への通信をバックエンドに中継する。
  // 画面とAPIが同じURLになるため、スマホ・独自ドメイン・公開先のどこから開いても動く
  async rewrites() {
    const origin = process.env.API_ORIGIN || 'http://localhost:8000';
    // ブラウザが自動で取りに来る /favicon.ico を、app/icon.tsx が生成するアイコンへ（404 を出さない）
    return [{ source: '/api/:path*', destination: `${origin}/api/:path*` }, { source: '/favicon.ico', destination: '/icon/32' }];
  }
};

module.exports = nextConfig;
