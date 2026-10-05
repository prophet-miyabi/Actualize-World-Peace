#!/data/data/com.termux/files/usr/bin/bash
# Termux 用の初回セットアップ。リポジトリ内の lyrics-english で実行する: bash scripts/termux_setup.sh
set -e
pkg update -y
pkg install -y python git ffmpeg android-tools build-essential libffi openssl
pip install -e ".[nlp]"
python -m lyriclearn demo
echo
echo "== セットアップ完了 =="
echo "次: bash scripts/termux_secrets.sh  (トークン等を安全に保存)"
