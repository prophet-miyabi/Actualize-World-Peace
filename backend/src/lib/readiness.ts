import prisma from '../prisma';
import { anthropicKeyProblem } from './aiUsage';
import { smsMode } from './sms';
import { githubConfigured } from './github';

// 公開準備チェック: 「どの機能が、どの設定で解放されるか」を運営者が一目で分かるようにする。
// 値そのものは返さず「設定されているか」だけを返す（AIオペレーターにも渡るため）
export type ReadinessItem = {
  key: string;
  group: 'required' | 'recommended' | 'optional';
  label: string;
  status: 'ok' | 'todo' | 'na';
  detail: string;       // いまの状態の一言
  unlocks: string;      // これで何ができるようになるか
  where: string;        // 設定する場所（Render の環境変数名 / 管理画面のパス）
  href?: string;        // 管理画面で完結するものはリンク
};

const has = (k: string) => !!(process.env[k] || '').trim();

export async function buildReadiness(): Promise<ReadinessItem[]> {
  const [tools, registrars, addons, bank, managedSynced, agentsTotal, socialPlatforms] = await Promise.all([
    prisma.toolCatalogItem.count({ where: { enabled: true } }),
    prisma.toolCatalogItem.count({ where: { enabled: true, isDomainRegistrar: true } }),
    prisma.harnessAddon.count({ where: { enabled: true, priceYen: { not: null } } }),
    prisma.systemSetting.findUnique({ where: { key: 'awp_bank' } }),
    prisma.companyAgentConfig.count({ where: { managedAgentId: { not: null } } }),
    Promise.resolve(16),
    Promise.resolve(['x', 'instagram', 'facebook', 'youtube', 'tiktok'])
  ]);
  const keyProblem = anthropicKeyProblem();
  const sms = smsMode();
  const social = socialPlatforms.filter((p) => has(`${p.toUpperCase()}_CLIENT_ID`));

  const items: ReadinessItem[] = [
    { key: 'anthropic', group: 'required', label: 'AI（Claude）のAPIキー', status: has('ANTHROPIC_API_KEY') && !keyProblem ? 'ok' : 'todo', detail: keyProblem ?? (has('ANTHROPIC_API_KEY') ? '設定済み（接続の可否は上のバナー）' : '未設定'), unlocks: 'AIビルダー・ページ生成・チャットボット・AI企業・AIオペレーター', where: 'Render → awp-backend → Environment → ANTHROPIC_API_KEY' },
    { key: 'workspace', group: 'optional', label: 'Anthropic のワークスペースID', status: has('ANTHROPIC_WORKSPACE_ID') ? 'ok' : 'na', detail: has('ANTHROPIC_WORKSPACE_ID') ? '設定済み' : 'ワークスペース付きのキーなら不要', unlocks: 'ワークスペースに紐づかないキーでもAIが使える', where: 'ANTHROPIC_WORKSPACE_ID' },
    { key: 'engine', group: 'recommended', label: 'AI企業の実行基盤（Claude Platform）', status: (process.env.COMPANY_ENGINE || 'managed') === 'managed' ? 'ok' : 'todo', detail: `${(process.env.COMPANY_ENGINE || 'managed') === 'managed' ? 'Managed Agents' : '自前ループ'}・Platform に同期済み ${managedSynced}/${agentsTotal} 体`, unlocks: '版管理・セッション予算・Console での追跡・マルチエージェント', where: '/admin/company → 組織 → 「Claude Platform に同期」', href: '/admin/company' },
    { key: 'sms', group: 'recommended', label: 'SMS認証（Twilio）', status: sms === 'twilio' ? 'ok' : 'todo', detail: sms === 'twilio' ? '有効' : sms === 'dev' ? '開発用モード（本番では使わない）' : '未設定（電話番号なしで登録できる状態）', unlocks: '登録時の本人確認・なりすまし／大量登録の抑止', where: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID（クルーの T08）' },
    { key: 'image', group: 'recommended', label: '画像生成AI（Gemini）', status: has('GEMINI_API_KEY') ? 'ok' : 'todo', detail: has('GEMINI_API_KEY') ? '設定済み' : '未設定', unlocks: 'ページのメイン画像・外装画像の自動生成', where: 'GEMINI_API_KEY（クルーの T09）' },
    { key: 'cname', group: 'required', label: '独自ドメインの接続先（CNAME）', status: has('CUSTOM_DOMAIN_CNAME_TARGET') ? 'ok' : 'todo', detail: has('CUSTOM_DOMAIN_CNAME_TARGET') ? '設定済み' : '未設定（独自ドメイン画面のステップ3が「準備中」のまま）', unlocks: '利用者が自分のドメインでページを公開できる', where: 'CUSTOM_DOMAIN_CNAME_TARGET = フロントエンドのホスト名（例: awp-frontend-bf17.onrender.com）' },
    { key: 'registrar', group: 'recommended', label: '提携ドメイン登録サービス', status: registrars > 0 ? 'ok' : 'todo', detail: registrars > 0 ? `${registrars} 件` : '未登録（独自ドメイン画面のステップ1が「準備中」のまま）', unlocks: '提携リンクから取得したドメインは無料で公開（紹介料が入る）', where: '/admin/tools → 「ドメインの登録サービス」にチェックして登録', href: '/admin/tools' },
    { key: 'tools', group: 'recommended', label: '提携ツールのカタログ', status: tools > 0 ? 'ok' : 'todo', detail: tools > 0 ? `${tools} 件` : '0 件（利用者の「提携ツールを追加」が空）', unlocks: '予約・EC・フォームなどの外部ツールの紹介と紹介料', where: '/admin/tools', href: '/admin/tools' },
    { key: 'harness', group: 'recommended', label: 'Harness 導入支援のメニュー', status: addons > 0 ? 'ok' : 'todo', detail: addons > 0 ? `${addons} 件を表示中` : '0 件（利用者の画面は「準備中」）', unlocks: 'LINE・X・Instagram 自動化の申し込み（キャッシュで支払い可）', where: '/admin/harness → 「標準メニューのたたき台を追加」→ 料金を入れて表示をオン', href: '/admin/harness' },
    { key: 'bank', group: 'required', label: '有料プランの振込先口座', status: bank ? 'ok' : 'todo', detail: bank ? '設定済み' : '未設定（銀行振込での申し込みが「準備中」）', unlocks: '有料プラン（ライト／スタンダード／プロ）の銀行振込', where: '/admin/billing → AWPの振込先', href: '/admin/billing' },
    { key: 'social', group: 'optional', label: 'SNS連携（OAuth）', status: social.length ? 'ok' : 'todo', detail: social.length ? `連携可能: ${social.join(', ')}` : '未設定（SNS連携画面は全て「準備中」）', unlocks: 'X・Instagram・Facebook・YouTube・TikTok への予約投稿', where: 'X_CLIENT_ID / INSTAGRAM_CLIENT_ID / … と対応する CLIENT_SECRET（各プラットフォームの開発者登録が必要）' },
    { key: 'encryption', group: 'required', label: '秘密情報の暗号化キー', status: /^[0-9a-f]{64}$/i.test(process.env.SECRET_ENCRYPTION_KEY || '') ? 'ok' : 'todo', detail: /^[0-9a-f]{64}$/i.test(process.env.SECRET_ENCRYPTION_KEY || '') ? '設定済み' : '未設定（JWT_SECRET からの派生で動作中。本番では専用の鍵を）', unlocks: 'Harness 連携のAPIキー・振込先・Discord の Webhook を安全に保存', where: 'SECRET_ENCRYPTION_KEY（クルーの T04）' },
    { key: 'discord', group: 'recommended', label: 'ローンチ・クルー（Discord）', status: has('DISCORD_BOT_TOKEN') && has('DISCORD_GUILD_ID') && has('DISCORD_OWNER_ID') ? 'ok' : 'todo', detail: has('DISCORD_BOT_TOKEN') ? (has('DISCORD_OWNER_ID') ? '設定済み' : '運営者IDが未設定') : '未設定', unlocks: '15分刻みの予定・進行状況・承認通知を Discord で受け取る', where: 'DISCORD_BOT_TOKEN / DISCORD_APPLICATION_ID / DISCORD_PUBLIC_KEY / DISCORD_GUILD_ID / DISCORD_OWNER_ID（クルーの T03）', href: '/admin/crew' },
    { key: 'github', group: 'recommended', label: 'AIによる実装（GitHub）', status: githubConfigured() ? 'ok' : 'todo', detail: githubConfigured() ? '設定済み' : '未設定', unlocks: 'エージェントが課題を立て、Claude Code が PR を作る（マージはあなた）', where: 'GITHUB_OPS_TOKEN / GITHUB_REPO（クルーの T02）＋ GitHub Secrets の CLAUDE_CODE_OAUTH_TOKEN（T01）', href: '/admin/crew' },
    { key: 'urls', group: 'required', label: '公開URL', status: has('FRONTEND_URL') && has('PUBLIC_BASE_URL') ? 'ok' : 'todo', detail: `FRONTEND_URL ${has('FRONTEND_URL') ? '✓' : '✗'} / PUBLIC_BASE_URL ${has('PUBLIC_BASE_URL') ? '✓' : '✗'}`, unlocks: 'メール・Discord・OGP のリンク、Discord の Interactions URL', where: 'FRONTEND_URL / PUBLIC_BASE_URL' },
    { key: 'indexnow', group: 'optional', label: '検索エンジンへの通知（IndexNow）', status: has('INDEXNOW_KEY') ? 'ok' : 'todo', detail: has('INDEXNOW_KEY') ? '設定済み' : '未設定', unlocks: '公開・更新を Bing 等に即時通知', where: 'INDEXNOW_KEY' },
    { key: 'stripe', group: 'optional', label: 'Stripe（旧・月額課金）', status: 'na', detail: has('STRIPE_SECRET_KEY') ? '設定あり（使っていない）' : '不要', unlocks: '使わない（有料プランは銀行振込・キャッシュの自前請求）', where: '—' }
  ];
  return items;
}
