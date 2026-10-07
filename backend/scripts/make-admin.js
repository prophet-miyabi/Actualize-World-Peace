// 指定したメールアドレスのアカウントを運営者（管理者）にする。
// 管理者にする手段をWeb上に作ると乗っ取りの入口になるため、サーバーに直接入れる人（RenderのShell）だけが実行できる形にしている。
// 使い方（RenderのawpバックエンドのShellで）: node scripts/make-admin.js you@example.com
const { PrismaClient } = require('@prisma/client');

const email = String(process.argv[2] || '').trim();
if (!email) {
  console.error('使い方: node scripts/make-admin.js <登録したメールアドレス>');
  process.exit(1);
}

const prisma = new PrismaClient();
prisma.user
  .findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, email: true, isAdmin: true } })
  .then(async (user) => {
    if (!user) {
      console.error(`見つかりません: ${email}（先にこのメールアドレスでアカウントを作成してください）`);
      process.exitCode = 1;
      return;
    }
    if (user.isAdmin) {
      console.log(`すでに管理者です: ${user.email}`);
      return;
    }
    await prisma.user.update({ where: { id: user.id }, data: { isAdmin: true } });
    console.log(`管理者にしました: ${user.email}`);
  })
  .catch((e) => {
    console.error('失敗しました:', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
