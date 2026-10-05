#!/data/data/com.termux/files/usr/bin/bash
# Discord ボットを起動する: bash scripts/termux_start.sh
cd "$(dirname "$0")/.."
[ -f "$HOME/.lyriclearn.env" ] || { echo "先に bash scripts/termux_secrets.sh を実行してください"; exit 1; }
. "$HOME/.lyriclearn.env"
command -v termux-wake-lock >/dev/null && termux-wake-lock    # 画面を消してもボットが止まりにくくする
adb devices | grep -q "device$" || echo "⚠ adb が未接続です(python -m lyriclearn adb-setup)。録画の工程で失敗します"
exec python -m lyriclearn.discord_bot
