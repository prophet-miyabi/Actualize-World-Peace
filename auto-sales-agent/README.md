# Auto-Sales-Agent

クラウドワークス・ランサーズ等の案件文から、見込み客専用の「動くモックアップ」と「個別提案文」を半自動で作り、公開URL付きで営業するための仕組み。Claude Code の `/pitch` コマンドで「取り込み → 分析 → 生成 → デプロイ → 提案文」を一気通貫で実行します。作業ルールは `auto-sales-agent/CLAUDE.md`。

さらに `scout.js`（新着案件の自動ピックアップ）と `batch.js`（ピックアップした案件を自動でモックアップ化して Discord に通知）で、定期実行（cron / タスク スケジューラ / GitHub Actions）に乗せられます。

```
auto-sales-agent/
  CLAUDE.md                 品質基準・提案文のルール（Claude Code が従う）
  scout.config.json         スカウトの条件（予算・文脈語・除外語・巡回URL）
  schema/brief.schema.json  分析結果（brief.json）の形
  templates/
    template_lp.html        高成約率LP（3ステップ相談フォーム・LINE導線・FAQ・料金タブ）
    template_crm.html       業務管理（ダッシュボード・案件一覧・ステータス変更・架電履歴・スタッフ配置 D&D）
    template_booking.html   予約・顧客管理（週カレンダー・重複検知・要注意顧客＝ブラックリスト・スタッフ）
    proposal.md             提案文の骨組み
  scripts/
    scout.js     新着案件を巡回し、条件に合うものを input/queue/<ID>/ に保存
    batch.js     queue を順に処理（分析 → 生成 → 公開 → 提案文の仕上げ → Discord 通知）
    new.js       取り込み: input/<ID>/job_post.txt を作る（URL / ファイル / 標準入力）
    analyze.js   分析（API）: brief.json を作る。キーが無ければ /pitch で Claude Code が直接書く
    generate.js  生成: brief + テンプレート → dist/<ID>/index.html
    deploy.js    公開: awp（既定・frontend/public/demos へ push）/ cloudflare / vercel
    propose.js   提案文: output/<ID>_proposal.md
    cron.ps1 / cron.sh  定期実行の入口（scout → batch）
  input/   案件ごとのフォルダ（queue/ はスカウトの保存先。Git には sample-reform だけ入る）
  dist/    生成したモックアップ（Git に入れない）
  output/  提案文・ログ（Git に入れない）
```

## 自動運転（スカウト → バッチ → Discord）

### 1. 準備（1回だけ）

- `ANTHROPIC_API_KEY`: 有効な Claude の API キー（`backend/.env` か環境変数。分析と提案文の仕上げに使う。1案件 約 $0.05〜0.10）
- `DISCORD_WEBHOOK_URL`: 通知先の Discord チャンネルで「チャンネルの編集 → 連携サービス → ウェブフック → 新しいウェブフック → URL をコピー」
- `git push` できる環境（公開先 awp は `frontend/public/demos/` に置いて push → Render が3〜5分で公開）

### 2. 手動で1回回す

```bash
node auto-sales-agent/scripts/scout.js --dry   # 候補を表示するだけ
node auto-sales-agent/scripts/scout.js         # input/queue/ に保存
node auto-sales-agent/scripts/batch.js --max 3 # 分析→生成→公開→提案文→Discord
```

Discord には「① 案件URL ② デモURL ③ 提案文（そのまま応募欄に貼れる）」が届きます。処理済みは `queue/<ID>/done.json`、失敗は `error.json`。

### 3. 定期実行

- Windows: `schtasks /Create /SC HOURLY /MO 3 /TN "AWP Auto-Sales" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File <repo>\auto-sales-agent\scripts\cron.ps1"`
- Linux / Mac: `0 */3 * * * /bin/sh <repo>/auto-sales-agent/scripts/cron.sh`
- GitHub Actions（PC が無くても回る）: `.github/workflows/auto-sales.yml`。リポジトリの Secrets に `ANTHROPIC_API_KEY` と `DISCORD_WEBHOOK_URL`、Variables に `AUTO_SALES_ENABLED=true` を設定すると3時間ごとに実行。

### スカウトの条件（scout.config.json）

- 予算 5万円以上、または予算の記載なし（相談可）。時給案件は「業務効率化・ツール開発・自動化・システム開発・GAS」を含むときだけ
- 文脈語（LP / 公式LINE / 予約システム / 顧客管理 / 業務システム / ツール開発 / ホームページ制作 など）を含む
- 除外語（データ入力・文字起こし・記事作成・バナー・動画編集・求人・営業パートナー・PM業務 など）を含まない
- 新着（クラウドワークスは掲載48時間以内、ランサーズは NEW タグ）で、提案数の目安が10以下
- クラウドワークスは一覧に埋め込まれた検索結果JSONを、ランサーズは一覧HTMLのカードを読む（どちらも RSS は提供されていない）。取得間隔を空け、1回の実行で読む詳細は12件まで

## 使い方（Claude Code・手動）

```
/pitch 20261021-cw-reform https://crowdworks.jp/public/jobs/XXXX
```

または案件文を貼り付けて `/pitch 20261021-cw-reform`。公開URLと提案文の全文が返ってきます。

## デプロイ先

- `awp`（既定）: `frontend/public/demos/<ID>/` にコピーして git push。Render の自動デプロイ後（3〜5分）に公開。`robots.txt` で検索から除外。URL に顧客名を含めないよう、案件IDは短い英字で。
- `cloudflare`: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を設定し、`npx wrangler pages deploy`。
- `vercel`: `vercel login` 済みの環境で `npx vercel --prod`。

## 注意

- 各サービスの利用規約に従って使ってください。巡回は公開ページを読むだけで、ログインや自動応募は行いません（応募は人が提案文を貼って行う）。
- 案件文には個人情報が含まれることがあるため、`input/` と `output/` は Git に入れません。
- 受注後: `node contracts/generate.js contracts/projects/<顧客>.json` で契約書類、`finance/plan.json` の `pipeline` と `finance/journal.csv` に記録。
