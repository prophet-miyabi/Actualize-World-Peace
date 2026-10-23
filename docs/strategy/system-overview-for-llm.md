# AWP システム構成書（他の LLM に渡す用）v2026-10-23

> 目的: ChatGPT / Gemini / Claude など別の LLM に貼り付けて、改善のブレインストーミングや、Claude Code に渡すプロンプトの洗練に使うための「現状の全体像」。事実は 2026-10-21 時点のリポジトリ（`prophet-miyabi/Actualize-World-Peace`, main）に基づく。数字・名称はそのまま引用してよい。秘密情報（鍵・トークン・顧客情報）は含めていない。

---

## 0. 30秒で分かる AWP

- **AWP（Actualize World Peace）** は、日本のスマートフォン利用者向けの「自分の手でウェブ上のシステムを作れる」プラットフォーム。1アカウントで **ページ（ホームページ／LP）＋SNS（投稿・リール・フィード）＋予約・ショップ＋外部ツール連携** が使える。
- 運営は個人事業主（オーナー: Miyabi）1名と、**社内で動く23体の会社エージェント（AWP Intelligence）** による。エージェントは Claude API で動き、タスク・会議・SNS 運用・監視・営業資産づくりを担う。人間の承認を要する決定はオーナーに戻す。
- 北極星は **世界平和の実現**。手段として「世界人口の大半が参加する SNS → 参加者が生む余剰を配る参加配当（UBI 相当）→ それを統括する人間監督下の超知能」。2027 年に **第三種資金移動業の登録** を取り、出金と最初の参加配当を可能にする計画。
- 直近の目標: **2026-10-28 公開**、**2026-10 中に受託1件以上**、**2026-12-31 までに 300 万円** を獲得して法人化。
- 固有ルール: アプリ内の文言に「AI」という英字2文字を使わない（主語は「AWP」、概念は「intelligence」、会話は「チャット」）。`backend/scripts/brand-words.py` が検査する。

---

## 1. 技術スタックと配置

| 層 | 技術 | 配置 |
|---|---|---|
| フロント | Next.js 16（App Router）, React, axios。Tailwind は使わず CSS 変数＋`globals.css`。日本語フォント Noto Sans JP ほか | Render（静的＋SSR）`https://awp-frontend-bf17.onrender.com` |
| バックエンド | Node.js, Express 5, TypeScript, Prisma 5, zod, jsonwebtoken, bcryptjs, Stripe, LINE Bot SDK, Playwright, `@anthropic-ai/sdk`, `@google/genai`, `@modelcontextprotocol/sdk` | Render `https://awp-backend-sm9z.onrender.com` |
| DB | PostgreSQL（Prisma schema に **56 モデル**） | Render Postgres |
| 生成モデル | 文章・設計・会社エージェント: Claude（Sonnet 系、`web_search_20260209` を業種調査に使用）。画像: Cloudflare Workers AI（FLUX, 無料枠）→ Gemini（現在の鍵では 402）→ **Runway（実装済み・未課金）** の順でフォールバック。動画: Runway（実装済み・未課金） | Anthropic / Cloudflare / Google / Runway |
| デプロイ | GitHub main への push で Render が自動デプロイ（3〜5分） | GitHub Actions は Auto-Sales-Agent の cron のみ |
| 開発補助 | Claude Code を **運営者コンソール** として使う: MCP サーバー `awp`（`backend/src/mcp/awp.ts`）、`.claude/agents/`（30 エージェント定義）、スキル `/pitch` `/awp-council` など。Runway MCP はユーザー設定に登録済み（Free プランのためクレジット 0） | ローカル（Windows 11） |

リポジトリ構成（主要）

