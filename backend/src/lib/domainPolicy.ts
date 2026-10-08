import prisma from '../prisma';
import { hasPaidPlan } from './plans';

// 独自ドメインの公開条件（運営者の方針）:
// 1. まずAWPのドメインで公開し、独自ドメインに切り替えた後もページはAWP上で動き続ける（編集・ページ追加・機能追加はそのまま）
// 2. AWPの提携リンク（ドメインの登録サービス）から取得したドメインなら、独自ドメインでの公開は無料
// 3. それ以外は、有料プラン（ライト以上）への加入が必要
// 「提携リンクから取得したか」の確認:
// - 本人がログイン中に提携リンクを押した記録（DomainReferral）がある
// - RDAP（ドメインの公開登録情報）で、登録日が押した日時より後、かつ登録事業者が提携先と一致 → 自動で無料
// - RDAPで確認できないドメイン（.jp など）は、運営者の確認待ち（14日の猶予期間中は公開できる）
export type DomainMode = 'affiliate' | 'paid' | 'review';
const REVIEW_DAYS = 14;
const REFERRAL_WINDOW_DAYS = 180;

function apexOf(domain: string) {
  return domain.replace(/^www\./, '');
}

export async function rdapLookup(domain: string): Promise<{ registeredAt: Date | null; registrar: string | null } | null> {
  try {
    // rdap.org は User-Agent のない問い合わせを拒否する（403）ため、送信元を名乗る
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(apexOf(domain))}`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/rdap+json', 'User-Agent': 'AWP-domain-check/1.0' }
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    const reg = (j.events ?? []).find((e: any) => e.eventAction === 'registration')?.eventDate;
    const registrarEntity = (j.entities ?? []).find((e: any) => (e.roles ?? []).includes('registrar'));
    const fn = registrarEntity?.vcardArray?.[1]?.find((v: any) => v[0] === 'fn')?.[3] ?? registrarEntity?.handle ?? null;
    if (!reg && !fn) return null;
    return { registeredAt: reg ? new Date(reg) : null, registrar: fn ? String(fn) : null };
  } catch {
    return null;
  }
}

export async function evaluateDomain(userId: string, domain: string): Promise<{ mode: DomainMode | null; note: string; reviewUntil?: Date }> {
  const since = new Date(Date.now() - REFERRAL_WINDOW_DAYS * 86_400_000);
  const [referrals, registrars, user] = await Promise.all([
    prisma.domainReferral.findMany({ where: { userId, clickedAt: { gte: since } }, orderBy: { clickedAt: 'asc' } }),
    prisma.toolCatalogItem.findMany({ where: { isDomainRegistrar: true }, select: { key: true, name: true, registrarMatch: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { plan: true, planUntil: true, isAdmin: true, subscriptionStatus: true } })
  ]);
  const paid = hasPaidPlan(user);
  const viaRegistrar = referrals.filter((r) => registrars.some((g) => g.key === r.toolKey));
  if (viaRegistrar.length) {
    const rdap = await rdapLookup(domain);
    if (rdap?.registeredAt) {
      const firstClick = viaRegistrar[0].clickedAt.getTime() - 3600_000;
      const clickedTools = registrars.filter((g) => viaRegistrar.some((r) => r.toolKey === g.key));
      const matches = clickedTools.some((g) => !g.registrarMatch || (rdap.registrar ?? '').toLowerCase().includes(g.registrarMatch.toLowerCase()));
      if (rdap.registeredAt.getTime() >= firstClick && matches) {
        return { mode: 'affiliate', note: `提携リンクからの取得を確認（登録日 ${rdap.registeredAt.toISOString().slice(0, 10)}・${rdap.registrar ?? '登録事業者不明'}）` };
      }
      const why = rdap.registeredAt.getTime() < firstClick ? '提携リンクを押す前に登録されたドメイン' : `登録事業者（${rdap.registrar}）が提携先と一致しない`;
      if (paid) return { mode: 'paid', note: `${why}のため、有料プランで公開` };
      return { mode: null, note: `${why}です` };
    }
    // RDAPで確認できない（.jp など）: 運営者が提携先の成果と照らして確認する
    return { mode: 'review', note: '提携リンクからの取得を運営者が確認中', reviewUntil: new Date(Date.now() + REVIEW_DAYS * 86_400_000) };
  }
  if (paid) return { mode: 'paid', note: '有料プランで公開' };
  return { mode: null, note: '提携リンクから取得したドメインではありません' };
}

// いま独自ドメインで表示してよいか
export function domainServable(lp: { customDomainVerified: boolean; customDomainMode: string | null; customDomainReviewUntil: Date | null }, ownerPaid: boolean) {
  if (!lp.customDomainVerified) return false;
  if (lp.customDomainMode === 'affiliate') return true;
  if (lp.customDomainMode === 'review') return ownerPaid || (!!lp.customDomainReviewUntil && lp.customDomainReviewUntil.getTime() > Date.now());
  return ownerPaid;
}
