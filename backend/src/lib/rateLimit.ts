// 1台構成向けの簡易な回数制限（プロセスのメモリに保持。再起動でリセットされる）。
// SMS送信のように1回ごとに費用が発生し、悪用されると被害が大きい操作に使う
const buckets = new Map<string, number[]>();

export function hitRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return true;
  }
  recent.push(now);
  buckets.set(key, recent);
  return false;
}