```
backend/src/
  routes/        agents auth automation billing bookings builder chatbot community company crew export
                 harness harnessLink lp monitoring notifications ops photos plans posts products reports
                 shop siteAssets social tools wallet webhook
  ai/            builderAgent design designJob playbook sectionWriter styles text reel runway cloudflareFetch lineReply
  company/       registry tools toolExec loop runtime managed chat council strategy vision ownerTasks settings …
  social/        platforms/(instagram ほか) scheduler instagramOps
  agents/        compliance growth marketing monitoring opsAgent selfPromotion xCampaign statusReport …
  crew/          orchestrator planner personas discord github（人間クルーのタスク配分）
  automation/    executor safety（ユーザー向け自動化ワークフロー）
  mcp/awp.ts     Claude Code 用 MCP
frontend/src/app/  下記 3 章の画面一覧
auto-sales-agent/  受託営業の半自動化（4 章）
contracts/ finance/  契約書類生成・財務諸表（4 章）
docs/strategy/     vision, funds-transfer-license, industry-playbooks, sns-platform-design, behavioral-design, managed-agents, million-users-plan
docs/council/      会議室の議事録
```

---

## 2. ユーザー向けプロダクト（何ができるか）

### 2.1 ページ作成（ホームページ／LP ビルダー）
- 入力は「業種・屋号・強み・地域・色」程度の **簡単な質問（ウィザード）**。`LandingPage` モデルに保存し `/{slug}` で公開。複数ページ `/{slug}/{page}`。
- **業種プレイブック**（`IndustryPlaybook`, 27 業種）: Claude がウェブ検索で同業種の人気ページを調査し、構成・訴求・禁則をまとめたもの。60 日で更新。設計（`design.ts`）、セクション文章（`sectionWriter.ts`）、ビルダーエージェント、機能提案がこれを参照する。
- **スタイル体系**（`styles.ts`）: editorial / gallery / stage / glass / corporate / warmTable / clinic / studio / soft / craft / community / minimal の 12 様式 × ユーザーが選んだアクセント色から HSL でパレットを導出。直近 200 デザインの組合せを避けて **似たページが増えない** ようにする。ヒーロー配置 editorial / stage / glass / fullBleed、TopBar、FeatureStrip、スマホ固定 CTA。
- 画像: 生成画像（上記フォールバック順）か写真アップロード。画像が無い業種は中央寄せレイアウトに自動で切替。
- **AWP Page Intelligence**（`/page/create`、API `/api/page-intelligence/*`、2026-10-21 追加）: 3〜6問の最小入力 → 業種判定と手本 → 目的別の調査スナップショット（業種×目的で60日共有）→ **構成案を必ず3つ提案**（各セクションの目的・見出し・本文・画像の役割/被写体/雰囲気/配置・CTA・スマホ優先順）→ ユーザーが1案を選ぶ → セクションごとの画像候補（生成／ユーザー写真、理由・代替テキスト・ライセンス付き。「使う／別の候補／雰囲気を変更／アップロード／理由を見る」）→ 375px/1024px プレビューと公開前チェック（業種適合性・画像の役割・CTA配置・モバイル）→ LandingPage と sections に反映。モデル: PageIntelligenceSession / PageStructureSuggestion / PageImageSuggestion / PageResearchSnapshot。原則「画像は業種に関係があるだけでは入れない。セクションの目的に効く被写体だけ」。
- テンプレート選択はサムネイルを iframe で実機幅（390px）描画。`/showcase/{key}` に 9 つの架空サンプル（トップページのスライドショーにも使用）。
- 予約（`Booking`）、商品・注文（`Product`, `Order`, `SellerProfile`）、問い合わせ（`Inquiry`）、LINE 連携（`LineConfig`）、チャットボット（`ChatbotQuestion`）、外部ツールカタログ（`ToolCatalogItem`, `LpTool`）、A/B（`LpVariant`）、アクセス解析（`PageEvent`）。

