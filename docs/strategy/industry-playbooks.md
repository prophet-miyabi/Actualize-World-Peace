# 業種別の手本（Industry Playbook）

ユーザーが入力した内容からページを作るとき、AWP は同業種で評価の高い日本のページの「型」を手本にして、
すべてのユーザーに洗練されたページを提供する。

## 仕組み

1. **業種の判定** — ページ作成時に、事業名・キャッチコピー・強み・事業内容から業種を判定する（辞書 → 速いモデル）。
   `LandingPage.industryKey` に保存。27業種（`backend/src/ai/playbook.ts` の `INDUSTRIES`）。
2. **手本の作成** — 業種ごとに1回、Claude（balanced）が Web 検索（最大6回）で人気ページを調べ、
   リサーチメモ → 構造化（`PlaybookSchema`）の2段階で手本を作る。`IndustryPlaybook` テーブルに保存し、約60日で作り直す。
   検索が使えないときは知識のみ、intelligence が使えないときは一般的な型（`fallbackPlaybook`）を使う。
3. **ページ作成への反映**
   - デザイン（`design.ts`）: 構成・配色の方向・写真の傾向・ファーストビューの型を渡し、`copy`（eyebrow / subcopy / ボタン文言）と
     `sectionOrder` を `design` JSON に入れる。
   - 文章（`sectionWriter.ts`）: トーン・書き方・信頼要素・避けることを渡す。
   - 対話（`builderAgent.ts`）: その業種で聞いておくべきことを織り込む。
   - 機能一覧（`/api/lp/features`）: 人気ページで定番の機能を「おすすめ N」として順位と理由付きで示す。
   - 公開ページ: `publicLp` がセクションを `sectionOrder` の順に並べ替える。
4. **運営者画面** — `/admin/playbooks` で業種ごとの状態・内容・参照した実在ページを確認し、作り直せる。
   API: `GET /api/ops/playbooks`, `POST /api/ops/playbooks/:key/rebuild`, `POST /api/ops/playbooks/rebuild-all`。

## 守ること

- 手本は「型」だけを借りる。他社の文章・数字・実績をユーザーのページに持ち込まない。
- eyebrow / subcopy はユーザーが伝えた事実だけから作る（景表法・医療広告ガイドライン等の mustAvoid を手本に含める）。
- 参照した実在ページは運営者の確認用にのみ表示し、ユーザーのページには出さない。

## 費用の目安

1業種あたり Sonnet 2回 + 検索6回 ≈ $0.10〜0.20。27業種で約 $4。60日ごとに更新。
環境変数 `PLAYBOOK_WEB_SEARCH=false` で検索を止められる（知識のみで作成）。
