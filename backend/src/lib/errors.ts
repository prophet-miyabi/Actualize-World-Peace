import prisma from '../prisma';

// 監視担当エージェント（backend/src/agents/monitoring.ts）が後で原因分析できるよう、
// 想定外のエラーを記録する。記録自体が失敗してもアプリの処理は止めない。
export async function captureError(source: string, err: unknown, context?: Record<string, unknown>) {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? null) : null;
    await prisma.systemError.create({ data: { source, message, stack, context: context as any } });
  } catch {
    // 記録の失敗は無視する
  }
}
