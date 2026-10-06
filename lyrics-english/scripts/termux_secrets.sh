#!/data/data/com.termux/files/usr/bin/bash
# トークン等を ~/.lyriclearn.env に保存する。入力は画面に表示されず、コマンド履歴にも残らない。
set -e
F="$HOME/.lyriclearn.env"
while true; do
  read -r -s -p "DISCORD_BOT_TOKEN (Reset Token で再発行した新しいもの。画面には出ません): " T; echo
  [[ "$T" =~ ^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$ ]] && break
  echo "  → トークンの形式ではありません(空、または貼り付け失敗)。Developer Portal の Bot > Reset Token でコピーし直してください"
done
while true; do
  read -r -p "DISCORD_ALLOWED_USER_IDS (あなたの Discord ユーザーID。数字のみ。メールアドレスではない): " U
  [[ "$U" =~ ^[0-9]{15,22}(,[0-9]{15,22})*$ ]] && break
  echo "  → 数字(17〜19桁)で入力してください。Discord: 設定 > 詳細設定 > 開発者モード をオン → 自分のアイコンを右クリック > ユーザーIDをコピー"
done
while true; do
  read -r -s -p "ANTHROPIC_API_KEY (sk-ant- で始まる): " K; echo
  [[ "$K" == sk-ant-* ]] && break
  echo "  → sk-ant- で始まるキーを入力してください"
done
umask 077
cat > "$F" <<EOT
export DISCORD_BOT_TOKEN='$T'
export DISCORD_ALLOWED_USER_IDS='$U'
export ANTHROPIC_API_KEY='$K'
EOT
chmod 600 "$F"
echo "保存しました: $F (自分だけ読めます)"
echo "確認(中身は表示しない): トークン${#T}文字 / ID ${U} / APIキー${#K}文字"
echo "次: bash scripts/termux_start.sh"
