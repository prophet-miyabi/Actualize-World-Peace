# AWP — 開発ルール（Claude Code 向け）

AWP（Actualize World Peace）は、スマホでホームページを作って無料公開できるサービス。
日本の若いクリエイター・ビジネスパーソン向け。スマホでの使いやすさを最優先にする。

## 構成
- `backend/` — Express 5 + TypeScript + Prisma 5（PostgreSQL）。API は `/api/*`
- `frontend/` — Next.js（App Router）+ Tailwind。`/api` はバックエンドへ中継される
- `mobile/` — Expo アプリ（別リポジトリ扱い。このリポジトリでは変更しない）
- 本番は Render（`render.yaml`）。`main` にマージされると自動でデプロイされる

## 確認コマンド
- バックエンドの型チェック: `cd backend && npx tsc --noEmit`
- フロントエンドの型チェック: `cd frontend && npx tsc --noEmit`
- DBの変更: `backend/prisma/schema.prisma` を編集し、`backend/prisma/migrations/<日時>_<名前>/migration.sql` を追加する（本番は起動時に `prisma migrate deploy`）

## 必ず守ること
- **`main` へ直接プッシュしない。** ブランチで作業し、プルリクエストで提出する。本番反映は運営者のマージのみ
- **秘密情報を扱わない。** `.env` を作成・コミットしない。APIキー・トークン・パスワードをコードやログに書かない
- 決済は Stripe のホスト型決済のみ。カード情報を扱わない
- LINE の channelSecret / channelAccessToken をフロントエンドに返さない
- AIに事実を作らせない: 実績・口コミ・限定特典・数字は、ユーザーが登録した事実以外を生成・表示しない（景品表示法）
- 新しいトップレベルの画面（`frontend/src/app/<名前>`）を追加したら、`backend/src/routes/lp.ts` の `RESERVED_SLUGS` にも同じ名前を追加する
- 外部サービス（Twilio・GitHub・Stripe など）のAPIは、公式ドキュメントで仕様を確認してから使う
- 自動投稿などの自動実行は、既定でオフ・人の承認つきにする

## 画面づくり
- スマホ幅（375px）で横スクロールが出ないこと、文字が不自然に折り返さないことを確認する
- 文言はポップで親しみやすい日本語（です・ます調）。ブランドのグラデーション（fuchsia → violet → sky）を使う
- 既存の機能を壊さない。変更は依頼の範囲にとどめる
