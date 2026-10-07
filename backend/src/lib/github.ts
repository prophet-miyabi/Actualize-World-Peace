// 運営者が承認したコード変更を、GitHubの課題（Issue）として登録する。
// ラベル claude が付いた課題は、リポジトリの GitHub Actions（.github/workflows/claude.yml）で
// Claude Code が隔離環境で実装し、プルリクエストを作る。本番への反映は運営者のマージ後のみ。
// トークンは対象リポジトリだけに限定した fine-grained token（Issues: Read and write）を使う
const API = 'https://api.github.com';
export const CLAUDE_LABEL = 'claude';

export function githubConfigured(): boolean {
  return !!(process.env.GITHUB_OPS_TOKEN && process.env.GITHUB_REPO);
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_OPS_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'Content-Type': 'application/json'
  };
}

async function ensureLabel(repo: string) {
  const res = await fetch(`${API}/repos/${repo}/labels`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name: CLAUDE_LABEL, color: '8b5cf6', description: 'AWPの運営者が承認した、Claude Codeによる実装依頼' })
  });
  // 422 = 既に存在する
  if (!res.ok && res.status !== 422) throw new Error(`ラベルを作成できませんでした（${res.status}）`);
}

export async function createClaudeIssue(title: string, body: string): Promise<{ number: number; url: string }> {
  const repo = process.env.GITHUB_REPO!;
  await ensureLabel(repo);
  const res = await fetch(`${API}/repos/${repo}/issues`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ title, body, labels: [CLAUDE_LABEL] })
  });
  if (res.status !== 201) throw new Error(`GitHubに課題を作成できませんでした（${res.status}）: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}
