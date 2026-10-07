import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';

// 提携ツール: AWPの収益の柱。運営者が登録したツールを、ユーザーが運営者のアフィリエイトリンク経由で
// 自分の名義のアカウントとして導入し、自分のサイトにボタン／埋め込みとして追加する。
// ツールのアカウント・顧客データはユーザー本人のツール側に残り、AWPは公開用URLしか持たない
// （ユーザーがAWPから独立して運営できるようにするため）。
const router = Router();

const MAX_TOOLS_PER_LP = 20;

async function requireAdmin(req: AuthRequest, res: any): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { isAdmin: true } });
  if (!user?.isAdmin) {
    res.status(403).json({ error: '管理者のみ利用できます' });
    return false;
  }
  return true;
}

function normalizeHost(h: string): string {
  return h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/?#].*$/, '').replace(/^\*?\./, '');
}

function httpsUrl(raw: unknown): URL | null {
  try {
    const u = new URL(String(raw || '').trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

// ユーザーが貼るURLは、カタログで許可されたホスト（とそのサブドメイン）のhttpsのみ。
// 任意のURLを許すと、フィッシングサイトへの誘導や、埋め込みでの不正なスクリプト実行に使われるため
export function validateToolUrl(raw: unknown, allowedHosts: string[]): string | null {
  const u = httpsUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  const ok = allowedHosts.map(normalizeHost).filter(Boolean).some((h) => host === h || host.endsWith(`.${h}`));
  return ok ? u.toString() : null;
}

async function ownLp(userId: string, lpId: unknown) {
  const id = typeof lpId === 'string' && lpId ? lpId : undefined;
  if (id) return prisma.landingPage.findFirst({ where: { id, userId } });
  return prisma.landingPage.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

const publicItem = (t: { key: string; name: string; category: string; description: string; embeddable: boolean; allowedHosts: string[] }) => ({
  key: t.key,
  name: t.name,
  category: t.category,
  description: t.description,
  embeddable: t.embeddable,
  allowedHosts: t.allowedHosts
});

// ---- ユーザー向け ----

router.get('/catalog', authenticate, async (_req, res) => {
  const items = await prisma.toolCatalogItem.findMany({ where: { enabled: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] });
  res.json({ items: items.map(publicItem) });
});

// アフィリエイトリンクへの転送。クリック数だけ記録する（誰が押したかは保存しない）
router.get('/go/:key', async (req, res) => {
  const item = await prisma.toolCatalogItem.findFirst({ where: { key: String(req.params.key), enabled: true } });
  if (!item) return res.status(404).send('Not found');
  const source = typeof req.query.src === 'string' ? req.query.src.slice(0, 40) : null;
  await prisma.affiliateClick.create({ data: { toolKey: item.key, source } }).catch(() => {});
  res.redirect(302, item.affiliateUrl || item.officialUrl);
});

router.get('/mine', authenticate, async (req: AuthRequest, res) => {
  const lp = await ownLp(req.user!.id, req.query.lpId);
  if (!lp) return res.json({ tools: [] });
  const tools = await prisma.lpTool.findMany({ where: { lpId: lp.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  res.json({ tools });
});

router.post('/mine', authenticate, async (req: AuthRequest, res) => {
  const lp = await ownLp(req.user!.id, req.body?.lpId);
  if (!lp) return res.status(400).json({ error: '先にページを作成してください。' });
  const item = await prisma.toolCatalogItem.findFirst({ where: { key: String(req.body?.toolKey || ''), enabled: true } });
  if (!item) return res.status(400).json({ error: 'このツールは選べません。' });

  const url = validateToolUrl(req.body?.url, item.allowedHosts);
  if (!url) {
    return res.status(400).json({ error: `${item.name}のURL（https://${item.allowedHosts[0] ?? ''}/... の形式）を入力してください。` });
  }
  const display = req.body?.display === 'embed' && item.embeddable ? 'embed' : 'button';
  const label = String(req.body?.label || '').trim().slice(0, 40) || item.name;

  const count = await prisma.lpTool.count({ where: { lpId: lp.id } });
  if (count >= MAX_TOOLS_PER_LP) return res.status(400).json({ error: `1ページに追加できるツールは${MAX_TOOLS_PER_LP}個までです。` });

  const tool = await prisma.lpTool.create({ data: { lpId: lp.id, toolKey: item.key, label, url, display, sortOrder: count } });
  res.status(201).json({ tool });
});

router.delete('/mine/:id', authenticate, async (req: AuthRequest, res) => {
  const tool = await prisma.lpTool.findFirst({ where: { id: String(req.params.id), lp: { userId: req.user!.id } } });
  if (!tool) return res.status(404).json({ error: '見つかりません' });
  await prisma.lpTool.delete({ where: { id: tool.id } });
  res.json({ ok: true });
});

// ---- 運営者（管理者）向け: カタログ管理 ----

function parseCatalogBody(body: any): { data?: any; error?: string } {
  const key = String(body?.key || '').trim().toLowerCase();
  const name = String(body?.name || '').trim().slice(0, 60);
  const category = String(body?.category || '').trim().slice(0, 30);
  const description = String(body?.description || '').trim().slice(0, 300);
  const official = httpsUrl(body?.officialUrl);
  const affiliateRaw = String(body?.affiliateUrl ?? '').trim();
  const affiliate = affiliateRaw ? httpsUrl(affiliateRaw) : null;
  const allowedHosts = (Array.isArray(body?.allowedHosts) ? body.allowedHosts : String(body?.allowedHosts || '').split(','))
    .map((h: unknown) => normalizeHost(String(h)))
    .filter(Boolean)
    .slice(0, 10);

  if (!/^[a-z0-9-]{2,40}$/.test(key)) return { error: 'キーは半角英小文字・数字・ハイフンで2〜40文字にしてください。' };
  if (!name || !category || !description) return { error: '名前・カテゴリ・説明は必須です。' };
  if (!official) return { error: '公式サイトURLは https:// で始まる正しいURLにしてください。' };
  if (affiliateRaw && !affiliate) return { error: 'アフィリエイトURLは https:// で始まる正しいURLにしてください。' };
  if (allowedHosts.length === 0) return { error: 'ユーザーが貼れるURLのホストを1つ以上入力してください（例: airrsv.net）。' };

  return {
    data: {
      key,
      name,
      category,
      description,
      officialUrl: official.toString(),
      affiliateUrl: affiliate ? affiliate.toString() : null,
      allowedHosts,
      embeddable: !!body?.embeddable,
      enabled: body?.enabled !== false,
      sortOrder: Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0
    }
  };
}

router.get('/admin/catalog', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const [items, clicks] = await Promise.all([
    prisma.toolCatalogItem.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] }),
    prisma.affiliateClick.groupBy({ by: ['toolKey'], _count: { _all: true } })
  ]);
  const clickMap = new Map(clicks.map((c) => [c.toolKey, c._count._all]));
  res.json({ items: items.map((i) => ({ ...i, clicks: clickMap.get(i.key) ?? 0 })) });
});

router.post('/admin/catalog', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { data, error } = parseCatalogBody(req.body);
  if (!data) return res.status(400).json({ error });
  try {
    const item = await prisma.toolCatalogItem.create({ data });
    res.status(201).json({ item });
  } catch (e: any) {
    if (e?.code === 'P2002') return res.status(400).json({ error: 'このキーは既に使われています。' });
    throw e;
  }
});

router.put('/admin/catalog/:id', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  const existing = await prisma.toolCatalogItem.findUnique({ where: { id: String(req.params.id) } });
  if (!existing) return res.status(404).json({ error: '見つかりません' });
  const { data, error } = parseCatalogBody({ ...existing, ...req.body, key: existing.key });
  if (!data) return res.status(400).json({ error });
  const item = await prisma.toolCatalogItem.update({ where: { id: existing.id }, data });
  res.json({ item });
});

router.delete('/admin/catalog/:id', authenticate, async (req: AuthRequest, res) => {
  if (!(await requireAdmin(req, res))) return;
  await prisma.toolCatalogItem.deleteMany({ where: { id: String(req.params.id) } });
  res.json({ ok: true });
});

export default router;
