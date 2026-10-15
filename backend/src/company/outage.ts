import { aiErrorCategory } from '../lib/aiUsage';

// intelligence（Claude）が使えない状態（残高切れ・キー無効・上限到達）の「遮断器」。
// 10/12〜10/15 の停止で、タスクが30分ごとに再試行して2回で永久失敗になり、4日分の成果が消えた。
// その再発を防ぐ: 停止中はタスクを始めず、停止が原因の失敗は試行回数に数えない
const OUTAGE_CATEGORIES = new Set(['no_credits', 'invalid_key', 'spend_limit_reached', 'key_format', 'workspace_required', 'workspace_id_invalid', 'forbidden']);
const HOLD_MS = 10 * 60_000;

let outage: { reason: string; since: number; until: number } | null = null;

export function isOutageError(e: unknown) {
  return OUTAGE_CATEGORIES.has(aiErrorCategory(e));
}

export function markAiOutage(e: unknown) {
  const reason = aiErrorCategory(e);
  outage = { reason, since: outage?.since ?? Date.now(), until: Date.now() + HOLD_MS };
  return reason;
}

export function clearAiOutage() {
  outage = null;
}

// 停止中か（10分間は新しいタスクを始めない。10分たったら1件だけ試して、成功したら解除）
export function aiOutageActive() {
  if (!outage) return false;
  if (Date.now() > outage.until) return false;
  return true;
}

export function aiOutageInfo() {
  return outage ? { reason: outage.reason, since: new Date(outage.since).toISOString(), until: new Date(outage.until).toISOString() } : null;
}
