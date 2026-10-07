// 本番の起動手順: DB接続確認 → マイグレーション → サーバー起動。
// 以前は `prisma migrate deploy && node dist/server.js` だけで、DBに繋がらないとログに何も出ないまま
// ポート待ち受けのタイムアウトで強制終了され、原因が分からなかった。各段階をログに出し、
// 固まった場合は時間切れで明示的に失敗させる。
const { spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const PROBE_TIMEOUT_MS = 20_000;
const MIGRATE_TIMEOUT_MS = 120_000;

function describeDatabaseUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.hostname}:${u.port || '(default)'}${u.pathname} sslmode=${u.searchParams.get('sslmode') || '(none)'}`;
  } catch {
    return '(DATABASE_URL を解釈できません)';
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} が ${ms / 1000}秒以内に完了しませんでした`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probeDatabase() {
  const prisma = new PrismaClient();
  try {
    const rows = await withTimeout(prisma.$queryRaw`SELECT version() AS v`, PROBE_TIMEOUT_MS, 'DB接続確認');
    console.log('[start] DB接続OK:', rows[0].v);
  } finally {
    prisma.$disconnect().catch(() => {});
  }
}

function runMigrations() {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell: process.platform === 'win32' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`prisma migrate deploy が ${MIGRATE_TIMEOUT_MS / 1000}秒以内に完了しませんでした`));
    }, MIGRATE_TIMEOUT_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`prisma migrate deploy が失敗しました (code=${code}, signal=${signal})`));
    });
  });
}

async function main() {
  console.log('[start] 接続先:', describeDatabaseUrl(process.env.DATABASE_URL || ''));
  try {
    await probeDatabase();
  } catch (e) {
    console.error('[start] DB接続に失敗:', e.code || '', e.message);
    process.exit(1);
  }
  console.log('[start] マイグレーションを開始');
  await runMigrations();
  console.log('[start] マイグレーション完了。サーバーを起動します');
  require('./dist/server.js');
}

main().catch((e) => {
  console.error('[start] 起動失敗:', e.message);
  process.exit(1);
});
