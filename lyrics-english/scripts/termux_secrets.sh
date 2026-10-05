#!/data/data/com.termux/files/usr/bin/bash
# トークン等を ~/.lyriclearn.env に保存する。入力は画面に表示されず、コマンド履歴にも残らない。
set -e
F="$HOME/.lyriclearn.env"
read -r -s -p "DISCORD_BOT_TOKEN (Reset Token で再発行した新しいもの): " T; echo
read -r -p "DISCORD_ALLOWED_USER_IDS (あなたの Discord ユーザーID): " U
read -r -s -p "ANTHROPIC_API_KEY: " K; echo
umask 077
cat > "$F" <<EOT
export DISCORD_BOT_TOKEN='$T'
export DISCORD_ALLOWED_USER_IDS='$U'
export ANTHROPIC_API_KEY='$K'
EOT
chmod 600 "$F"
echo "保存しました: $F (自分だけ読めます)"
echo "次: bash scripts/termux_start.sh"
