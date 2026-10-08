import prisma from '../prisma';
import type { PersonaKey } from './personas';

// 公開（10/28）までのタスク一覧。ここが「計画」の正本で、ミナはこれを元に毎日15分刻みの予定を組む。
// owner: user = あなたの作業（手順つき）/ agent = エージェントの作業（GitHubの課題→Claude Code→PR→あなたがマージ）
// 既存のタスクの状態は上書きしない（新しいタスクだけ追加し、内容の改訂はここで行う）
export const LAUNCH_DAY = '2026-10-28';

type Seed = {
  key: string; title: string; area: string; epic: string; owner: 'user' | 'agent'; agents: PersonaKey[];
  estimateMin: number; priority: number; planDay: string; dueDay?: string; dependsOn?: string[]; steps?: string; acceptance: string;
};

const COMMON_RULES = [
  'スマホ幅（375px）で表示が崩れないこと',
  '既存の機能を壊さないこと（変更した画面以外の主要画面も確認する）',
  '秘密情報（APIキー・トークン・個人情報）をコミットしないこと',
  '事実でない実績・価格・限定表示・お客様の声を作らないこと（景品表示法）',
  'CLAUDE.md のルールに従うこと'
].map((r) => `- ${r}`).join('\n');

export const SEED: Seed[] = [
  // ===== 10/8（木）: 開発チームの立ち上げ =====
  {
    key: 'T01', title: 'Claude Maxプランに加入し、GitHubにClaude Code用のトークンを登録', area: 'setup', epic: '立ち上げ', owner: 'user', agents: ['mina'],
    estimateMin: 30, priority: 0, planDay: '2026-10-08',
    steps: [
      '1. claude.ai の「設定 → プラン」から Max プランに加入する（支払いはあなたが行う）',
      '2. パソコンのターミナルで `claude setup-token` を実行し、表示に従ってログイン → 長い文字列（トークン）が表示される',
      '3. GitHub のリポジトリ prophet-miyabi/Actualize-World-Peace →「Settings」→「Secrets and variables」→「Actions」→「New repository secret」',
      '4. Name に `CLAUDE_CODE_OAUTH_TOKEN`、Secret に 2 のトークンを貼り付けて「Add secret」',
      '5. https://github.com/apps/claude を開き、このリポジトリに Claude GitHub App がインストールされているか確認（なければ Install）',
      '※ トークンは誰にも見せない・チャットに貼らないこと'
    ].join('\n'),
    acceptance: 'GitHubのSecretsに CLAUDE_CODE_OAUTH_TOKEN があり、Claude GitHub App がインストール済み'
  },
  {
    key: 'T02', title: 'GitHubの操作用トークンを作り、Renderに登録', area: 'setup', epic: '立ち上げ', owner: 'user', agents: ['mina'],
    estimateMin: 30, priority: 0, planDay: '2026-10-08',
    steps: [
      '1. GitHub 右上のアイコン →「Settings」→ 左下「Developer settings」→「Personal access tokens」→「Fine-grained tokens」→「Generate new token」',
      '2. Token name: `awp-crew`、Expiration: 90 days、Repository access:「Only select repositories」で Actualize-World-Peace だけ選ぶ',
      '3. Permissions →「Repository permissions」で次の3つを設定: Issues = Read and write / Pull requests = Read and write / Contents = Read-only',
      '4.「Generate token」→ 表示されたトークンをコピー（この画面を閉じると二度と見られない）',
      '5. Render →「awp-backend」→「Environment」→「Add Environment Variable」で `GITHUB_OPS_TOKEN` = 4 のトークン、`GITHUB_REPO` = `prophet-miyabi/Actualize-World-Peace` を追加して「Save Changes」'
    ].join('\n'),
    acceptance: 'Renderのawp-backendに GITHUB_OPS_TOKEN と GITHUB_REPO が設定され、管理画面「ローンチ・クルー」でGitHubが「設定済み」'
  },
  {
    key: 'T04', title: 'Renderに暗号化キー（SECRET_ENCRYPTION_KEY）を設定', area: 'setup', epic: '立ち上げ', owner: 'user', agents: ['mina'],
    estimateMin: 15, priority: 0, planDay: '2026-10-08',
    steps: [
      '⚠ T03（Discordの初期設定）より先に行ってください。あとから設定・変更した場合は、管理画面で「Discordを初期設定」をもう一度押してください（保存してあるWebhookの鍵を作り直します）',
      '1. パソコンのターミナルで `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"` を実行 → 64文字の英数字が出る',
      '2. Render →「awp-backend」→「Environment」→ `SECRET_ENCRYPTION_KEY` = 1 の文字列 を追加して保存',
      '3. 再デプロイが終わるのを待つ（Renderの画面で Live になればOK）',
      '※ 一度決めたら変えないこと（変えると保存済みの鍵を復号できなくなる）'
    ].join('\n'),
    acceptance: 'SECRET_ENCRYPTION_KEY が設定され、Discordへの投稿が引き続き届く'
  },
  {
    key: 'T03', title: 'Discordサーバーとボットを用意し、クルーを起動', area: 'setup', epic: '立ち上げ', owner: 'user', agents: ['mina'],
    estimateMin: 45, priority: 0, planDay: '2026-10-08',
    steps: [
      '1. Discordで「サーバーを追加」→「オリジナルの作成」→「自分と友達のため」→ 名前「AWP 開発」で作成',
      '2. Discordの「設定 → 詳細設定」で「開発者モード」をオン → サーバー名を右クリック「サーバーIDをコピー」（= DISCORD_GUILD_ID）。自分のアイコンを右クリック「ユーザーIDをコピー」（= DISCORD_OWNER_ID）',
      '3. https://discord.com/developers/applications →「New Application」→ 名前「AWP Crew」で作成',
      '4.「General Information」の Application ID（= DISCORD_APPLICATION_ID）と Public Key（= DISCORD_PUBLIC_KEY）をメモ',
      '5. 左メニュー「Bot」→「Reset Token」→ 表示されたトークン（= DISCORD_BOT_TOKEN）をコピー',
      '6. Render →「awp-backend」→「Environment」に上の5つ（DISCORD_BOT_TOKEN / DISCORD_APPLICATION_ID / DISCORD_PUBLIC_KEY / DISCORD_GUILD_ID / DISCORD_OWNER_ID）を追加して保存 → 再デプロイを待つ',
      '7. 開発者ポータルの「General Information」→「Interactions Endpoint URL」に `https://awp-backend-sm9z.onrender.com/api/crew/discord/interactions` を入れて保存（緑のチェックが出ればOK）',
      '8. 左メニュー「OAuth2」→「URL Generator」で Scopes: bot と applications.commands、Bot Permissions: Manage Channels / Manage Webhooks / Send Messages / Create Public Threads / Send Messages in Threads / Read Message History / Embed Links を選び、下のURLを開いて「AWP 開発」に追加',
      '9. AWPの管理画面 →「ローンチ・クルー」→「Discordを初期設定」を押す → チャンネルが7つできれば完了'
    ].join('\n'),
    acceptance: 'Discordに「🚀 AWP ローンチ」カテゴリと7つのチャンネルができ、/today で今日の予定が表示される'
  },
  {
    key: 'A01', title: '本番用のQAチェックリストを作る（全機能・スマホ375px）', area: 'qa', epic: '品質保証', owner: 'agent', agents: ['tetsu', 'kei'],
    estimateMin: 60, priority: 1, planDay: '2026-10-08',
    acceptance: [
      '- `docs/launch/qa-checklist.md` を新規作成する',
      '- 現在の全機能（登録/SMS・ログイン・パスワード再設定・ウィザード・AIビルダー・プロフィール・発見・タイムライン/投稿・いいね/フォロー・通報・アクセス解析・AIチャットボット・予約リクエスト・商品・収益化/キャッシュ・Harness申込/予約投稿・管理画面の各ページ）を、実際のコード（frontend/src/app, backend/src/routes）を読んで洗い出す',
      '- 機能ごとに「手順」「期待する結果」「確認する画面サイズ（375px）」を、初めての人でも迷わない日本語で書く',
      '- 各項目にチェックボックス（- [ ]）を付け、所要時間の目安（分）を付ける。合計を冒頭に書く',
      '- 本番で個人情報・決済を伴う操作は、テスト用の値の使い方と後片付けの手順も書く'
    ].join('\n')
  },

  // ===== 10/9（金）: 運営の土台 =====
  {
    key: 'T05', title: '本番で自分を管理者にして、管理画面を確認', area: 'ops', epic: '運営の土台', owner: 'user', agents: ['mina'],
    estimateMin: 15, priority: 1, planDay: '2026-10-09',
    steps: [
      '1. 本番（https://awp-frontend-bf17.onrender.com）で自分のアカウントにログインできることを確認',
      '2. Render →「awp-backend」→「Shell」を開き `node scripts/make-admin.js あなたのメールアドレス` を実行',
      '3. ログインし直して /admin を開き、ダッシュボード・AIオペレーター・通報・収益と分配・ローンチ・クルーが開けることを確認'
    ].join('\n'),
    acceptance: '本番の /admin が開け、ローンチ・クルーの画面が見える'
  },
  {
    key: 'T06', title: '運営者情報を決める（特商法・プライバシー・規約に載せる内容）', area: 'legal', epic: '法務', owner: 'user', agents: ['ritsu', 'mina'],
    estimateMin: 30, priority: 0, planDay: '2026-10-09',
    steps: [
      '次の項目を決めて、Discordで `/done task:T06 memo:（内容）` と送ってください。リツが3つのページに反映します（作り話は入れません）。',
      '1. 運営者名（個人なら氏名、法人なら会社名）',
      '2. 運営責任者名',
      '3. 所在地（個人で自宅を出したくない場合の扱い: 「請求があれば遅滞なく開示」と書く方法がある。弁護士に確認しながら決める）',
      '4. 連絡先メールアドレス（問い合わせ・通報・権利侵害の申し出の窓口）',
      '5. 電話番号（同上の扱い）',
      '6. 管轄裁判所（例: 東京地方裁判所）',
      '7. 各ページの制定日（例: 2026年10月28日）'
    ].join('\n'),
    acceptance: 'メモに7項目がそろっている'
  },
  {
    key: 'T07', title: '弁護士にレビューを依頼（規約・プライバシー・収益分配・キャッシュ）', area: 'legal', epic: '法務', owner: 'user', agents: ['ritsu', 'mina'],
    estimateMin: 60, priority: 0, planDay: '2026-10-09',
    steps: [
      '1. IT・ネットサービスに詳しい弁護士を2〜3件探す（弁護士ドットコム等で「利用規約 作成 レビュー」）',
      '2. 依頼内容: 利用規約・プライバシーポリシー・特商法表記のレビュー、収益化（報酬の78%をキャッシュとして付与、AWPの有料機能の支払いにのみ使用、出金は準備中）の資金決済法上の扱い、予約リクエストでの個人情報の扱い',
      '3. 見積りと回答時期を確認し、10/20までに指摘をもらえる先に依頼する',
      '4. 送る資料: 本番の /terms /privacy /legal のURL、docs/launch/legal-brief.md（A02でリツが用意）'
    ].join('\n'),
    acceptance: '依頼先が決まり、回答予定日がわかっている（メモに記入）'
  },
  {
    key: 'T08', title: 'Twilio（SMS認証）を設定', area: 'setup', epic: '運営の土台', owner: 'user', agents: ['mina'],
    estimateMin: 60, priority: 0, planDay: '2026-10-09',
    steps: [
      '1. https://www.twilio.com でアカウント作成（本人確認・支払い情報の登録はあなたが行う）',
      '2. Console のトップで Account SID と Auth Token をメモ',
      '3. 左メニュー「Verify」→「Services」→「Create new」→ 名前「AWP」、チャネル SMS をオン → Service SID（VA で始まる）をメモ',
      '4. Render →「awp-backend」→ TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID を追加して保存',
      '5. 再デプロイ後、本番で新しいアカウントを作り、自分の携帯にSMSが届くことを確認（テストアカウントは確認後に削除）',
      '※ SMS_DEV_MODE は本番では絶対に設定しない'
    ].join('\n'),
    acceptance: '本番の新規登録で、SMSの確認コードが届いて登録できる'
  },
  {
    key: 'T09', title: 'Gemini APIキーを作り直して差し替え', area: 'setup', epic: '運営の土台', owner: 'user', agents: ['mina'],
    estimateMin: 15, priority: 2, planDay: '2026-10-09',
    steps: [
      '1. https://aistudio.google.com/apikey で古いキーを削除し、新しいキーを作成',
      '2. Render →「awp-backend」→ GEMINI_API_KEY を新しいキーに更新して保存'
    ].join('\n'),
    acceptance: '古いキーが無効になり、新しいキーが設定されている'
  },
  {
    key: 'A02', title: '公開チェックリスト・当日の手順・障害時の切り戻し手順と、弁護士向け説明資料を作る', area: 'ops', epic: '運営の土台', owner: 'agent', agents: ['mina', 'ritsu', 'kei'],
    estimateMin: 60, priority: 1, planDay: '2026-10-09',
    acceptance: [
      '- `docs/launch/runbook.md`: Go/No-Go の判定基準（必須の設定・法務・QAの合格条件）、公開当日のタイムライン、監視する項目、障害時の切り戻し（Renderで前のデプロイに戻す手順、緊急停止の使い方）を書く',
      '- `docs/launch/legal-brief.md`: 弁護士に渡す説明資料。サービス概要、取得する個人情報と保存期間（コードの実装どおり）、外部送信先、収益化とキャッシュの仕組み（78/22・AWP内の支払いのみ・出金準備中）、予約リクエスト、AIの利用箇所を、実装を読んで正確に書く。推測で書かない',
      '- どちらも運営者情報は【】のまま残し、作らない'
    ].join('\n')
  },
  {
    key: 'A03', title: 'アカウント削除とデータの持ち出しを検証・修正（新しいデータすべて）', area: 'dev', epic: '運営の土台', owner: 'agent', agents: ['sora', 'kei'],
    estimateMin: 90, priority: 1, planDay: '2026-10-09',
    acceptance: [
      '- backend/src/routes/auth.ts のアカウント削除で、本人のすべてのデータ（ページ・写真・商品・予約・チャットボットの質問・投稿・いいね・フォロー・ビルダー・Harness接続・ウォレットの履歴の扱い）が削除される、または規約どおりに扱われることを確認し、漏れを直す',
      '- 台帳（LedgerEntry）は会計記録のため削除せず、個人を特定する情報を持たないことを確認する（必要ならコメントで理由を残す）',
      '- /api/export に本人のデータがすべて含まれることを確認し、漏れを直す',
      '- 削除が途中で失敗しても中途半端にならないよう、トランザクションで実行する'
    ].join('\n')
  },

  // ===== 10/10（土）: ドメイン・提携・法務反映 =====
  {
    key: 'A04', title: '運営者情報を特商法・プライバシー・利用規約に反映', area: 'legal', epic: '法務', owner: 'agent', agents: ['ritsu', 'kei'],
    estimateMin: 45, priority: 0, planDay: '2026-10-10', dependsOn: ['T06'],
    acceptance: [
      '- 依存タスクT06のメモにある運営者情報だけを使い、frontend/src/app/legal・privacy・terms の【】を置き換える',
      '- メモにない項目は【】のまま残し、作らない。残った【】の一覧をPRの説明に書く',
      '- 制定日を3ページで揃える'
    ].join('\n')
  },
  {
    key: 'T10', title: '独自ドメインを決めて取得', area: 'setup', epic: 'ドメイン', owner: 'user', agents: ['mina'],
    estimateMin: 45, priority: 1, planDay: '2026-10-10',
    steps: [
      '1. 候補を3つ考える（短く・覚えやすく・AWPらしく。例: awp.jp, awp-world.com）',
      '2. XServerドメイン等で空きを確認して取得（支払いはあなたが行う）',
      '3. 取得したドメインを `/done task:T10 memo:ドメイン名` で送る'
    ].join('\n'),
    acceptance: 'ドメインを取得し、メモにドメイン名がある'
  },
  {
    key: 'T11', title: 'ドメインをRenderにつなぎ、URLの設定を更新', area: 'setup', epic: 'ドメイン', owner: 'user', agents: ['mina', 'sora'],
    estimateMin: 60, priority: 1, planDay: '2026-10-10', dependsOn: ['T10'],
    steps: [
      '1. Render →「awp-frontend」→「Settings」→「Custom Domains」→ 取得したドメイン（例: awp.jp と www.awp.jp）を追加',
      '2. 表示されたDNSの設定（CNAME/A）を、ドメインを買った会社の管理画面に登録',
      '3. Renderで「Verified」になり、証明書（https）が発行されるのを待つ（数分〜数時間）',
      '4. awp-frontend の SITE_URL / MAIN_HOSTS、awp-backend の SITE_URL / FRONTEND_URL を新しいドメインに更新して保存',
      '5. https://新ドメイン が開けることを確認'
    ].join('\n'),
    acceptance: '新しいドメインでサイトが https で開き、ログイン・ページ公開ができる'
  },
  {
    key: 'T12', title: 'ASP（A8.netなど）に登録し、サイト審査を申請', area: 'content', epic: '収益', owner: 'user', agents: ['mina', 'ritsu'],
    estimateMin: 60, priority: 1, planDay: '2026-10-10',
    steps: [
      '1. A8.net（ほか、もしもアフィリエイト・バリューコマース）にメディア会員として登録（本人情報・口座はあなたが入力）',
      '2. 登録するサイト: AWPの本番URL（ドメイン取得後はそちら）',
      '3. サイト審査の結果を待つ（数日）'
    ].join('\n'),
    acceptance: '登録と審査申請が完了'
  },
  {
    key: 'T13', title: 'Harness導入支援の料金を決めて登録', area: 'content', epic: '収益', owner: 'user', agents: ['mina'],
    estimateMin: 30, priority: 2, planDay: '2026-10-11',
    steps: [
      '1. /admin/harness を開き、各メニュー（導入・ボット・自動投稿など）の料金を決めて入力',
      '2. 料金が決まらないメニューは空欄（＝表示しない）のままでOK',
      '3. 公開してよいメニューを「表示」にする'
    ].join('\n'),
    acceptance: '公開するメニューに料金が入っている'
  },

  // ===== 10/11〜10/14: 公開に必要な機能（スプリント1） =====
  {
    key: 'A05', title: 'アプリ内のお知らせ（通知センター）', area: 'dev', epic: '通知', owner: 'agent', agents: ['sora', 'kei', 'tetsu'],
    estimateMin: 180, priority: 0, planDay: '2026-10-11',
    acceptance: [
      '- 通知のモデル（受け取る人・種類・本文・リンク・既読）を追加し、次の出来事で通知を作る: 予約リクエストの到着・取り消し、フォローされた、ページにいいね、通報への対応結果（自分のコンテンツが非公開になった）、収益の分配',
      '- ヘッダー（ログイン後の画面）にベルと未読数、/notifications に一覧（スマホで見やすく）。開いたら既読',
      '- 通知の文面に、相手の連絡先などの個人情報を入れない',
      '- 90日を過ぎた通知は自動で削除',
      COMMON_RULES
    ].join('\n')
  },
  {
    key: 'A06', title: '新規登録後のはじめかたガイド（オンボーディング）', area: 'dev', epic: 'はじめての体験', owner: 'agent', agents: ['sora', 'haru', 'kei'],
    estimateMin: 150, priority: 0, planDay: '2026-10-12', dependsOn: ['A05'],
    acceptance: [
      '- 登録直後に、4ステップ（①AIとおしゃべりでページを作る ②プロフィールを作る ③公開してURLを共有 ④発見でほかの人のページを見る）の進み具合カードをダッシュボードの最上部に表示',
      '- 各ステップは実際のデータ（ページ・ユーザー名・共有ボタンの利用・発見の閲覧）から完了を判定し、全部終わったらカードを消せる',
      '- ポップで親しみやすい日本語。強制はしない（あとで、で閉じられる）',
      COMMON_RULES
    ].join('\n')
  },
  {
    key: 'A07', title: 'トップページを新しいプラットフォームの内容に刷新', area: 'content', epic: 'はじめての体験', owner: 'agent', agents: ['haru', 'ritsu', 'sora', 'kei'],
    estimateMin: 180, priority: 0, planDay: '2026-10-13',
    acceptance: [
      '- frontend/src/app/page.tsx を、実装済みの機能（AIとおしゃべりでページ作成・プロフィール・発見とタイムライン・予約リクエスト・商品・AIチャットボット・アクセス解析・収益化（PR枠・78%還元）・Harness連携）を伝える構成にする',
      '- ミッション「世界を動かすリーダーの一人にあなたもなりましょう！」と現在のブランド（ロゴ・グラデーション）を維持',
      '- 実績・利用者数・お客様の声など、事実がないものは書かない。収益化は「確定した報酬の78%」と正確に書き、必ず稼げるような表現をしない',
      '- 既存のFAQは置かない（運営者の方針）',
      COMMON_RULES
    ].join('\n')
  },
  {
    key: 'A08', title: 'セキュリティ総点検', area: 'dev', epic: '品質保証', owner: 'agent', agents: ['kei', 'sora'],
    estimateMin: 150, priority: 0, planDay: '2026-10-11',
    acceptance: [
      '- backend/src/routes の全エンドポイントを一覧にし、認証・本人確認（他人のデータを操作できないか）・管理者チェック・入力の長さ制限・レート制限を確認して、漏れを直す。一覧と結果を docs/launch/security-review.md に残す',
      '- セキュリティヘッダー（X-Content-Type-Options, Referrer-Policy, フレーム埋め込み制限など）をフロントとAPIに設定（公開ページの機能を壊さない範囲で）',
      '- npm audit（backend/frontend）で重大な脆弱性を確認し、互換性を壊さない範囲で更新。更新できないものは理由を記録',
      '- 本番で ENABLE_DEV_LOGIN / SMS_DEV_MODE が有効なら起動時に警告ログを出す'
    ].join('\n')
  },
  {
    key: 'A09', title: '共有したときの見栄え（OGP画像）を自動で作る', area: 'dev', epic: 'はじめての体験', owner: 'agent', agents: ['sora', 'haru', 'kei'],
    estimateMin: 120, priority: 1, planDay: '2026-10-14',
    acceptance: [
      '- 公開ページ（/[slug]）とプロフィール（/ユーザー名）に、Next.js の opengraph-image で 1200x630 の画像を自動生成（名前・キャッチコピー・AWPのロゴ）',
      '- メイン画像があるページはそれを使い、なければブランドのグラデーション',
      '- X・LINE・Instagramで共有したときに画像が出ることを、メタタグで確認できること',
      COMMON_RULES
    ].join('\n')
  },
  {
    key: 'A10', title: 'ベータテスター向けの案内文と、フィードバックの受け取り方を用意', area: 'content', epic: 'ベータテスト', owner: 'agent', agents: ['haru', 'ritsu'],
    estimateMin: 45, priority: 1, planDay: '2026-10-14',
    acceptance: [
      '- docs/launch/beta.md に、テスターへの声かけ文（LINE/DM用の短文と、詳しい案内）、試してほしいこと（10分で終わるコース）、不具合の送り方を書く',
      '- 「必ず稼げる」などの誇張をしない。テスト中の不具合やデータ消去の可能性を正直に書く'
    ].join('\n')
  },
  {
    key: 'T14', title: '公式SNSアカウント（X・Instagram）を準備', area: 'content', epic: 'ローンチ告知', owner: 'user', agents: ['haru', 'mina'],
    estimateMin: 60, priority: 2, planDay: '2026-10-12',
    steps: [
      '1. X と Instagram で AWP の公式アカウントを作成（アカウント作成はあなたが行う）',
      '2. アイコンはAWPのロゴ（/admin/assets）、プロフィール文はハルに /ask で頼めます',
      '3. プロフィールに本番のURLを入れる'
    ].join('\n'),
    acceptance: '公式アカウントがあり、プロフィールにURLが入っている'
  },

  // ===== 10/15〜10/18: スプリント2・ベータ開始 =====
  {
    key: 'T15', title: 'ASPで提携申請し、規約で「報酬の分配」が可能か確認', area: 'content', epic: '収益', owner: 'user', agents: ['ritsu', 'mina'],
    estimateMin: 60, priority: 1, planDay: '2026-10-15', dependsOn: ['T12'],
    steps: [
      '1. 審査に通ったASPで、予約・ネットショップ・ドメインなど、AWPの利用者に役立つ広告主に提携申請',
      '2. 各広告主の規約で「第三者のサイト（利用者のページ）への掲載」と「報酬の分配（還元）」が許可されているかを確認',
      '3. 許可が明記されていないものは「分配OK」にしない（AWP自身の紹介だけに使う）',
      '4. 確認結果を `/done task:T15 memo:広告主ごとの可否` で送る'
    ].join('\n'),
    acceptance: '広告主ごとの分配可否がメモにある'
  },
  {
    key: 'A11', title: '運営のKPIダッシュボード', area: 'dev', epic: '運営の土台', owner: 'agent', agents: ['sora', 'kei'],
    estimateMin: 120, priority: 1, planDay: '2026-10-15',
    acceptance: [
      '- /admin のダッシュボードに、直近30日の日別推移（新規登録・公開ページ数・投稿数・予約リクエスト数・通報数・確定報酬）をグラフで表示',
      '- 個人を特定する情報は出さない。集計クエリはインデックスを使い、重くならないこと',
      COMMON_RULES
    ].join('\n')
  },
  {
    key: 'A12', title: '主要な導線の自動テスト（E2E）', area: 'qa', epic: '品質保証', owner: 'agent', agents: ['tetsu', 'kei'],
    estimateMin: 180, priority: 1, planDay: '2026-10-15',
    acceptance: [
      '- Playwright で、ローカル環境に対して次を自動で確認するテストを追加: ログイン（開発用の方法）→ ページ作成（ウィザード）→ 公開ページ表示 → 予約リクエスト送信 → 持ち主が確定 → 状況確認ページに反映、投稿 → タイムライン表示、いいね・フォロー',
      '- 375x812 の画面サイズで実行。テストで作ったデータは最後に削除',
      '- GitHub Actions で PR ごとに実行するワークフローを追加（本番の秘密情報は使わない）'
    ].join('\n')
  },
  {
    key: 'T16', title: 'QAラウンド1（本番・スマホで全機能を確認）', area: 'qa', epic: '品質保証', owner: 'user', agents: ['tetsu', 'mina'],
    estimateMin: 150, priority: 0, planDay: '2026-10-16', dependsOn: ['A01', 'T08'],
    steps: [
      '1. docs/launch/qa-checklist.md（テツが作成）を上から順に、スマホで実施',
      '2. うまくいかないものは、その場で `/bug detail:（画面・操作・結果）` で報告 → 修正タスクになり、エージェントが対応します',
      '3. テスト用に作ったデータは、チェックリストの後片付け手順どおりに削除'
    ].join('\n'),
    acceptance: 'チェックリストを最後まで実施し、不具合はすべて /bug で報告済み'
  },
  {
    key: 'T17', title: 'ベータテスターを5〜10人募集して案内を送る', area: 'content', epic: 'ベータテスト', owner: 'user', agents: ['haru', 'mina'],
    estimateMin: 60, priority: 0, planDay: '2026-10-16', dependsOn: ['A10'],
    steps: [
      '1. docs/launch/beta.md の声かけ文で、知り合いのクリエイター・個人事業主に声をかける',
      '2. 参加してくれる人に、詳しい案内（試してほしいこと・不具合の送り方）を送る',
      '3. 人数を `/done task:T17 memo:◯人` で送る'
    ].join('\n'),
    acceptance: '5人以上に案内を送った'
  },
  {
    key: 'A13', title: '使い方ガイドページ', area: 'content', epic: 'はじめての体験', owner: 'agent', agents: ['haru', 'kei'],
    estimateMin: 90, priority: 2, planDay: '2026-10-16',
    acceptance: [
      '- /guide に、機能ごとの短い使い方（できること・手順3つ以内・関連画面へのリンク）を、実装どおりに書く',
      '- 予約・商品・収益化など、お金や個人情報に関わる機能は注意点も書く',
      COMMON_RULES
    ].join('\n')
  },
  {
    key: 'A14', title: '404・エラー・空っぽの画面の表示を統一', area: 'dev', epic: 'はじめての体験', owner: 'agent', agents: ['sora', 'haru', 'kei'],
    estimateMin: 90, priority: 2, planDay: '2026-10-17',
    acceptance: [
      '- not-found.tsx・error.tsx を用意し、ブランドに合ったポップな文言と、ホーム・発見へのボタンを置く',
      '- 主要画面の「まだ〇〇がありません」表示に、次にやることへのボタンを付ける',
      COMMON_RULES
    ].join('\n')
  },
  {
    key: 'A15', title: '表示速度の点検（クエリ・インデックス・画像）', area: 'dev', epic: '品質保証', owner: 'agent', agents: ['sora', 'kei'],
    estimateMin: 120, priority: 1, planDay: '2026-10-18',
    acceptance: [
      '- 発見・タイムライン・アクセス解析・公開ページのAPIで、遅くなりうるクエリを洗い出し、必要なインデックスをマイグレーションで追加',
      '- 画像の配信にキャッシュ設定があるか確認し、なければ追加',
      '- 変更前後の確認方法と結果を PR に書く'
    ].join('\n')
  },
  {
    key: 'A16', title: '本番の設定チェックを管理画面に追加', area: 'ops', epic: '運営の土台', owner: 'agent', agents: ['sora', 'kei'],
    estimateMin: 60, priority: 1, planDay: '2026-10-18',
    acceptance: [
      '- /admin に「公開前チェック」を追加: 必須の環境変数がそろっているか（値は表示しない）、開発用の設定が無効か、運営者情報の【】が残っていないか、Twilio・ドメイン・Discord・GitHubの接続を、OK/要対応で表示',
      COMMON_RULES
    ].join('\n')
  },

  // ===== 10/19〜10/24: ベータ週間・仕上げ =====
  {
    key: 'T18', title: 'ベータテスターの声を集めて報告', area: 'content', epic: 'ベータテスト', owner: 'user', agents: ['tetsu', 'mina'],
    estimateMin: 60, priority: 0, planDay: '2026-10-21', dependsOn: ['T17'],
    steps: [
      '1. テスターに使ってみた感想と困ったことを聞く',
      '2. 不具合は `/bug`、改善の要望は `/add` で登録（優先度はミナが整理します）'
    ].join('\n'),
    acceptance: '集めた声がすべて /bug か /add に登録されている'
  },
  {
    key: 'T19', title: '弁護士の指摘を受け取り、共有', area: 'legal', epic: '法務', owner: 'user', agents: ['ritsu', 'mina'],
    estimateMin: 30, priority: 0, planDay: '2026-10-20', dependsOn: ['T07'],
    steps: ['1. 弁護士の指摘を受け取る', '2. 指摘の内容を `/done task:T19 memo:（要点）` で送る（長い場合は要点だけ。原文はあなたが保管）'].join('\n'),
    acceptance: '指摘の要点がメモにある'
  },
  {
    key: 'A17', title: '弁護士の指摘を規約・ポリシー・画面に反映', area: 'legal', epic: '法務', owner: 'agent', agents: ['ritsu', 'sora', 'kei'],
    estimateMin: 120, priority: 0, planDay: '2026-10-21', dependsOn: ['T19'],
    acceptance: [
      '- 依存タスクT19のメモにある指摘だけを反映する（指摘にないことは変えない）',
      '- 規約・ポリシーの変更点の一覧をPRの説明に書く',
      COMMON_RULES
    ].join('\n')
  },
  {
    key: 'T20', title: 'QAラウンド2（修正の確認とベータの指摘）', area: 'qa', epic: '品質保証', owner: 'user', agents: ['tetsu', 'mina'],
    estimateMin: 120, priority: 0, planDay: '2026-10-22', dependsOn: ['T16'],
    steps: ['1. ラウンド1で報告した不具合が直っているか確認', '2. チェックリストのうち、変更があった機能をもう一度確認', '3. 新しい不具合は /bug で報告'].join('\n'),
    acceptance: 'ラウンド1の不具合がすべて解消、または対応方針が決まっている'
  },
  {
    key: 'T21', title: 'ASPのリンクを提携ツールに登録（分配OKの設定）', area: 'content', epic: '収益', owner: 'user', agents: ['ritsu', 'mina'],
    estimateMin: 45, priority: 1, planDay: '2026-10-22', dependsOn: ['T15'],
    steps: ['1. /admin/tools で、提携できたサービスのアフィリエイトURLを登録', '2. T15で「分配OK」と確認できたものだけ「報酬の分配OK」にチェック', '3. 説明文は公式サイトで確認できる事実だけを書く'].join('\n'),
    acceptance: '提携できたサービスが登録され、分配OKは規約で許可されたものだけ'
  },
  {
    key: 'A18', title: 'ローンチ告知文一式（X・Instagram・note・プレスリリース草案）', area: 'content', epic: 'ローンチ告知', owner: 'agent', agents: ['haru', 'ritsu', 'kei'],
    estimateMin: 90, priority: 1, planDay: '2026-10-23',
    acceptance: [
      '- docs/launch/announcements.md に、公開日の告知（X 3本・Instagram 2本・note 記事1本・プレスリリース草案1本）を書く',
      '- 機能は実装どおりに説明。利用者数・実績・「必ず稼げる」などは書かない。収益化は「確定した報酬の78%」と正確に',
      '- ハッシュタグ・投稿予定時刻の案も付ける'
    ].join('\n')
  },
  {
    key: 'T22', title: '本番データのバックアップと復元方法を確認', area: 'ops', epic: '運営の土台', owner: 'user', agents: ['mina'],
    estimateMin: 30, priority: 1, planDay: '2026-10-24',
    steps: ['1. Render →「awp-db」→「Backups」で自動バックアップが有効か確認', '2. docs/launch/runbook.md の復元手順を読み、手順どおりにできるか確認（実際の復元は行わない）'].join('\n'),
    acceptance: 'バックアップが有効で、復元手順を理解している'
  },
  {
    key: 'T23', title: 'QAラウンド3（最終確認）', area: 'qa', epic: '品質保証', owner: 'user', agents: ['tetsu', 'mina'],
    estimateMin: 90, priority: 0, planDay: '2026-10-25', dependsOn: ['T20'],
    steps: ['1. チェックリストの「最重要」項目をすべて確認', '2. 新しいドメインで、登録→ページ公開→共有→予約まで一通り'].join('\n'),
    acceptance: '最重要項目がすべて合格'
  },

  // ===== 10/26〜10/28: 凍結・判定・公開 =====
  {
    key: 'T24', title: '告知文の最終確認と予約投稿', area: 'content', epic: 'ローンチ告知', owner: 'user', agents: ['haru', 'mina'],
    estimateMin: 60, priority: 1, planDay: '2026-10-26', dependsOn: ['A18', 'T14'],
    steps: ['1. docs/launch/announcements.md を読み、自分の言葉に直す', '2. 公式SNSで10/28の投稿を予約（Harness連携を使ってもOK）'].join('\n'),
    acceptance: '10/28の告知が予約されている'
  },
  {
    key: 'T25', title: 'Go/No-Go 判定', area: 'launch', epic: '公開', owner: 'user', agents: ['mina', 'kei', 'ritsu'],
    estimateMin: 30, priority: 0, planDay: '2026-10-27', dependsOn: ['T23', 'A17'],
    steps: ['1. 管理画面の「公開前チェック」がすべてOKか確認', '2. docs/launch/runbook.md の判定基準を1つずつ確認', '3. 公開する／延期するを決めて `/done task:T25 memo:Go または No-Go（理由）`'].join('\n'),
    acceptance: '判定結果がメモにある'
  },
  {
    key: 'T26', title: '🚀 公開！告知と最初の2時間の見守り', area: 'launch', epic: '公開', owner: 'user', agents: ['mina', 'haru', 'tetsu'],
    estimateMin: 120, priority: 0, planDay: '2026-10-28', dependsOn: ['T25'],
    steps: ['1. 予約した告知が投稿されたか確認', '2. Discordの #🚨-アラート と管理画面のエラー監視を見守る', '3. 不具合は /bug、緊急時は runbook の切り戻し手順へ'].join('\n'),
    acceptance: '公開し、最初の2時間に重大な問題がない'
  },
  // ===== 追加: 自前の請求・直接払いショップ・独自ドメインの条件（10/8 追加） =====
  {
    key: 'T27', title: '弁護士への依頼に「直接払いショップ・独自ドメインの条件・有料プラン」を追加', area: 'legal', epic: '法務', owner: 'user', agents: ['ritsu', 'mina'],
    estimateMin: 15, priority: 0, planDay: '2026-10-09', dependsOn: ['T07'],
    steps: [
      'T07で依頼する弁護士に、次の3点も確認してもらう（docs/launch/legal-brief.md にリツが追記します）',
      '1. 直接払いショップ: 代金は購入者→出品者の口座へ直接（AWPは預からない・販売手数料0円）。AWPは場の提供者で、出品者が特定商取引法の表記を掲示する。個人の出品者の「請求があれば開示」表示の扱い',
      '2. 独自ドメイン: 提携リンクから取得すれば無料、それ以外は有料プラン必須という条件の表示',
      '3. 有料プラン: 銀行振込・キャッシュでの前払い、自動更新なし、返金なし、AIの利用枠（料金の78%）の説明'
    ].join('\n'),
    acceptance: '追加の確認事項を弁護士に伝えた'
  },
  {
    key: 'T28', title: '有料プランの振込先口座と料金を確認・登録', area: 'setup', epic: '収益', owner: 'user', agents: ['mina'],
    estimateMin: 20, priority: 1, planDay: '2026-10-10',
    steps: [
      '1. 管理画面 →「プランと請求」を開く',
      '2. 「AWPの振込先」に、プランの代金を受け取る口座を登録（暗号化して保存され、振込で申し込んだ人にだけ表示されます）',
      '3. 「料金の設定」で、基準（Claude Pro の月額 $20）・為替・倍率を確認。初期値はライト 1,500円／スタンダード 3,000円／プロ 9,000円',
      '4. 振込の入金を確認したら、同じ画面の「入金を確認・有効化」を押す運用になります'
    ].join('\n'),
    acceptance: '振込先が登録され、料金が決まっている'
  },
  {
    key: 'T29', title: 'ドメイン登録サービスを提携ツールに登録（無料の独自ドメイン用）', area: 'content', epic: '収益', owner: 'user', agents: ['ritsu', 'mina'],
    estimateMin: 20, priority: 1, planDay: '2026-10-22', dependsOn: ['T15'],
    steps: [
      '1. ASPで提携できたドメイン登録サービス（XServerドメインなど）の成果測定リンクを用意',
      '2. 管理画面 →「提携ツール」で登録し、「ドメインの登録サービス」にチェック',
      '3. 「登録事業者名」に、そのサービスの登録事業者名の一部（例: Xserver）を入れる（ドメインの公開情報と照合して自動で無料にするため）',
      '4. .jp など自動で確認できないドメインは「独自ドメイン」画面に確認待ちとして出るので、ASPの成果と照らして承認する'
    ].join('\n'),
    acceptance: 'ドメイン登録サービスが「独自ドメイン」画面に表示される'
  },
  {
    key: 'A19', title: 'ショップの注文・プランの通知をお知らせ（通知センター）に流し、E2Eテストを追加', area: 'dev', epic: '通知', owner: 'agent', agents: ['sora', 'tetsu', 'kei'],
    estimateMin: 120, priority: 1, planDay: '2026-10-15', dependsOn: ['A05', 'A12'],
    acceptance: [
      '- 新しい注文・注文の取り消し・プランの有効化・独自ドメインの確認結果を、A05の通知センターに出す（個人情報は本文に入れない）',
      '- Playwright で、ショップ設定 → 商品を購入可能に → 注文 → 出品者が入金確認・発送 → 購入者の状況ページに反映、の流れを自動テストに追加（375x812）',
      COMMON_RULES
    ].join('\n')
  }
];

export async function seedCrewTasks() {
  let added = 0;
  for (const t of SEED) {
    const exists = await prisma.crewTask.findUnique({ where: { key: t.key }, select: { key: true } });
    if (exists) continue;
    await prisma.crewTask.create({
      data: {
        key: t.key, title: t.title, area: t.area, epic: t.epic, owner: t.owner, agents: t.agents,
        estimateMin: t.estimateMin, remainingMin: t.estimateMin, priority: t.priority, planDay: t.planDay, dueDay: t.dueDay ?? null,
        dependsOn: t.dependsOn ?? [], steps: t.steps ?? null, acceptance: t.acceptance
      }
    });
    added++;
  }
  return added;
}
