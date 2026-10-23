# 雅テック（Miyabi Tech）事業ロードマップ v2026-10-23

> オーナー（Miyabi）の最新の事業計画。AWP を一般公開で一気に広げる前に、受託で資金と生計を確立し、オーナー自身が AWP を使い込んで（ドッグフーディング）完成度を上げ、実績を根拠に融資を受けて本格展開する。会社エージェントは `company/strategy`（第8章）とこの文書を正本として参照する。数字は計画値。実績は `finance/` と `/admin/revenue` のトラッカーで実測値だけを表示する。

## Step 1. 個人事業「雅テック」の登記と受託による資金・生計の確立（2026-10〜12）

- 屋号「雅テック（Miyabi Tech）」で開業届を出し、企業向けに次をパッケージ化して受注する。
  - 高成約 LP・ホームページ制作（10 セクション構成、業種プレイブック、動くプロトタイプを先に見せる）
  - 公式 LINE の自動動線（Harness: エンゲージメントゲート → ステップ配信 → 予約・決済）
  - 広告用ショート動画・カスタムソング（Runway / 生成音楽）
  - SNS 一斉運用基盤（AWP から X / Instagram / TikTok / YouTube へ同時配信）
- 松竹梅のパッケージ（税別・目安）:

| パッケージ | 価格 | 内容 |
|---|---|---|
| 梅（LP） | 15 万円〜 | 高成約 LP 1 本（10 セクション・スマホ最適化・GTM/GA4）＋ 公開作業 |
| 竹（LP＋LINE） | 35 万円〜 | 梅 ＋ 公式 LINE の自動動線（ゲート・ステップ配信・予約フォーム）＋ 広告用ショート動画 1 本 |
| 松（フル） | 60 万円〜 | 竹 ＋ ホームページ（5〜6 ページ）＋ カスタムソング付き動画 ＋ SNS 一斉運用基盤の設定と 1 か月の伴走 |
| 保守 | 月 1.1 / 3.3 / 7.7 万円 | 監視・バックアップ・更新・一次対応（contracts/ の保守 SLA） |

- いまは一般ユーザーを大量に呼び込まない。無料のページ生成は intelligence・サーバー費用がかさむため、公開時の「コスト最適化された無料枠」（招待コード／プラン別クレジット上限）の仕組みを先に整える。

## Step 2. 資本目標: 年内 300 万円 → 2027 年初頭に 3,300 万円の融資

- 2026-12-31 までに、雅テックの受託と AWP 初期導入で **300 万円（売上・利益）** を確保する。
- その実績（トラクション）と自己資金 300 万円を元手に、2027 年初頭に **浜松市のスタートアップ支援・創業融資（金融機関）で 3,300 万円** を調達する。
- 審査に向けて揃えるエビデンス（`/admin/revenue` のチェックリストで管理）:
  1. 自己資金比率（300 万円 / 3,300 万円 ≒ 9%。可能なら 10% 以上）
  2. 受託の成約件数と入金実績（契約書・請求書・入金記録）
  3. AWP の自社実証 ROI（投稿数・閲覧・予約・成約の実測。雅テック自身の運用データ）
  4. 月額保守への転換数（継続収入の根拠）
  5. 事業計画書・資金繰り表（`finance/` の P/L・B/S・CF を元に作成）
  6. 開業届・屋号の口座・インボイス登録

## Step 3. オーナーの稼働時間（年内 1 日 3 時間 → 2027 年から 1 日 12 時間）

- **2026 年末まで**: 構築・改善・運用に使える時間は **1 日 180 分**。オーナータスクは「1 日 180 分以内で確実に終わり、売上に直結するもの」だけに絞る（優先順: ① 受託の成約・売上直結 → ② ドッグフーディングの修正 → ③ SNS 発信）。
- **2027 年 1 月から**: 受託収益で生計が立った上で **1 日 12 時間** のフルコミットに移行する。
- 実装: `backend/src/company/ownerBudget.ts` が未完了のオーナータスクに推定所要時間（`CompanyTask.estimateMin`）と優先度（`ownerPriority` 1〜4）を付け、優先度 → 期日 → 短いもの の順で `budgetDay` を割り当てる。1 日の合計が 180 分（2027 年から 720 分）を超える分は翌日以降へ送る。`/api/company/status` と `/api/office/state` の `ownerBudget`、会社エージェントの道具 `owner_budget`、Claude Code の `awp_owner_budget` で見える。エージェントが `create_task(assignee=owner)` するときは `estimateMin` と `ownerPriority` を付ける。

### 雅テックの 1 日 3 時間の運用フロー（年内）

| 時間 | やること | 画面・コマンド |
|---|---|---|
| 0:00〜0:20 | 承認と判断。承認トレイ・警報・今日の 3 タスクを確認 | `/admin/office` → 「今日」「承認」 |
| 0:20〜1:50 | 受託（成約直結）。案件の探索・プロトタイプ・提案文の送付、商談 | `/pitch <案件>`、`auto-sales-agent/scripts/scout.js`、提案文は `auto-sales-agent/output/` |
| 1:50〜2:30 | ドッグフーディング。自分のページ・予約・投稿で詰まったところを修正依頼 | `/page/create`、`/me`、不具合は `/admin/office` の委任（engineering_task） |
| 2:30〜3:00 | SNS 発信。実例と AWP の魅力を 4 媒体へ同時配信 | `/social/schedule`（AWP ＋ X / Instagram / TikTok / YouTube を選んで予約） |

## Step 4. SNS の自己実証と 4 媒体の統合配信