### 2.2 SNS
- 投稿（`Post`: テキスト／画像／リール）、いいね、コメント、フォロー、通知、フィード `/feed`、リール `/reels`、発見 `/discover`。
- **投稿は既定でそのユーザーのページに埋め込まれる**（`Post.showOnPage`, `LandingPage.postsPlacement` top/bottom）。投稿単位で非表示にできる。自分のホーム `/me` はページとリンクし、ページのデザインで投稿を描画。
- 外部 SNS 連携（`SocialAccount`, `ScheduledPost`）: Instagram（画像・リール投稿、プロフィール、インサイト、トークン更新）ほか。
- **SNS 相互連携・カレンダー予約**（2026-10-23 追加）: Instagram / X / TikTok の投稿を AWP の `Post` に取り込み（`source` / `externalId` / `externalUrl`、手動と1時間ごとの自動）、AWP からは `/social/schedule` のカレンダーで「いつ・何を・どこへ（AWP / Instagram / X / TikTok / Facebook / YouTube）」を決めて同時配信。配信は失敗したプラットフォームだけを再試行（2分→10分→30分）、トークン失効は `SocialAccount.status` に反映、結果は CompanyEvent に記録。フィードの投稿欄からも同時配信を選べる。ページの投稿ブロックは `LandingPage.postsConfig`（件数・種類・並び）で調整し、投稿者のアイコン・名前タップでその人のページ `/[slug]` へ遷移。外部 SNS への配信は有料プラン、AWP 宛ての予約は無料。OAuth のクライアント ID は本番で未設定のため、連携画面は「準備中」。

### 2.3 お金・プラン・参加配当の土台
- プラン（`PlanPayment`, `/plans`）: 月額。支払いは Stripe か **アプリ内キャッシュ**。
- ウォレット（`LedgerTransaction`, `LedgerEntry`, `RevenueEvent`, `Contribution`）: 紹介・貢献で貯まるが、**資金移動業の登録（2027 目標）まで出金不可**。参加配当の設計は `docs/strategy/funds-transfer-license.md`。
- アフィリエイト・ドメイン紹介（`AffiliateClick`, `DomainReferral`）、ハーネス（外部サービス追加販売: `HarnessAddon`, `HarnessOrder`, `HarnessLink`）。

### 2.4 画面一覧（frontend/src/app）
公開: `/` `/[slug]` `/[slug]/[page]` `/p/[id]` `/showcase/[key]` `/preview` `/legal` `/privacy` `/terms` `/shop/[slug]/legal` `/order/[code]` `/reserve/[code]`
利用者: `/login` `/forgot-password` `/wizard` `/create` `/builder` `/dashboard` `/me` `/profile` `/feed` `/reels` `/discover` `/social` `/photos` `/products` `/orders` `/bookings` `/shop-settings` `/automation` `/agents` `/tools` `/harness` `/harness/post` `/features` `/analytics` `/growth` `/notifications` `/wallet` `/billing` `/plans` `/domain`
運営者（管理者ログイン時のみ）: `/admin` `/admin/company` `/admin/company/chat` `/admin/council` `/admin/crew` `/admin/ops` `/admin/playbooks` `/admin/instagram` `/admin/assets` `/admin/monitoring` `/admin/reports` `/admin/revenue` `/admin/billing` `/admin/domains` `/admin/tools` `/admin/harness` `/admin/emergency`

---

## 3. 運営の自動化（AWP Intelligence）

### 3.1 会社エージェント（`backend/src/company/`）
- 23 体: ceo, coo, chair, product, engineering, qa, security, data, growth, marketing, content, instagram, cs, partnership, finance, legal, auditor, research, psychology, sociology, economics, geopolitics, astronomy。定義は `registry.ts`、Claude Code 側の対応定義は `.claude/agents/awp-*.md`。
- 動き方: `loop.ts` が定期に `CompanyTask` を拾い、担当エージェントが `tools.ts` のツール（DB 参照、ページ・投稿の生成、画像・リール生成、Instagram 投稿のキュー、監視、提案作成など）を呼ぶ。記録は `CompanyAction` `CompanyEvent` `AgentRun` `CompanyMemory`。目標は `CompanyGoal`。
- **オーナータスク**: 担当 `owner`（Miyabi）のタスクはループが実行せず、`/admin/company` で人間が完了を付ける。人間クルー（`CrewTask`）と同期。
- **会議室（Council）**: `/awp-council <議題>` で chair が心理・社会・経済・地政・天文の各エージェントを招集し議事録を `docs/council/` に残す。決定はタスクに落ちる。
- **公式 Instagram** はエージェント `instagram` が運営（活動報告・広報）。下書きは `/admin/instagram` でオーナーが承認してから公開（自動公開の設定も可）。
- チャット `/admin/company/chat` で任意のエージェントと対話。
- **AWP Operations Office**（`/admin/office`、API `/api/office/*`、2026-10-21 追加）: 管理者専用の 3D 仮想オフィス（React Three Fiber、アイソメトリック。WebGL が使えない端末は 2D 図に自動切替）。8 部署（CEO席 / プロダクト開発 / ユーザー成功 / グロース・マーケティング / SNS運用・配信管理 / 収益・パートナー / コンプライアンス・リスク / データ・分析）× 33 の役割（デジタル社員）が既存 23 エージェントに対応。目的を入れると Orchestrator が 3〜7 ステップに分解して担当・承認ポイント・完了条件を提案し、管理者が承認すると CompanyTask になる。5 つのループ（プロダクト改善 / ユーザー活性化 / SNS運用 / リスク対応 / 収益改善）は `AgentLoopDefinition` として定義され、30 秒ごとの tick が次のステップを自動生成し、承認が要るステップは承認トレイ（`AgentApproval`）で止まる。警報（`OperationsAlert`: 失敗・30分超の実行・12時間超の承認待ち・SNSトークン期限・intelligence 停止）と指標（`AgentMetric`）を記録し、SSE で画面を即時更新。タスク状態は DRAFT / ASSIGNED / IN_PROGRESS / WAITING_INPUT / WAITING_APPROVAL / BLOCKED / RETRYING / COMPLETED / FAILED / CANCELLED。

