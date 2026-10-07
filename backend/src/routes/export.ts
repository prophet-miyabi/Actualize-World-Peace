import { Router } from 'express';
import prisma from '../prisma';
import { authenticate, AuthRequest } from '../middlewares/auth';

// データの書き出し: ユーザーがAWPに依存せず、自分のサイト・顧客とのやり取りを持ち出して
// 別の場所でも運営を続けられるようにする（AWPからの独立性の確保）。
// LINEのChannel Secret等の認証情報は、漏えい時の被害が大きく、LINE側でいつでも確認できるため含めない。
const router = Router();

const b64 = (buf: Uint8Array | null | undefined, type: string | null | undefined) =>
  buf ? `data:${type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}` : null;

router.get('/', authenticate, async (req: AuthRequest, res) => {
  const userId = req.user!.id;
  const [user, pages, inquiries, harnessOrders, cashEntries] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, createdAt: true, username: true, bio: true, category: true, region: true, links: true } }),
    prisma.landingPage.findMany({
      where: { userId },
      include: { tools: true, photos: true, variants: true },
      orderBy: { createdAt: 'asc' }
    }),
    prisma.inquiry.findMany({ where: { tenantId: userId }, orderBy: { createdAt: 'asc' } }),
    prisma.harnessOrder.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    prisma.ledgerEntry.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, include: { tx: { select: { kind: true, memo: true } } } })
  ]);

  const data = {
    format: 'awp-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    account: user,
    pages: pages.map((p) => ({
      slug: p.slug,
      siteType: p.siteType,
      purpose: p.purpose,
      lineAddUrl: p.lineAddUrl,
      businessName: p.businessName,
      heroTitle: p.heroTitle,
      strengths: p.strengths,
      socialProof: p.socialProof,
      scarcityOffer: p.scarcityOffer,
      customDomain: p.customDomain,
      design: p.design,
      sections: p.sections,
      heroImage: b64(p.heroImage, p.heroImageType),
      tools: p.tools.map((t) => ({ toolKey: t.toolKey, label: t.label, url: t.url, display: t.display })),
      headlineVariants: p.variants.map((v) => ({ label: v.label, heroTitle: v.heroTitle, impressions: v.impressions, conversions: v.conversions })),
      photos: p.photos.map((ph) => ({
        isLogo: ph.isLogo,
        position: ph.position,
        original: b64(ph.original, ph.originalType),
        enhanced: b64(ph.enhanced, ph.enhancedType)
      })),
      pageViews: p.pageViews,
      createdAt: p.createdAt
    })),
    inquiries: inquiries.map((i) => ({ senderName: i.senderName, message: i.message, source: i.source, createdAt: i.createdAt })),
    cashHistory: cashEntries.map((e) => ({ amount: e.credit - e.debit, kind: e.tx.kind, memo: e.tx.memo, createdAt: e.createdAt })),
    harnessOrders: harnessOrders.map((o) => ({ items: o.items, totalYen: o.totalYen, note: o.note, status: o.status, paymentStatus: o.paymentStatus, createdAt: o.createdAt }))
  };

  res.set('Content-Disposition', `attachment; filename="awp-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});

export default router;
