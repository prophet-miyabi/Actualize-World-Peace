# Auto-Sales-Agent の定期実行（Windows タスク スケジューラ用）
#   登録例（3時間ごと）:
#   schtasks /Create /SC HOURLY /MO 3 /TN "AWP Auto-Sales" /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\qqrb3\Documents\webline-sync-setup\webline-sync\auto-sales-agent\scripts\cron.ps1"
#   必要な環境変数は backend/.env か、ユーザー環境変数に: ANTHROPIC_API_KEY, DISCORD_WEBHOOK_URL
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
$log = Join-Path $repo 'auto-sales-agent\output\cron.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
"==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') scout" | Out-File -Append -Encoding utf8 $log
node auto-sales-agent/scripts/scout.js 2>&1 | Out-File -Append -Encoding utf8 $log
"==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') batch" | Out-File -Append -Encoding utf8 $log
node auto-sales-agent/scripts/batch.js --max 3 2>&1 | Out-File -Append -Encoding utf8 $log
