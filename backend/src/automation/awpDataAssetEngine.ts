// AWP Data Asset Engine — 全テナントの行動・成約データを「個人を特定しない形」で蓄積し、
// 業種別の勝ちパターン（IndustryFunnelBenchmark）に結晶化して IndustryPlaybook とページ生成へ還流する。
// あわせて、各利用者の成長段階から「いま必要な外部ツール（Harness）」を予測する（HarnessIntentSignal）。
//
// 原則:
// - レイクには userId・氏名・連絡先・本文を入れない（業種・チャネル・段階・時間帯・文面パターンのハッシュだけ）
// - 集計はサンプル数が少ない組み合わせを出さない（k-匿名性: MIN_SAMPLE 未満は作らない）
// - 外部へ出る通信は公式 API のホストに限定する（safeExternalFetch）
import crypto from 'crypto';
import prisma from '../prisma';

// ---- 0. 外部通信のホワイトリスト ------------------------------------------------------------------
// AWP のバックエンドから SNS・決済の公式 API 以外へメタデータが出ないことをコードで保証する
export const ALLOWED_EXTERNAL_HOSTS = new Set([
  'api.line.me', 'api-data.line.me',
  'api.x.com', 'api.twitter.com', 'upload.twitter.com',
  'graph.facebook.com', 'graph.instagram.com', 'api.instagram.com',
  'open.tiktokapis.com',
  'www.googleapis.com', 'oauth2.googleapis.com',
  'api.stripe.com'
]);

export async function safeExternalFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`[AWP Security Guard] 未承認の外部ホストへの通信をブロックしました: ${parsed.hostname}`);
  }
  return fetch(url, options);
}

// ---- 1. Spintax 展開 ＋「どの言い回しが選ばれたか」の記録 ----------------------------------------------
// {{name}} を変数で埋め、{A|B|C} をランダムに1つ選ぶ。選ばれた語彙と文面のハッシュを返すので、
// 送信後の反応をレイクに記録すると「どの挨拶・どの CTA が効いたか」が業種別に学べる
export function renderTrackedMessage(template: string, variables: Record<string, string | number | undefined> = {}): { text: string; chosenVariants: string[]; templateHash: string } {
  const templateHash = crypto.createHash('sha256').update(template).digest('hex').slice(0, 16);
  const chosenVariants: string[] = [];
  let rendered = template.replace(/\{\{(\w+)\}\}/g, (_, key) => (variables[key] !== undefined ? String(variables[key]) : ''));
  rendered = rendered.replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_, optionsStr: string) => {
    const options = optionsStr.split('|');
    const selected = options[Math.floor(Math.random() * options.length)];
    chosenVariants.push(selected);
    return selected;
  });
  return { text: rendered, chosenVariants, templateHash };
}

// ---- 2. レイクへの記録 ----------------------------------------------------------------------------------
export type Channel = 'x' | 'instagram' | 'tiktok' | 'line' | 'lp' | 'facebook' | 'youtube';
export type FunnelStage = 'awareness_post' | 'gate_dm' | 'lp_visit' | 'step_message' | 'booking' | 'payment';

// 流入元ドメイン → チャネル（PageEvent.source はホスト名だけ）
export function channelFromSource(source: string | null | undefined): Channel {
  const s = (source || '').toLowerCase();
  if (!s) return 'lp';
  if (/instagram/.test(s)) return 'instagram';
  if (/(^|\.)x\.com$|twitter|t\.co$/.test(s)) return 'x';
  if (/tiktok/.test(s)) return 'tiktok';
  if (/line\.me|lin\.ee/.test(s)) return 'line';
  if (/facebook|fb\.com/.test(s)) return 'facebook';
  if (/youtu/.test(s)) return 'youtube';
  return 'lp';
}

export async function recordCommercialIntelligence(params: {
  industryKey?: string | null; channel: Channel; funnelStage: FunnelStage;
  templateHash?: string | null; spintaxVariant?: string | null; triggerKeyword?: string | null;
  converted?: boolean; revenueAmount?: number; dwellTimeMs?: number | null; at?: Date;
}) {
  const now = params.at ?? new Date();
  const jst = new Date(now.getTime() + 9 * 3600_000);
  await prisma.awpIntelligenceLake.create({ data: {
    industryKey: params.industryKey || 'other', channel: params.channel, funnelStage: params.funnelStage,
    templateHash: params.templateHash ?? null, spintaxVariant: params.spintaxVariant?.slice(0, 80) ?? null, triggerKeyword: params.triggerKeyword?.slice(0, 40) ?? null,
    converted: params.converted ?? false, revenueAmount: Math.max(0, Math.round(params.revenueAmount ?? 0)), dwellTimeMs: params.dwellTimeMs ?? null,
    hourOfDay: jst.getUTCHours(), dayOfWeek: jst.getUTCDay(), createdAt: now
  } }).catch((e: any) => console.error('intelligence lake write failed', e?.message));
}

