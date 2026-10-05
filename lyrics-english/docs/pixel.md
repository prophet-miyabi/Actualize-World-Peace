# Pixel(Termux)で動かす

PC ブラウザ版では和訳つき歌詞が出ないため、Pixel の **YouTube Music アプリ** を adb で操作して録画・読み取りします。
(Pixel 標準の Linux ターミナルは VM 内で動き、アプリの画面を録画できないため Termux を使います。)

## 1. 準備(Termux — F-Droid 版を推奨)
```
pkg update && pkg install -y python git ffmpeg android-tools build-essential libffi openssl
git clone https://github.com/prophet-miyabi/Actualize-World-Peace.git
cd Actualize-World-Peace && git checkout claude/english-learning-lyrics-system-flpx9f
cd lyrics-english
pip install -e ".[nlp]"
python -m lyriclearn demo           # ffmpeg 等の確認(ログイン不要)
```
`discord.py` / `wordfreq` のビルドで失敗したら、そのエラーを共有してください。

## 2. adb を自分の端末につなぐ(ワイヤレスデバッグ)
1. 設定 > デバイス情報 > ビルド番号を7回タップ → 開発者向けオプションが出る
2. 開発者向けオプション > **ワイヤレスデバッグ** をオン(Wi-Fi 接続が必要)
3. 「ペア設定コードによるデバイスのペア設定」を開き、画面のまま Termux で:
```
python -m lyriclearn adb-setup
```
ペア用の IP:ポートとコード、続けて**メイン画面の IP:ポート**(ペア用とは別)を入力します。Termux と設定画面は分割画面にすると楽です。

## 3. 歌詞画面の読み取りを調整
YouTube Music アプリで曲を再生し、歌詞タブを開いて**和訳を表示**した状態で:
```
python -m lyriclearn adb-inspect
```
画面のテキストと「英語⇔和訳の対応」「再生中と判定した行」が出ます。ずれていれば
`LYRICLEARN_FOCUS_Y`(再生中の行が来る縦位置。0〜1、既定0.35)を調整します。

## 4. 実行
```
python -m lyriclearn search Bruno Mars I Just Might      # 候補のURL
python -m lyriclearn all "https://music.youtube.com/watch?v=..."
```
録画中は端末の画面を触らず、YouTube Music を前面に出したままにします(画面は自動で点灯し続けます)。

## 5. Discord から操作
```
export ANTHROPIC_API_KEY=... DISCORD_BOT_TOKEN=... DISCORD_ALLOWED_USER_IDS=あなたのID
termux-wake-lock                    # Termux 通知の「Acquire wakelock」でも可。ボット常駐用
python -m lyriclearn.discord_bot
```
曲名を話しかければ、これまでと同じ対話ループで進みます。端末の保守コマンド:

| コマンド | 内容 |
|---|---|
| `!status` | 版・adb・ジョブの状態 |
| `!update` | GitHub の最新コードを `git pull --ff-only` で取り込み、ボットを再起動 |
| `!adb` | adb 接続の確認 |
| `!restart` | 再起動(実行中ジョブがあれば `force` が必要) |

**コードの配信経路は GitHub → `!update` のみ**です。Discord の添付ファイルをコードとして書き込む機能や、
任意のシェル実行は付けていません(アカウントが乗っ取られても、端末でコードを実行させないため)。
