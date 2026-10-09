---
name: awp-status
description: AWP の本番の健全性・AI企業の状況・ローンチ・クルーの進み具合を1画面にまとめて報告する
---
# この文書は backend/scripts/gen-claude-kit.ts が生成する。直すときは registry.ts か生成スクリプトを直す

1. mcp__awp__awp_health → 本番の起動・デプロイ中のコミット・AI接続・Claude Platform の可否
2. mcp__awp__awp_company_status（summary）→ 一時停止か、動いているエージェント、承認待ちの数、タスクの件数、今月の費用／上限
3. mcp__awp__awp_crew_status（summary）→ 公開まで日数、進み具合、遅れ・詰まり、次にあなたがやる作業
4. 異常（AI接続NG・失敗タスク・遅れ）があれば先頭に出し、直し方を1行で添える
5. 全体を10行以内にまとめる。数字は道具の値のみ
