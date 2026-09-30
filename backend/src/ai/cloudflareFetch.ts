// Cloudflare Workers AIへの呼び出し（テキスト生成・画像生成の両方）で共通して使う、
// 一時的なネットワーク断（DNS/TLS/接続リセット等でfetch自体が例外を投げるケース。
// HTTPエラー応答ではないため通常のステータスコード判定では拾えない）に対するリトライ。
// 実運用でこの種の一時的な失敗が観測されたため導入した（指数バックオフで最大3回まで）。
export async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastError;
}
