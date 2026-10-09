---
name: awp-task
description: 引数の指示をAI企業のエージェントに任せる（例: /awp-task finance 今月の採算を出して）
---
# この文書は backend/scripts/gen-claude-kit.ts が生成する。直すときは registry.ts か生成スクリプトを直す

引数: <担当のキー> <指示>。担当が省かれていれば内容から最適な担当を選ぶ（調査=research、数字=data、お金=finance、法務=legal、安全=security、文章=content、実装=engineering）
1. 指示を「目的・期待する成果物・制約」に整えて mcp__awp__awp_create_task で作る（risk は内容に応じて）
2. 急ぎなら mcp__awp__awp_run_task
3. 作ったタスクIDと、結果の見方（mcp__awp__awp_task / 管理画面）を伝える。結果が出るまでは待たずに戻る
