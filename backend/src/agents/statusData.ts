// システムの実装進捗を表す、手動で管理するチェックリスト。
// 進捗報告担当エージェント（backend/src/agents/statusReport.ts）が、このデータと
// DBから取得した実際の稼働状況を組み合わせてレポートを作成する。
// 機能の実装状況は開発者（Claude）が実際のコードを把握した上で記録するもので、
// AIに「進捗を推測させる」ことはしない（事実に基づかない報告を防ぐため）。

export type FeatureStatus = 'done' | 'partial' | 'blocked' | 'not_started';

export type FeatureItem = {
  category: string;
  name: string;
  status: FeatureStatus;
  note?: string;
};

export const STATUS_LABEL: Record<FeatureStatus, string> = {
  done: '完了',
  partial: '一部完了',
  blocked: 'ユーザー作業待ち',
  not_started: '未着手'
};

export const FEATURE_CHECKLIST: FeatureItem[] = [
  // ---- LP/HP ビルダー ----
  { category: 'LP/HPビルダー', name: 'ウィザードによるLP/HP作成（お店・ビジネス／クリエイターを選択）', status: 'done' },
  { category: 'LP/HPビルダー', name: 'AIによる文章・デザイン作成（目的に合わせた書き分け）', status: 'done' },
  { category: 'LP/HPビルダー', name: '追加機能セクション（メニュー・FAQ・アクセス等）', status: 'done' },
  { category: 'LP/HPビルダー', name: '写真・ロゴのアップロード管理', status: 'partial', note: '管理画面での管理のみ。公開ページへの表示（ギャラリー等）は未実装' },
  { category: 'LP/HPビルダー', name: '見出しのA/Bテスト', status: 'done' },
  { category: 'LP/HPビルダー', name: 'AWPドメイン上での無料公開・URLのシェア', status: 'done' },
  { category: 'LP/HPビルダー', name: 'LINEボタン（持ち主の友だち追加URLへ）', status: 'done' },
  { category: 'LP/HPビルダー', name: '独自ドメイン接続', status: 'partial', note: '設定画面は実装済み。Render上での顧客ドメインの自動登録（証明書発行）は未実装' },
  { category: 'LP/HPビルダー', name: 'ワイルドカードサブドメイン（{名前}.本ドメイン）', status: 'blocked', note: 'コードは実装済み。AWP自身のドメイン取得・DNS設定が必要' },
  { category: 'LP/HPビルダー', name: 'データの書き出し（AWPからの独立性）', status: 'done' },

  // ---- スマホアプリ・ブランド ----
  { category: 'スマホ・ブランド', name: 'スマホアプリ化（ホーム画面に追加・下部タブバー・アプリアイコン）', status: 'done' },
  { category: 'スマホ・ブランド', name: 'ブランド刷新（ポップな文言・理念・黄金比ロゴ・日本中心の地球）', status: 'done' },
  { category: 'スマホ・ブランド', name: 'トップページのスマホ見本（美容院サイト）', status: 'partial', note: '本番の写真は管理画面でAI生成が必要（未生成の間はグラデーション表示）' },
  { category: 'スマホ・ブランド', name: 'ネイティブアプリ（Expo）', status: 'partial', note: 'ホーム・作成・AIエージェント・設定は実装済み。SMS認証の新しい登録手順と新機能への対応が未了' },
  { category: 'スマホ・ブランド', name: 'App Store / Google Play 公開', status: 'blocked', note: '開発者アカウント登録（有料）・アプリIDの決定が必要' },

  // ---- アカウント・セキュリティ ----
  { category: 'アカウント・セキュリティ', name: 'SMS認証（電話番号の本人確認・1番号1アカウント）', status: 'blocked', note: 'コードは完成。本番で有効にするにはTwilioの契約と設定が必要' },
  { category: 'アカウント・セキュリティ', name: 'パスワード再設定（SMSのコード）', status: 'blocked', note: 'SMS認証と同じくTwilioの設定待ち。再設定時は過去のログインを無効化' },
  { category: 'アカウント・セキュリティ', name: '本番の管理者アカウント', status: 'blocked', note: 'RenderのShellで make-admin を実行する必要あり' },
  { category: 'アカウント・セキュリティ', name: '既存アカウントへの電話番号登録', status: 'not_started', note: '電話番号のないアカウントはパスワード再設定が使えない' },

  // ---- 集客チャネル ----
  { category: '集客チャネル', name: 'LINE公式アカウント連携・自動応答', status: 'partial', note: '実装済み。自動応答は有料プラン向けのため、有料プランの保留中は利用不可' },
  { category: '集客チャネル', name: 'SNS連携（X/Instagram/Facebook/TikTok）OAuth', status: 'blocked', note: 'コードは実装済み。各社の開発者アプリ登録が必要' },
  { category: '集客チャネル', name: 'SEO（サイトマップ・robots.txt・構造化データ・IndexNow）', status: 'done' },

  // ---- AIエージェント（自動運用） ----
  { category: 'AIエージェント', name: 'マーケティング下書き作成（プラットフォーム別）', status: 'done' },
  { category: 'AIエージェント', name: 'コンプライアンス審査（誇張・捏造の自動チェック）', status: 'done' },
  { category: 'AIエージェント', name: '成長分析・改善提案', status: 'done' },
  { category: 'AIエージェント', name: 'システム監視・障害診断', status: 'done', note: '診断のみ。コード自動修正・自動デプロイは意図的に非対応' },
  { category: 'AIエージェント', name: 'AWP自己PR（自社集客）・X週間キャンペーン', status: 'done' },
  { category: 'AIエージェント', name: 'ブラウザ操作の自動化ワークフロー', status: 'done', note: '認証情報系の操作は安全のため禁止' },
  { category: 'AIエージェント', name: '進捗報告エージェント', status: 'partial', note: '手動実行のみ。エージェントループへの組み込みは未着手' },

  // ---- 運営（管理者画面） ----
  { category: '運営', name: '運営者画面（ダッシュボード・要対応・設定の状態）', status: 'done' },
  { category: '運営', name: '緊急コントロール（AIエージェント・SNS予約投稿の停止／再開）', status: 'done' },
  { category: '運営', name: 'AIオペレーター（対話で状況確認・課題整理・提案。実行は承認後）', status: 'done' },
  { category: '運営', name: 'AIによる開発（承認した提案をClaude CodeがGitHubで実装→プルリクエスト）', status: 'blocked', note: 'GitHubのトークン・Actionsの秘密情報・Claude GitHub Appの設定が必要' },

  // ---- 収益 ----
  { category: '収益', name: '提携ツールのカタログ・アフィリエイト導線・クリック計測', status: 'done' },
  { category: '収益', name: 'ASP提携とアフィリエイトリンクの登録', status: 'blocked', note: '運営者のASP登録・各プログラムとの提携が必要' },
  { category: '収益', name: 'Harness（LINE/X/IG）導入支援：選んで申し込む画面・運営者の管理画面', status: 'done' },
  { category: '収益', name: 'Harness導入支援のメニュー料金設定', status: 'blocked', note: '運営者が管理画面で料金を入力するまでユーザーに表示されない' },
  { category: '収益', name: '決済（Harness申し込み・有料プラン）', status: 'not_started', note: '決済方法は後から追加する方針。Stripeのコード基盤は実装済み' },
  { category: '収益', name: 'AIの投稿を顧客のX/IG Harnessへ予約する連携（/harness/post）', status: 'done', note: 'APIはHarnessのソースコードで確認。接続先は *.workers.dev のみ・APIキーは暗号化保存' },

  // ---- 法務 ----
  { category: '法務', name: '特定商取引法・プライバシーポリシーの運営者情報', status: 'blocked', note: '運営者の実在情報が必要（捏造不可）。有料サービス・ASP審査の前提' },

  // ---- インフラ・デプロイ ----
  { category: 'インフラ・デプロイ', name: 'Render本番デプロイ（3サービス有料プランで常時稼働）', status: 'done' },
  { category: 'インフラ・デプロイ', name: '本番用の環境変数整備（DEV_LOGIN無効化・URL・AIキー）', status: 'done' },
  { category: 'インフラ・デプロイ', name: '独自ドメインの取得', status: 'blocked', note: '運営者が取得・DNS設定' },
  { category: 'インフラ・デプロイ', name: 'Gemini APIキーの作り直し（画面に映ったため）', status: 'blocked', note: '運営者がGoogle AI Studioで再発行' },

  // ---- 将来構想 ----
  { category: '将来構想', name: '個人向けセルフパブリッシング（ブログ・リール等）', status: 'not_started' },

  { category: 'プラットフォーム', name: 'プロフィール（/ユーザー名）・フォロー・いいね・発見（新着/人気/フォロー中/検索）', status: 'done' },
  { category: 'プラットフォーム', name: '通報と運営による非公開（/admin/reports）・利用規約', status: 'partial', note: '利用規約の【】（運営者情報・管轄裁判所）の記入と弁護士確認が必要' },
  { category: 'プラットフォーム', name: '対話型AIページビルダー（事実の出どころ管理・未確定の事実は公開しない）', status: 'done' },
  { category: 'プラットフォーム', name: '収益化（PR枠）・複式簿記の台帳・78/22分配・キャッシュでの支払い', status: 'done', note: '報酬は運営者がASPで確定を確認して記録する。分配は規約で認められた案件（分配OK）だけ' },
  { category: 'プラットフォーム', name: 'キャッシュの出金（銀行振込）', status: 'blocked', note: 'Stripe Connect等の送金基盤・本人確認・税務（支払調書・インボイス）の確認が必要。弁護士・税理士への相談推奨' },
  { category: 'プラットフォーム', name: 'アクセス解析（閲覧・クリック・流入元）・おすすめ表示', status: 'done' },
  { category: 'プラットフォーム', name: 'ページのAIチャットボット（確定情報のみで回答・答えられなかった質問の可視化）', status: 'done' },
  { category: 'プラットフォーム', name: '予約リクエスト（受付・確定/お断り・訪問者の状況確認ページ）', status: 'done', note: '決済なし。空き枠の自動管理は未実装' },
  { category: 'プラットフォーム', name: '商品カタログ（購入は持ち主のネットショップへ）', status: 'done' },
  { category: 'プラットフォーム', name: '投稿・タイムライン（みんな／フォロー中）・投稿の通報', status: 'done' },
  { category: 'プラットフォーム', name: 'AWP内での決済（商品販売・予約の事前決済）', status: 'blocked', note: 'Stripe Connect・特定商取引法の表示・返金規定の整備が必要（運営者の判断待ち）' },
  { category: 'プラットフォーム', name: '外部ツールへのキャッシュ利用', status: 'blocked', note: '資金決済法（第三者型前払式支払手段・資金移動業）の確認が必要' }
];
