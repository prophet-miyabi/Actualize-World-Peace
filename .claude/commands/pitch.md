---
description: 案件テキストから「分析 → 動くモックアップ生成 → デプロイ → 提案文」まで一気通貫で実行する（Auto-Sales-Agent）
argument-hint: <案件ID> [URL | テキストファイル]（案件IDを省略すると本文の貼り付けを求めます）
---

あなたは Auto-Sales-Agent の実行者です。`auto-sales-agent/CLAUDE.md` のルールを必ず読み、従ってください。
引数: `$ARGUMENTS`

## 手順（順番に。止まる条件に当たったら報告して止まる）

1. **取り込み**
   - 引数に案件IDとURL/ファイルがあれば `node auto-sales-agent/scripts/new.js <案件ID> <URL|ファイル>` を実行する。
   - 案件IDだけで `input/<案件ID>/job_post.txt` が既にあればそれを使う。何も無ければ、ユーザーに案件文の貼り付けを求め、`input/<案件ID>/job_post.txt` に保存する。
   - 案件IDは `YYYYMMDD-<媒体>-<短い英字>`。

2. **分析（brief.json）**
   - `job_post.txt` を読み、`auto-sales-agent/schema/brief.schema.json` の形で `input/<案件ID>/brief.json` を自分で書く（API は使わない。あなた自身が analyzer）。
   - 案件文に書かれていることだけを `facts`、推測は `assumptions`。`demo_data` は業界用語で 8〜15 件、実在の人名・連絡先は使わない。
   - `screen.template` は lp / crm / booking から1つ。迷ったら「画面を見て判断してもらう」ために crm か booking を優先する。

3. **生成**
   - `node auto-sales-agent/scripts/generate.js <案件ID>` を実行し、`dist/<案件ID>/index.html` を開く。
   - 業界・会社らしさを仕上げる: 文言、ダミーデータ、ステータス名、単位、色（palette）。CLAUDE.md の品質基準（触って動く5つ以上・375pxで崩れない・事実を作らない・見本バッジ）を満たすまで直す。
   - ブラウザ（preview の file 表示、または `npx serve dist/<案件ID>`）で 375px と 1280px を確認し、コンソールエラーがないことを確かめる。

4. **デプロイ**
   - `node auto-sales-agent/scripts/deploy.js <案件ID>`（既定 awp: `frontend/public/demos/` に置いて push。3〜5分後に公開）。
   - `input/<案件ID>/deploy.json` のURLを控える。awp の場合、公開されるまで待ってから URL を開いて 200 を確認する（最大10分、30秒おき）。

5. **提案文**
   - `node auto-sales-agent/scripts/propose.js <案件ID>` で骨組みを作り、`output/<案件ID>_proposal.md` を開く。
   - CLAUDE.md のライティングルールに従って仕上げる: 1行目はキラーフレーズ＋URL、案件文の言葉を引用して対応づけ、操作案内、本番で加えるもの、納期・費用（幅）、保守・契約書類、次の一歩（候補2つ）。600〜900字、絵文字なし、根拠のない数字なし。

6. **報告**
   - 公開URL、提案文の全文、brief の要点（業種・課題・想定）、所要費用の目安を、ユーザーにそのまま貼れる形で返す。
   - 受注につながる追加提案（契約書類 `contracts/` の生成、`finance/plan.json` の pipeline への追加）を1行で添える。

## 止まる条件
- 案件文に違法・危険・差別的な内容、または明らかな詐欺的要件が含まれる → 作らずに理由を報告。
- 案件文がプロトタイプで表現できない（ネイティブアプリ専用、ハード連携など）→ 近い画面で代替できるか提案して確認を待つ。
