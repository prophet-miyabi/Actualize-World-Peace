#!/data/data/com.termux/files/usr/bin/bash
# Discord ボットを起動する: bash scripts/termux_start.sh
cd "$(dirname "$0")/.."
[ -f "$HOME/.lyriclearn.env" ] || { echo "先に bash scripts/termux_secrets.sh を実行してください"; exit 1; }
. "$HOME/.lyriclearn.env"
python -c "import discord, anthropic" 2>/dev/null || { echo "依存パッケージが未インストールです。先に bash scripts/termux_setup.sh を実行してください"; exit 1; }
command -v termux-wake-lock >/dev/null && termux-wake-lock    # 画面を消してもボットが止まりにくくする
adb devices | grep -q "device$" || echo "⚠ adb が未接続です(python -m lyriclearn adb-setup)。録画の工程で失敗します"
exec python -m lyriclearn.discord_bot