// ページ（lpId）から業種キーを引く小さなキャッシュ（記録のたびに DB を引かない）
const industryCache = new Map<string, { key: string; until: number }>();
export async function industryOfLp(lpId: string): Promise<string> {
  const hit = industryCache.get(lpId);
  if (hit && hit.until > Date.now()) return hit.key;
  const lp = await prisma.landingPage.findUnique({ where: { id: lpId }, select: { industryKey: true } }).catch(() => null);
  const key = lp?.industryKey || 'other';
  industryCache.set(lpId, { key, until: Date.now() + 10 * 60_000 });
  return key;
}
export async function industryOfUser(userId: string): Promise<string> {
  const lp = await prisma.landingPage.findFirst({ where: { userId }, orderBy: { createdAt: 'asc' }, select: { industryKey: true } }).catch(() => null);
  return lp?.industryKey || 'other';
}

// ---- 3. 集合知の結晶化（業種 × チャネルの勝ちパターン） ------------------------------------------------
const MIN_SAMPLE = 5;

export async function aggregateIndustryBenchmarks(days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  const logs = await prisma.awpIntelligenceLake.findMany({ where: { createdAt: { gte: since } }, select: { industryKey: true, channel: true, funnelStage: true, converted: true, revenueAmount: true, hourOfDay: true, triggerKeyword: true, spintaxVariant: true } });
  const grouped = new Map<string, typeof logs>();
  for (const l of logs) { const k = `${l.industryKey}::${l.channel}`; grouped.set(k, [...(grouped.get(k) ?? []), l]); }
  let updated = 0;
  for (const [key, items] of grouped) {
    const [industryKey, channel] = key.split('::');
    if (items.length < MIN_SAMPLE) continue;
    const count = (stage: string) => items.filter((i) => i.funnelStage === stage).length;
    const conv = (stage: string) => items.filter((i) => i.funnelStage === stage && i.converted).length;
    const awareness = count('awareness_post'), gate = count('gate_dm'), visits = count('lp_visit'), bookings = count('booking'), payments = count('payment');
    const rate = (a: number, b: number) => (b > 0 ? Math.min(1, a / b) : 0);
    const paid = items.filter((i) => i.funnelStage === 'payment' && i.converted && i.revenueAmount > 0);
    const avgOrderValue = paid.length ? Math.round(paid.reduce((s, i) => s + i.revenueAmount, 0) / paid.length) : 0;
    // 反応（次段階へ進んだ・決済した）が多い時間帯トップ3
    const hour = new Map<number, number>();
    for (const i of items) if (i.converted) hour.set(i.hourOfDay, (hour.get(i.hourOfDay) ?? 0) + 1);
    const bestSendHours = [...hour.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h);
    // 成約に結びついた言い回し・キーワードのトップ5
    const kw = new Map<string, number>();
    for (const i of items) if (i.converted) { if (i.triggerKeyword) kw.set(i.triggerKeyword, (kw.get(i.triggerKeyword) ?? 0) + 1); if (i.spintaxVariant) kw.set(i.spintaxVariant, (kw.get(i.spintaxVariant) ?? 0) + 1); }
    const winningKeywords = [...kw.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
    const data = {
      sampleSize: items.length,
      avgGatePassRate: rate(gate || conv('awareness_post'), awareness),
      avgClickRate: rate(visits, gate || awareness),
      avgBookingRate: rate(bookings + payments, visits),
      avgOrderValue, bestSendHoursJson: bestSendHours as any, winningKeywordsJson: winningKeywords as any
    };
    await prisma.industryFunnelBenchmark.upsert({ where: { industryKey_channel: { industryKey, channel } }, update: data, create: { industryKey, channel, ...data } });
    updated++;
  }
  return { groups: grouped.size, updated };
}

// IndustryPlaybook / デザイン・文章生成に渡す短い要約（サンプルが十分な組み合わせだけ）
export async function benchmarkBrief(industryKey: string): Promise<string | null> {
  const rows = await prisma.industryFunnelBenchmark.findMany({ where: { industryKey, sampleSize: { gte: 20 } }, orderBy: { sampleSize: 'desc' } }).catch(() => []);
  if (!rows.length) return null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return ['【AWP 全体の実測（同業種・直近30日・匿名集計）】', ...rows.map((r) => {
    const hours = (r.bestSendHoursJson as number[]) ?? [];
    const kws = (r.winningKeywordsJson as string[]) ?? [];
    return `- ${r.channel}: 反応率 ${pct(r.avgGatePassRate)} / LP遷移 ${pct(r.avgClickRate)} / 予約・決済 ${pct(r.avgBookingRate)}${r.avgOrderValue ? ` / 平均単価 ${r.avgOrderValue.toLocaleString('ja-JP')}円` : ''}${hours.length ? ` / 反応が多い時間 ${hours.map((h) => `${h}時`).join('・')}` : ''}${kws.length ? ` / 効いた言葉 ${kws.join('・')}` : ''}（n=${r.sampleSize}）`;
  })].join('\n');
}

// ---- 4. ハーネス導入インテント（成長段階から「いま要る外部ツール」を予測） ----------------------------
// 推奨キーは HarnessAddon.key（line-install / line-bot / x-auto-posts / ig-bot / ig-auto-posts …）か、
// AWP 内の機能を指す擬似キー（custom-domain / shop-payments）
export const INTENT_LABEL: Record<string, string> = {
  'line-install': 'LINE 公式アカウントの導入（予約確認・リマインド・ステップ配信）',
  'line-bot': 'LINE の自動返信ボット',
  'ig-install': 'Instagram 連携の導入',
  'ig-bot': 'Instagram の自動返信ボット',
  'ig-auto-posts': 'Instagram 投稿の自動作成',
  'x-install': 'X 連携の導入',
  'x-auto-posts': 'X 投稿の自動作成',
  'custom-domain': '独自ドメイン',
  'shop-payments': 'ページでの直接販売（決済）'
};

export async function evaluateHarnessIntent(ownerId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const lps = await prisma.landingPage.findMany({ where: { userId: ownerId }, select: { id: true, industryKey: true, customDomain: true, bookingEnabled: true } });
  if (!lps.length) return [];
  const ids = lps.map((l) => l.id);
  const [traffic, bookings, line, accounts, igTraffic, xTraffic, orders, harnessOrders, seller, postCount] = await Promise.all([
    prisma.pageEvent.count({ where: { lpId: { in: ids }, type: 'view', createdAt: { gte: since } } }),
    prisma.booking.count({ where: { lpId: { in: ids }, createdAt: { gte: since } } }),
    prisma.lineConfig.findUnique({ where: { userId: ownerId }, select: { friendsAdded: true, webhookActivated: true } }),
    prisma.socialAccount.findMany({ where: { userId: ownerId }, select: { platform: true } }),
    prisma.pageEvent.count({ where: { lpId: { in: ids }, type: 'view', createdAt: { gte: since }, source: { contains: 'instagram' } } }),
    prisma.pageEvent.count({ where: { lpId: { in: ids }, type: 'view', createdAt: { gte: since }, OR: [{ source: { contains: 'x.com' } }, { source: { contains: 'twitter' } }, { source: { contains: 't.co' } }] } }),
    prisma.order.count({ where: { lpId: { in: ids }, createdAt: { gte: since } } }),
    prisma.harnessOrder.findMany({ where: { userId: ownerId, status: { not: 'canceled' } }, select: { items: true } }),
    prisma.sellerProfile.findUnique({ where: { userId: ownerId }, select: { enabled: true } }),
    prisma.post.count({ where: { userId: ownerId, createdAt: { gte: since } } })
  ]);
  const ordered = new Set(harnessOrders.flatMap((o) => ((o.items as { key?: string }[]) ?? []).map((i) => i.key).filter((k): k is string => !!k)));
  const has = (p: string) => accounts.some((a) => a.platform === p);
  const industryKey = lps[0].industryKey || 'other';
  const lineFriends = line?.friendsAdded ?? 0;
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

  // 候補ごとにスコアと根拠を出す（上位2件を保存）
  const cands: { key: string; score: number; reason: string; converted: boolean }[] = [];
  if (bookings >= 3 && !line?.webhookActivated) cands.push({ key: 'line-install', score: clamp(55 + bookings * 5 + traffic / 50), reason: `直近30日で予約 ${bookings} 件。LINE で確認・リマインドを自動化すると取りこぼしが減ります`, converted: ordered.has('line-install') || !!line?.webhookActivated });
  if (lineFriends >= 30 || (line?.webhookActivated && bookings >= 5)) cands.push({ key: 'line-bot', score: clamp(60 + lineFriends / 2), reason: `LINE の友だち ${lineFriends} 人。よくある質問への自動返信で対応時間を減らせます`, converted: ordered.has('line-bot') });
  if (igTraffic >= 50 || (has('instagram') && postCount >= 8)) cands.push({ key: has('instagram') ? 'ig-auto-posts' : 'ig-install', score: clamp(50 + igTraffic / 5 + postCount * 2), reason: `Instagram からの来訪 ${igTraffic} 回・投稿 ${postCount} 件。投稿の自動作成で更新を続けやすくなります`, converted: ordered.has('ig-auto-posts') || ordered.has('ig-install') });
  if (xTraffic >= 50 || (has('x') && postCount >= 8)) cands.push({ key: has('x') ? 'x-auto-posts' : 'x-install', score: clamp(45 + xTraffic / 5 + postCount * 2), reason: `X からの来訪 ${xTraffic} 回。投稿の自動作成で露出を保てます`, converted: ordered.has('x-auto-posts') || ordered.has('x-install') });
  if (traffic >= 300 && lps.every((l) => !l.customDomain)) cands.push({ key: 'custom-domain', score: clamp(50 + traffic / 20), reason: `月間 ${traffic} 回の閲覧。独自ドメインにすると検索と名刺・チラシからの流入が安定します`, converted: lps.some((l) => !!l.customDomain) });
  if ((orders >= 1 || bookings >= 10) && !seller?.enabled) cands.push({ key: 'shop-payments', score: clamp(50 + orders * 10 + bookings * 2), reason: `注文 ${orders} 件・予約 ${bookings} 件。ページで直接販売・決済を受けると手数料 0 円で売上を取りこぼしません`, converted: !!seller?.enabled });

  const top = cands.sort((a, b) => b.score - a.score).slice(0, 2);
  const saved = [];
  for (const c of top) {
    saved.push(await prisma.harnessIntentSignal.upsert({
      where: { ownerId_recommendedAddon: { ownerId, recommendedAddon: c.key } },
      update: { industryKey, monthlyTraffic: traffic, monthlyBookings: bookings, lineFriendCount: lineFriends, intentScore: c.score, reason: c.reason, isConverted: c.converted },
      create: { ownerId, industryKey, monthlyTraffic: traffic, monthlyBookings: bookings, lineFriendCount: lineFriends, recommendedAddon: c.key, intentScore: c.score, reason: c.reason, isConverted: c.converted }
    }));
  }
  // 候補から外れた古い提案は下げる
  await prisma.harnessIntentSignal.updateMany({ where: { ownerId, recommendedAddon: { notIn: top.map((t) => t.key) } }, data: { intentScore: 0 } });
  return saved;
}

export async function evaluateAllHarnessIntents() {
  const owners = await prisma.landingPage.findMany({ where: { hidden: false }, distinct: ['userId'], select: { userId: true } });
  let n = 0;
  for (const o of owners) { await evaluateHarnessIntent(o.userId).catch((e: any) => console.error('harness intent failed', o.userId, e?.message)); n++; }
  return n;
}

// ---- 5. 定期実行（起動後5分、以後6時間ごと） --------------------------------------------------------------
let timer: NodeJS.Timeout | null = null;
export function startDataAssetJobs() {
  if (timer) return;
  const run = async () => {
    try {
      const b = await aggregateIndustryBenchmarks();
      const n = await evaluateAllHarnessIntents();
      await prisma.companyEvent.create({ data: { type: 'intelligence.aggregated', actor: 'data', payload: { benchmarks: b, owners: n } as any } }).catch(() => {});
    } catch (e: any) { console.error('data asset jobs failed', e?.message); }
  };
  setTimeout(() => { void run(); }, 5 * 60_000);
  timer = setInterval(() => { void run(); }, 6 * 3600_000);
}
