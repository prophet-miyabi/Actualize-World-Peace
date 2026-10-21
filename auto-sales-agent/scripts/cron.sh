#!/bin/sh
# Auto-Sales-Agent の定期実行（cron 用）。例: 3時間ごと
#   0 */3 * * * /bin/sh /path/to/webline-sync/auto-sales-agent/scripts/cron.sh
# 必要な環境変数: ANTHROPIC_API_KEY, DISCORD_WEBHOOK_URL（backend/.env でも可）
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
LOG="$REPO/auto-sales-agent/output/cron.log"
mkdir -p "$(dirname "$LOG")"
echo "==== $(date '+%Y-%m-%d %H:%M:%S') scout" >> "$LOG"
node auto-sales-agent/scripts/scout.js >> "$LOG" 2>&1
echo "==== $(date '+%Y-%m-%d %H:%M:%S') batch" >> "$LOG"
node auto-sales-agent/scripts/batch.js --max 3 >> "$LOG" 2>&1
