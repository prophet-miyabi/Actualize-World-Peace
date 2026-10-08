// クルー用のGitHub操作（REST API。課題・ブランチ・PR・コメント・マージ状態）。
// 実装とレビューは、リポジトリの .github/workflows/claude.yml の Claude Code（Maxプランのトークン）が行う
const API = 'https://api.github.com';

function headers() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_OPS_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'Content-Type': 'application/json'
  };
}
const repo = () => process.env.GITHUB_REPO!;

async function gh(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, { method, headers: headers(), body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export type GhComment = { id: number; body: string; user: { login: string; type: string } | null; created_at: string; updated_at: string };
export const isClaudeBot = (c: GhComment) => !!c.user && c.user.type === 'Bot' && /claude/i.test(c.user.login);

export async function comments(number: number): Promise<GhComment[]> {
  return gh('GET', `/repos/${repo()}/issues/${number}/comments?per_page=100`);
}

export async function comment(number: number, body: string) {
  return gh('POST', `/repos/${repo()}/issues/${number}/comments`, { body });
}

// Claude Code が課題用に作るブランチ（既定: claude/issue-{番号}-{日時}）
export async function findIssueBranch(issueNumber: number): Promise<string | null> {
  const refs: { ref: string }[] = await gh('GET', `/repos/${repo()}/git/matching-refs/heads/claude/issue-${issueNumber}-`);
  if (!refs.length) return null;
  return refs[refs.length - 1].ref.replace(/^refs\/heads\//, '');
}

export async function findOrCreatePr(branch: string, title: string, body: string): Promise<{ number: number; url: string }> {
  const owner = repo().split('/')[0];
  const found: any[] = await gh('GET', `/repos/${repo()}/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`);
  if (found.length) return { number: found[0].number, url: found[0].html_url };
  const pr = await gh('POST', `/repos/${repo()}/pulls`, { title, head: branch, base: 'main', body });
  return { number: pr.number, url: pr.html_url };
}

export async function prState(number: number): Promise<{ merged: boolean; closed: boolean }> {
  const pr = await gh('GET', `/repos/${repo()}/pulls/${number}`);
  return { merged: !!pr.merged, closed: pr.state === 'closed' };
}

// Claude Code の進み具合コメント（作業が終わると「Claude finished」に書き換わる）
export function claudeOutcome(list: GhComment[], since: Date): 'finished' | 'error' | null {
  const recent = list.filter((c) => isClaudeBot(c) && new Date(c.updated_at) >= since);
  if (recent.some((c) => /Claude encountered an error/i.test(c.body))) return 'error';
  if (recent.some((c) => /Claude finished/i.test(c.body))) return 'finished';
  return null;
}

// レビューの判定（レビュー依頼のコメントで「判定: 合格／要確認」を必ず書くよう指示している）
export function reviewVerdict(list: GhComment[], since: Date): { verdict: 'passed' | 'attention'; summary: string } | null {
  const recent = list.filter((c) => isClaudeBot(c) && new Date(c.updated_at) >= since && /Claude finished/i.test(c.body));
  for (const c of recent.reverse()) {
    if (/判定[:：]\s*合格/.test(c.body)) return { verdict: 'passed', summary: c.body };
    if (/判定[:：]\s*要確認/.test(c.body)) return { verdict: 'attention', summary: c.body };
  }
  return recent.length ? { verdict: 'attention', summary: recent[recent.length - 1].body } : null;
}
