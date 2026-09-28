/** @type {import('next').NextConfig} */
const nextConfig = {
  // 画面から /api/... への通信をバックエンドに中継する。
  // 画面とAPIが同じURLになるため、スマホ・独自ドメイン・公開先のどこから開いても動く
  async rewrites() {
    const origin = process.env.API_ORIGIN || 'http://localhost:8000';
    return [{ source: '/api/:path*', destination: `${origin}/api/:path*` }];
  }
};

module.exports = nextConfig;
