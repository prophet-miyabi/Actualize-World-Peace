// Cloudflare Workers AI のテキスト生成。
// SNS投稿の下書きのように「高頻度・複数プラットフォーム分」を繰り返し生成する用途では、
// 従量課金のClaudeよりもこちらを使うことで、無料枠（1日10,000 Neurons）の中で運用できる。
// 日本語の品質を優先し、多言語対応が明記されているQwen3を使う
// （Llama 3.1 8Bは公式サポート言語に日本語が含まれず、出力が崩れたため不採用）。
export async function generateText(system: string, user: string): Promise<string> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new Error('CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN が未設定です');

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/qwen/qwen3-30b-a3b-fp8`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user.slice(0, 4000) }
        ]
      })
    }
  );
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.success || typeof body?.result?.response !== 'string') {
    throw new Error(`Workers AI text generation failed: ${JSON.stringify(body?.errors || res.statusText)}`);
  }
  return body.result.response as string;
}
