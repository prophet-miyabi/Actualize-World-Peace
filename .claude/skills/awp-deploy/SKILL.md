---
name: awp-deploy
description: 変更を本番に反映して確認するまでの手順（型チェック → コミット → push → Render のデプロイ待ち → 健全性の確認）
---
# この文書は backend/scripts/gen-claude-kit.ts が生成する。直すときは registry.ts か生成スクリプトを直す

1. backend と frontend で npx tsc --noEmit を通す（失敗したら直す）
2. 変更内容を日本語で要約してコミット（末尾に Co-Authored-By を付ける）し、origin main に push
3. mcp__awp__awp_health を30秒ごとに呼び、backend.commit が push したコミットの先頭7文字になるまで待つ（最長12分）
4. ai.ok が true、badModels が空、managed が ok であることを確認
5. 変えた画面があれば URL を示し、運営者に見てもらうポイントを3つ以内で伝える
