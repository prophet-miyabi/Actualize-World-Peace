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
  { category: 'LP/HPビルダー', name: 'ウィザードによるLP/HP自動生成', status: 'done' },
  { category: 'LP/HPビルダー', name: 'AIによるデザイン作成（配色・書体・レイアウト）', status: 'done' },
  { category: 'LP/HPビルダー', name: '追加機能セクション（メニュー・FAQ・アクセス等）', status: 'done' },
  { category: 'LP/HPビルダー', name: '写真・ロゴのアップロード管理', status: 'partial', note: '管理画面での管理のみ。公開LPへの表示（ギャラリー等）は未実装' },
  { category: 'LP/HPビルダー', name: '見出しのA/Bテスト', status: 'done' },
  { category: 'LP/HPビルダー', name: 'AWPドメイン上での無料公開', status: 'done' },
  { category: 'LP/HPビルダー', name: '独自ドメイン接続', status: 'partial', note: '無料で設定可能。Render上での顧客ドメインの自動登録（証明書発行）は未実装' },
  { category: 'LP/HPビルダー', name: 'データの書き出し（AWPからの独立性）', status: 'done' },
  { category: 'LP/HPビルダー', name: 'ワイルドカードサブドメイン（{事業者}.本ドメイン）', status: 'blocked', note: 'コードは実装済み。AWP自身のドメイン取得・DNS設定が必要' },

  // ---- 集客チャネル ----
  { category: '集客チャネル', name: 'LINE公式アカウント連携・自動応答', status: 'done' },
  { category: '集客チャネル', name: 'SNS連携（X/Instagram/Facebook/TikTok）OAuth', status: 'partial', note: 'コードは実装済み。各社開発者アプリの本登録（Client ID/Secret取得）は未着手' },
  { category: '集客チャネル', name: 'SEO（サイトマップ・robots.txt・構造化データ・IndexNow）', status: 'done' },

  // ---- AIエージェント（自動運用） ----
  { category: 'AIエージェント', name: 'マーケティング下書き作成（プラットフォーム別）', status: 'done' },
  { category: 'AIエージェント', name: 'コンプライアンス審査（誇張・捏造の自動チェック）', status: 'done' },
  { category: 'AIエージェント', name: '成長分析・改善提案', status: 'done' },
  { category: 'AIエージェント', name: 'システム監視・障害診断', status: 'done', note: '診断のみ。コード自動修正・自動デプロイは意図的に非対応' },
  { category: 'AIエージェント', name: 'AWP自己PR（自社集客）', status: 'done' },
  { category: 'AIエージェント', name: 'X週間キャンペーン（黄金比率・PASの法則）', status: 'done' },
  { category: 'AIエージェント', name: 'ブラウザ操作の自動化ワークフロー', status: 'done', note: '認証情報系の操作は安全のため禁止' },
  { category: 'AIエージェント', name: '進捗報告エージェント', status: 'done', note: '本レポートを作成する仕組み自体。エージェントループへの自動組み込みは未着手（次のステップ）' },

  // ---- 課金・法務 ----
  { category: '収益', name: '提携ツールのカタログ・アフィリエイト導線・クリック計測', status: 'done' },
  { category: '収益', name: 'ASP提携とアフィリエイトリンクの登録', status: 'blocked', note: '運営者のASP登録・各プログラムとの提携が必要' },
  { category: '課金・法務', name: 'Stripe決済（コード実装）', status: 'done' },
  { category: '課金・法務', name: 'Stripe本番（Live）設定', status: 'blocked', note: '有料プランの扱いを保留中' },
  { category: '課金・法務', name: '特定商取引法・プライバシーポリシーの実在情報記載', status: 'blocked', note: '運営者の実在情報が必要（捏造不可）' },

  // ---- インフラ・デプロイ ----
  { category: 'インフラ・デプロイ', name: 'Render本番デプロイ', status: 'done', note: '3サービスとも有料プランで常時稼働' },
  { category: 'インフラ・デプロイ', name: '本番用の環境変数整備（DEV_LOGIN無効化等）', status: 'done' },

  // ---- 将来構想 ----
  { category: '将来構想', name: '個人向けセルフパブリッシング（ブログ・リール等）', status: 'not_started', note: '既存SNS・検索エンジン連携強化を優先実施中' }
];
