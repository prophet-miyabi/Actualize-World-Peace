import prisma from '../prisma';
import { hitRateLimit } from './rateLimit';

// 監視担当エージェント（backend/src/agents/monitoring.ts）が後で原因分析できるよう、
// 想定外のエラーを記録する。記録自体が失敗してもアプリの処理は止めない。
export async function captureError(source: string, err: unknown, context?: Record<string, unknown>) {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? null) : null;
    await prisma.systemError.create({ data: { source, message, stack, context: context as any } });
    // Discord の #🚨-アラート にも知らせる（同じ発生箇所は10分に1回まで。クルー自身のエラーは除く）
    if (source !== 'crew_tick' && !hitRateLimit(`alert:${source}`, 1, 10 * 60_000)) {
      const { say, discordConfigured } = await import('../crew/discord');
      if (discordConfigured()) void say('mina', 'alerts', `🚨 本番でエラー（${source}）: ${message.slice(0, 300)}
詳しくは管理画面の「エラー監視」へ`).catch(() => {});
    }
  } catch {
    // 記録の失敗は無視する
  }
}
