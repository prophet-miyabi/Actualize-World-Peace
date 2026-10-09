---
name: awp-approve
description: AI企業の承認待ち（高リスク操作）を一覧し、運営者の判断に従って承認／却下する
---
# この文書は backend/scripts/gen-claude-kit.ts が生成する。直すときは registry.ts か生成スクリプトを直す

1. mcp__awp__awp_company_status（approvals）で承認待ちを取る。なければ「承認待ちはありません」で終わる
2. 1件ずつ「誰が・何を・なぜ・リスク」を短く示し、関係するタスクは mcp__awp__awp_task で背景を補う
3. 運営者が決めるまで待つ。決めたら mcp__awp__awp_decide_action（却下は理由を note に）
4. 承認した操作は実行結果が新しいタスクとして返るので、必要なら少し後に mcp__awp__awp_tasks で確認して報告