### 3.2 ユーザー向け自動化・監視
- `automation/`: ユーザーが作る自動化ワークフロー（`AutomationWorkflow`, `AutomationRun`）、安全弁 `safety.ts`。
- `agents/`: 法令チェック、成長・マーケ・X キャンペーン、自己宣伝、監視、状態レポート。
- 監視: `SystemError`, `/admin/monitoring`, `/api/health/ai`（Anthropic 鍵・ワークスペース・残高の確認）、`lib/readiness.ts`（公開準備チェックリスト: Runway 鍵の有無なども項目）。
- 停電・障害時: `company/outage.ts`, `/admin/emergency`。
- **データ資産（AWP Data Intelligence、2026-10-23 追加）**: 全テナントの行動・成約を匿名化して `AwpIntelligenceLake` に蓄積（業種・チャネル・段階・時間帯・文面のハッシュのみ。利用者 ID・氏名・本文は入れない）。記録箇所はページ来訪/ボタン押下、予約、注文と入金確認、LINE の反応と友だち追加、外部 SNS への発信。6 時間ごとに業種×チャネルの勝ちパターン `IndustryFunnelBenchmark`（反応率・LP 遷移率・予約決済率・平均単価・反応が多い時間帯・効いた言葉、サンプル 5 件以上）へ結晶化し、業種プレイブックの要約に添えてページ生成へ還流。利用者ごとに `HarnessIntentSignal`（LINE 導入・自動返信・SNS 投稿自動化・独自ドメイン・直接販売の推奨と 0〜100 点）を計算し、80 点以上はマイページに提案カード。外部通信は `safeExternalFetch` のホワイトリスト（公式 API のホストのみ）。管理画面 `/admin/intelligence`、エンジン `backend/src/automation/awpDataAssetEngine.ts`。

---

### 3.3 Harness エンジン・データ資産・事業ピボット（2026-10-23 追加）

