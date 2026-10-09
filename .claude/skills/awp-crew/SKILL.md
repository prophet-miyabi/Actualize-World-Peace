---
name: awp-crew
description: ローンチ・クルー（公開までの計画）の今日の予定と、あなたの次の作業を案内する
---
# この文書は backend/scripts/gen-claude-kit.ts が生成する。直すときは registry.ts か生成スクリプトを直す

1. mcp__awp__awp_crew_status（summary と today）
2. 「いまやること（15分刻み）」「遅れているもの」「詰まっているもの」「エージェントが進めているもの（PRのリンク）」を出す
3. 運営者が「終わった」「詰まった」と言ったら mcp__awp__awp_crew_task で状態を更新し、必要なら mcp__awp__awp_crew_tick で予定を組み直す
