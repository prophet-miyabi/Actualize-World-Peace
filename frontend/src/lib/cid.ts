// Harness のクロスUUID: 公式LINE・SNS の返信に付いたリンク（?awp_cid=）から来た人を、
// 同じ公開ページでの来訪・予約・注文に結びつけるための ID。訪問者を新たに特定する情報は集めない。
const KEY = 'awp_cid';
const RE = /^[0-9a-f-]{36}$/;

export function captureCid(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URL(window.location.href).searchParams.get(KEY);
    if (q && RE.test(q)) {
      try { sessionStorage.setItem(KEY, q); } catch { /* 保存できなくても ID は返す */ }
      return q;
    }
    const s = sessionStorage.getItem(KEY);
    return s && RE.test(s) ? s : null;
  } catch {
    return null;
  }
}