- 雅テックと AWP の公式アカウントとして X / Instagram / TikTok / YouTube で発信を続け、「AWP でどれだけレバレッジが得られたか」を実測値で示し、営業のケーススタディにする。
- プロダクト: AWP で 1 回作った投稿（文章＋画像／リール動画／カスタムソング付き動画）を、選んだ外部 SNS へ同時投稿・予約配信（`/social/schedule`）。取り込み（外部 → AWP）と配信（AWP → 外部）の両方向。
- 計測: 配信・来訪・予約・成約は匿名のデータレイクに記録され、業種別の勝ちパターンに還流する（`/admin/intelligence`）。

## KPI（計画値）

| 指標 | 目標 | 期限 |
|---|---|---|
| 雅テック 受注額（税別） | 300 万円 | 2026-12-31 |
| 受託の成約件数 | 7 件（竹・松の構成比による） | 2026-12-31 |
| 月額保守の契約数 | 3 件 | 2026-12-31 |
| 4 媒体の継続発信 | 週 5 回以上 | 毎週 |
| 浜松市 創業融資の申請 | 1 件 | 2027-02-28 |
| 融資の実行 | 3,300 万円 | 2027-03-31 |

## 実装の対応表（2026-10-23 時点）

| 計画 | 実装 | 確認する場所 |
|---|---|---|
| 会社の目標と戦略の同期 | `company/seed.ts` の `MIYABI_GOAL`（300万・7件・保守3件・融資 3,300万）、`company/strategy.ts` 第 8 章（v2026-10-23） | `/admin/company` の目標、`read_memory(company, strategy)` |
| オーナーの 180 分予算 | `company/ownerBudget.ts`、`CompanyTask.estimateMin / ownerPriority / budgetDay` | `/admin/office` 今日、`awp_owner_budget` |
| 松竹梅の価格 | `finance/plan.json` の `packages`、`auto-sales-agent/scripts/propose.js`（提案文の `{{packages}}`）、`contracts/projects/package_{ume,take,matsu}.json` | `node auto-sales-agent/scripts/propose.js <案件>`、`node contracts/generate.js contracts/projects/package_take.json` |
| 自社ショーケース LP | `auto-sales-agent/input/miyabi-tech/`（lp_drm）→ `frontend/public/demos/miyabi-tech/` | `/demos/miyabi-tech`（画像は構成案 3 つを選んでから） |
| 公式LINE の自動動線（Harness・L Harness 相当 第1段階） | `line/messages.ts`（MessageSpec → テキスト・画像・Flex カード・カルーセル・クイックリプライ）、`line/send.ts`（複数の LINE 公式アカウント・健全性・BAN 検知・切替・配信ログ）、`crm/broadcast.ts`（一斉・セグメント・予約配信）、`crm/reminders.ts`（予約日時基準）、`crm/surveys.ts`（アンケート形式のボタン選択 → カスタム項目・タグ・シナリオ）、`crm/conditions.ts`（ステップの条件分岐）、`routes/webhook.ts`（受信箱・postback・follow/unfollow）、`routes/crm.ts`（`/api/harness/crm/*`） | `/harness/crm`（設定でスマホだけで接続）、`awp_harness_*` |
| 4 媒体の同時配信 | `social/scheduler.ts`（awp / x / instagram / facebook / youtube / tiktok） | `/social/schedule` |
| 資金トラッカー（300万 → 3,300万） | `routes/intelligence.ts` の `GET/PUT /api/intelligence/funding-tracker`（SystemSetting JSON ＋ 台帳の AWP 収益） | `/admin/revenue` 上部、`awp_funding_tracker` |
| 業種別の勝ちパターン | `awpDataAssetEngine.ts`、道具 `industry_benchmarks` / `aggregate_benchmarks`（data・research） | `/admin/intelligence`、`/admin/reports` 下部、`awp_benchmarks` |
| コストガード（一般公開を急がない） | 緊急コントロールの `invite_only_pages` ＋ 環境変数 `AWP_INVITE_CODE`（`lib/inviteGuard.ts`。管理者・既存ページ保有者は対象外）。intelligence 費用はプランの利用枠（`aiAllowanceUsd`、料金の 78%）で上限 | `/admin/emergency`、`/page/create` の招待コード欄 |

### コストガードの運用

1. 年内は `invite_only_pages` を ON にし、`AWP_INVITE_CODE`（カンマ区切りで複数可）を Render の環境変数に置く。受託のお客様・知人には個別にコードを渡す。
2. 無料プランの intelligence 利用枠は `lib/plans.ts` の `aiAllowanceUsd` が上限。費用は `/admin/billing` と `get_costs` で毎週確認し、超えそうなら `propose_plan_config` で枠を下げる（承認制）。
3. 一般公開（招待制の解除）は、300 万円の進捗と月次の intelligence 費用を見て 2027 年 1 月以降にオーナーが判断する。

## 変更履歴

- 2026-10-23（夜）: 実装の対応表、コストガードの運用、オーナー予算の実装（`ownerBudget.ts`）、Harness エンジン、資金トラッカーを追記。
- 2026-10-24: 方針変更「the-harness.com の導入支援はやめ、自社実装を使ってもらう」。L Harness 相当の第1段階（複数 LINE アカウント・メッセージ種別・一斉/セグメント/予約配信・リマインダー・条件分岐・受信箱・アンケート形式のボタン選択・予約導線）を実装。第2段階（トラッキング/流入リンク・リッチメニュー・CSV・集計）、第3段階（Webhook OUT・API キー・権限・アフィリエイト承認・`/harness` の置き換え）は未着手。

- 2026-10-23: 初版。従来の「1 年で 100 万ユーザー」計画は長期目標として残し、年内は受託先行・ドッグフーディングに重点を移す（`company/strategy` 第 8 章）。