- **事業ピボット（オーナー決定）**: 年内は屋号「雅テック」の受託（松竹梅 15万 / 35万 / 60万円〜）を先行し、300 万円 → 2027 年初頭に浜松市の創業融資 3,300 万円。一般公開は招待制のコストガード（`invite_only_pages` ＋ `AWP_INVITE_CODE`）を整えてから。オーナーの稼働は年内 1 日 180 分で、`company/ownerBudget.ts` がオーナータスクに推定時間と優先度（①受託 ②ドッグフーディング ③SNS）を付けて日付を割り当てる。正本は `docs/strategy/miyabi-tech-roadmap.md`、`company/strategy.ts` 第 8 章、`CompanyGoal`「雅テック…」。
- **Harness エンジン（自社実装・外部送信なし）** `backend/src/automation/harnessEngine.ts` ＋ `routes/crm.ts`（`/api/harness/crm/*`）。モデル: CrmContact（クロスUUID `cid`、LINE/X/IG/TikTok の ID を同一人物に結合）、EngagementGate（キーワード反応 → 返信 → シナリオ登録）、CrmScenario/Step/Enrollment（LINE ステップ配信、毎分、Spintax ＋ ジッター）、ChannelAccountPool（健全性スコア・クールダウン・切替）、CrmAutomationRule、CrmContactEvent。LINE Webhook はゲートに当たれば自動応答より優先。公開ページの `?awp_cid=` を来訪・予約・注文に付けて `onCrossEvent`。画面 `/harness/crm`。Claude Code: `awp_harness_summary / gates / scenarios / health`。
- **データ資産** `automation/awpDataAssetEngine.ts`: 匿名レイク（AwpIntelligenceLake）→ 6 時間ごとに業種×チャネルの勝ちパターン（IndustryFunnelBenchmark、n≥5）→ 業種プレイブックに還流、導入インテント（HarnessIntentSignal、80 点以上を /me に提案）。会社エージェントの道具 `industry_benchmarks` / `aggregate_benchmarks`。画面 `/admin/intelligence`、`/admin/reports` 下部。
- **資金トラッカー** `GET/PUT /api/intelligence/funding-tracker`（SystemSetting JSON ＋ 台帳）。`/admin/revenue` 上部。
- **営業資産の更新**: `finance/plan.json` の `packages`、提案文の `{{packages}}`、`contracts/projects/package_{ume,take,matsu}.json`、自社ショーケース `/demos/miyabi-tech`。

## 4. 受託営業の資産（売上をつくる側）

