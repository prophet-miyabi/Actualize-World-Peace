import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';

// Anthropic クライアントはここから作る。
// ANTHROPIC_WORKSPACE_ID が設定されていれば、全リクエストに anthropic-workspace-id ヘッダーを付ける
// （ワークスペースに紐づいていないAPIキーは、このヘッダーがないと 400 で拒否されるため）
export function createAnthropic(options: ClientOptions = {}) {
  const ws = (process.env.ANTHROPIC_WORKSPACE_ID || '').trim();
  return new Anthropic({
    ...options,
    defaultHeaders: { ...(ws ? { 'anthropic-workspace-id': ws } : {}), ...(options.defaultHeaders ?? {}) }
  });
}
