#!/data/data/com.termux/files/usr/bin/bash
# Termux 用の初回セットアップ。リポジトリ内の lyrics-english で実行する: bash scripts/termux_setup.sh
set -e
pkg update -y
pkg install -y python git ffmpeg android-tools build-essential libffi openssl
# Termux では aiohttp 系の C 拡張のビルドが失敗しやすいので、純Python版を使う
export MULTIDICT_NO_EXTENSIONS=1 YARL_NO_EXTENSIONS=1 FROZENLIST_NO_EXTENSIONS=1 AIOHTTP_NO_EXTENSIONS=1
pkg install -y rust binutils || true       # anthropic が依存する pydantic-core / jiter のビルド用(時間がかかる)
pip install -e ".[nlp]"
python -m lyriclearn demo
echo
echo "== セットアップ完了 =="
echo "次: bash scripts/termux_secrets.sh  (トークン等を安全に保存)"