- **Auto-Sales-Agent**（`auto-sales-agent/`）: クラウドワークス／ランサーズの案件文 → `brief.json`（分析）→ 触って動くモックアップ（Tailwind＋Alpine 1ファイル。テンプレート lp / crm / booking / **lp_drm**）→ `frontend/public/demos/<id>` に公開 → 個別提案文。`scout.js` で新着案件を収集、`batch.js` で一括生成、Discord 通知、cron 対応。ルールは `auto-sales-agent/CLAUDE.md`（事実を作らない・見本と明示・個人情報を書かない）。
- **lp_drm**: 新 PASONA × BEAF の 10 セクション高成約 LP。ファーストビュー（権威バッジ→肩書→見出し→CTA→マイクロコピー＋**診断結果カードのアプリ画面イメージ**）、実績タイル（カウントアップ）、悩みチェック（2 つ以上で放置リスク＋CTA）、Before/After 3 枚、理由 3 つ（交互レイアウト＋根拠）、比較表（◎○△× を記号化、先頭列固定）、声 3 件、流れ＋料金、保証（約束とリスクを並置）＋FAQ、EFO 一体型 2 ステップフォーム（Step2 に回答チップ）、GTM 用 dataLayer イベント。画像スロット hero / benefits×3 / reasons×3 / closing は **Runway で生成した写真を差し込める**（`scripts/images.js`。未生成時はグラデーション＋線画で代替）。見本: `https://awp-frontend-bf17.onrender.com/demos/sample-ai-asset`。
- **contracts/**: 見積・契約・保守 SLA・セキュリティ基準書など 6 書式を JSON から生成。**finance/**: 仕訳 CSV → P/L・B/S・CF と 300 万円目標との差分。
- 現在の案件: LP 制作 3 件へ応募準備済み（プロトタイプ公開済み、提案文作成済み、応募はオーナーが手動）。

---

## 5. 制約・ポリシー（提案時に守ること）

1. 文言に「AI」（英字 2 文字）を使わない。主語は「AWP」。
2. 根拠のない実績・満足度・「必ず」「絶対」を書かない。金融など規制業種は法務確認を前提に書く。
3. 秘密はチャット・ファイルに貼らない（鍵は Render の環境変数、管理トークンは `~/.claude/awp-admin-token`）。
4. 出金は資金移動業の登録まで不可。参加配当は「制度の UBI」ではなく「参加配当」と呼ぶ。
5. 人間の判断を要する決定（支払い、法的手続き、対外公開の最終承認）はオーナーに戻す。
6. スマホ 375px 基準。横スクロールを出さない。日本語フォントは Noto Sans JP。
7. 実装は「実装可能なものはすべて実装して報告」が標準運用。未完・保留は明示する。

---

## 6. いま分かっている弱点・未解決（ブレストの種）

- ページ品質: オーナー評価は「まだ外注品質に届かない」。画像生成が無料枠 FLUX に依存し、Runway は未課金（Free はクレジット 0、動画は有料プラン必須）。Gemini 画像は現在の鍵で 402。
- 収益: 受託の競争が激しい（LP 案件 3 件の応募者は 172 / 129 / 99 人）。差別化は「動くプロトタイプを先に出す」こと。
- 公開前の人手タスク: 銀行口座、CNAME、法務（特商法・利用規約の最終確認）、Instagram トークン接続、PR のマージ、`FRONTEND_URL` などの環境変数。
- Anthropic 課金: 本番鍵は `ANTHROPIC_WORKSPACE_ID` が必要。10/09 の障害は Console の支出上限。
- SNS の初期ユーザー獲得の仕組み（紹介比率・7 日継続）の検証はこれから。
- エージェント統括系の外部監査・自治単位の設計は段階 2（2028〜）で未着手。

---

## 7. そのまま貼れるプロンプト

### 7.1 ブレインストーミング用（別の LLM へ）

```
あなたはプロダクト戦略とグロース、UX、生成モデル活用に詳しいシニアアドバイザーです。
以下は AWP というサービスの現状の構成書です。読んだうえで、次の順で答えてください。

1. 現状の強み・弱みを、それぞれ 5 点以内で（構成書の事実を引用して）。
2. 「2026-10-28 公開」「10 月中に受託 1 件」「12 月末までに 300 万円」の 3 つの目標に対して、
   いちばん効く打ち手を目標ごとに 3 つ。各打ち手は「何を・誰が・いつまでに・成功の測り方」で。
3. ページ品質を「外注品質」に上げるための具体策を 5 つ。生成画像（Runway/FLUX）の使い方、
   業種プレイブック、スタイル体系の改善を含めて。
4. 会社エージェント（23 体）の運用で、無駄・危険・不足を各 3 点。
5. 最後に、上記を Claude Code（実装担当）に渡すための指示文を、優先順に 3 本、
   それぞれ 200 字以内で書いてください。

制約: 文言に「AI」という英字 2 文字を使わない（「AWP」「intelligence」「自動化」と言う）。
根拠のない実績を作らない。出金は 2027 年の資金移動業登録まで不可という前提を崩さない。

=== 構成書 ===
（この文書の 0〜6 章を貼る）
```

### 7.2 プロンプト洗練用（Claude Code への指示を磨く）

```
以下は、私（オーナー）が実装担当の Claude Code に出そうとしている指示の下書きです。
AWP の構成書（添付）を前提に、次を行ってください。
1. 曖昧な語を具体化する（対象ファイル・画面・モデル名は構成書の名称を使う）。
2. 受け入れ条件を箇条書きで付ける（スマホ 375px、エラーなし、既存機能を壊さない、など）。
3. やらないこと（スコープ外）を明記する。
4. 実装後に Claude Code が報告すべき項目を列挙する。
5. 200〜400 字の最終版の指示文を 1 本にまとめる。

=== 指示の下書き ===
（ここに下書き）

=== 構成書 ===
（この文書の 0〜6 章を貼る）
```

### 7.3 批評用（出てきた案を叩く）

```
次の改善案を、AWP の構成書（添付）に照らして批評してください。
観点: 実装コスト（人日）、既存の制約との衝突、法規（金融・特商法・個人情報）、
ユーザーがスマホで迷わないか、計測できるか。最後に「やる／やらない／条件付き」で判定。
=== 改善案 ===
（ここに案）
=== 構成書 ===
（この文書の 0〜6 章を貼る）
```

---

## 8. 更新のしかた

- この文書は人手で更新する。大きな変更（モデル追加、ルート追加、方針変更）のたびに該当章を直し、冒頭の版日付を変える。
- 事実の確認コマンド（リポジトリ直下）:

```bash
grep -c "^model " backend/prisma/schema.prisma
```

```bash
ls backend/src/routes
```

```bash
find frontend/src/app -name page.tsx
```
