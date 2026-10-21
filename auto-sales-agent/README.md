# Auto-Sales-Agent

クラウドワークス・ランサーズ等の案件文から、見込み客専用の「動くモックアップ」と「個別提案文」を半自動で作り、公開URL付きで営業するための仕組み。Claude Code の `/pitch` コマンドで「取り込み → 分析 → 生成 → デプロイ → 提案文」を一気通貫で実行します。作業ルールは `auto-sales-agent/CLAUDE.md`。

```
auto-sales-agent/
  CLAUDE.md                 品質基準・提案文のルール（Claude Code が従う）
  schema/brief.schema.json  分析結果（brief.json）の形
  templates/
    template_lp.html        高成約率LP（3ステップ相談フォーム・LINE導線・FAQ・料金タブ）
    template_crm.html       業務管理（ダッシュボード・案件一覧・ステータス変更・架電履歴・スタッフ配置 D&D）
    template_booking.html   予約・顧客管理（週カレンダー・重複検知・要注意顧客＝ブラックリスト・スタッフ）
    proposal.md             提案文の骨組み
  scripts/
    new.js       取り込み: input/<ID>/job_post.txt を作る（URL / ファイル / 標準入力）
    analyze.js   分析（API）: brief.json を作る。キーが無ければ /pitch で Claude Code が直接書く
    generate.js  生成: brief + テンプレート → dist/<ID>/index.html
    deploy.js    公開: awp（既定・frontend/public/demos へ push）/ cloudflare / vercel
    propose.js   提案文: output/<ID>_proposal.md
  input/   案件ごとのフォルダ（Git には sample-reform だけ入る）
  dist/    生成したモックアップ（Git に入れない）
  output/  提案文（Git に入れない）
```

## 使い方（Claude Code）

```
/pitch 20261021-cw-reform https://crowdworks.jp/public/jobs/XXXX
```

または案件文を貼り付けて `/pitch 20261021-cw-reform`。公開URLと提案文の全文が返ってきます。

## 使い方（手動）

```bash
node auto-sales-agent/scripts/new.js sample-reform ./job.txt    # 取り込み
node auto-sales-agent/scripts/analyze.js sample-reform           # 分析（API。無ければ brief.json を手で書く）
node auto-sales-agent/scripts/generate.js sample-reform          # 生成 → dist/sample-reform/index.html
node auto-sales-agent/scripts/deploy.js sample-reform            # 公開 → https://awp-frontend-bf17.onrender.com/demos/sample-reform/
node auto-sales-agent/scripts/propose.js sample-reform           # 提案文 → output/sample-reform_proposal.md
```

生成した HTML はそのままブラウザで開けます（外部読み込みは Tailwind・Alpine.js・Google Fonts の CDN のみ）。

## デプロイ先

- `awp`（既定）: `frontend/public/demos/<ID>/` にコピーして git push。Render の自動デプロイ後（3〜5分）に公開。`robots.txt` で検索から除外。URL に顧客名を含めないよう、案件IDは短い英字で。
- `cloudflare`: `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を設定し、`npx wrangler pages deploy`。
- `vercel`: `vercel login` 済みの環境で `npx vercel --prod`。

## 受注後

- 契約書類: `node contracts/generate.js contracts/projects/<顧客>.json`
- 見込み・受注の記録: `finance/plan.json` の `pipeline` と `finance/journal.csv`
