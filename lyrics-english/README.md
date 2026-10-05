# lyriclearn — 歌詞で英語学習(個人利用)

YouTube Music の歌詞画面(和訳表示つき)を録画 → 歌詞部分だけ切り抜き → yt-dlp で取った音源と同期 → 歌詞動画 + 単語/フレーズ教材を自動生成します。

```
download ─ yt-dlp で audio.mp3
record   ─ Playwright で歌詞画面を録画 + 再生位置/現在行(英語・和訳)を0.2秒ごとに記録 → meta.json
compose  ─ ffmpeg で歌詞パネルを crop・背景整形・音源とズレなく合成 → lyrics_video.mp4
study    ─ 行/単語/句動詞を抽出 → anki_lines.tsv, anki_words.tsv, 行ごとの音声クリップ, study.html
```

## セットアップ
```
pip install -e ".[nlp,llm,dev]"      # nlp=頻出語除外(wordfreq), llm=単語の意味付与(任意)
playwright install chromium          # ※ ffmpeg も必要
```

## 使い方(自分のPCで実行。ログインが必要なためクラウドでは動きません)
```
lyriclearn login                                   # 初回だけ。Premium アカウントでログイン
lyriclearn inspect "https://music.youtube.com/watch?v=XXXX"   # 歌詞DOMを確認 → config.py の Selectors を調整
lyriclearn all "https://music.youtube.com/watch?v=XXXX" [--llm] [--bg-key 0x212121 --bg-color navy]
```
`record` は歌詞タブを開き和訳を表示するよう促すので、準備できたら Enter。曲を 0:00 から再生し直して曲の終わりまで録画します。
成果物は `work/<動画ID>/` に出力されます(`lyrics_video.mp4`, `study/`)。

## 同期の仕組み
録画動画内の時刻(wall)と `<video>.currentTime`(playhead)を並行記録し、`wall - playhead` の中央値を「曲が0秒になる録画上の時刻」として動画を頭出しします。
ズレが残る場合は `Config.sync_nudge`(秒)で補正してください。

## 既知の制約
- YouTube Music の DOM は非公開で変わります。`config.py` の `Selectors` は推測の初期値なので、`inspect` の結果に合わせて調整が必要です(実アカウントでの動作は未検証)。
- 曲の途中で広告/再生位置の飛びがあると同期精度が落ちます(Premium なら通常問題なし)。
- 単語の意味は `--llm` 指定時のみ付与。無い場合は例文と和訳だけのカードになります。

## Discord エージェント(対話ループ)

```
export ANTHROPIC_API_KEY=... DISCORD_BOT_TOKEN=...
export DISCORD_ALLOWED_USER_IDS=あなたのDiscordユーザーID   # 必須。ログイン済みブラウザを操作するため
lyriclearn-bot                                             # ログイン済みの自分のPCで常駐
```
DM かメンションで話しかけます(`DISCORD_CHANNEL_ID` を設定すればそのチャンネルのみ)。

```
あなた: YOASOBI アイドル で作って
Bot   : 候補 1〜5 ... どれにしますか? → 1
Bot   : ジョブ開始。(進捗: ダウンロード→録画→編集→教材)
        …完了通知が自動で届き、Claude が単語を紹介 → 動画/Anki/HTML を添付
あなた: 映像が0.3秒早い → Bot: retune(sync_nudge) で再編集して再送
あなた: 次はこの曲 → ループ
```
- エージェントのツール: `search_songs` / `start_lyrics_job` / `job_status` / `list_jobs` / `show_vocab` / `retune` / `send_files`
- ジョブ完了・失敗は `[system]` 通知としてエージェントに自動で渡り、返信と成果物が投稿されます(これがループの駆動役)。
- YouTube Music の起動 → 歌詞タブ・和訳の自動表示 → 録画 → 編集は `record(manual_setup=False)` の `auto_setup` が担当。
  歌詞行が検出できなければ失敗として Discord に報告されます。
- モデルは `LYRICLEARN_MODEL`(既定 `claude-opus-5-5`)。Discord の25MB上限を超える動画は自動で再エンコードして送ります。
- ブラウザは1つなので、ジョブは直列に処理されます。

## Pixel(Android / Termux)版
和訳つき歌詞は YouTube Music **アプリ**にあるため、Termux + adb でアプリを操作して録画・読み取りする
Android バックエンドがあります(Termux では自動で選択)。手順は [docs/pixel.md](docs/pixel.md)。
Discord の `!update` で GitHub の最新コードを端末に取り込めます。

## 担当エージェントによる分業(Discord)
`!setup` で「Lyrics Lab」カテゴリに担当ごとのチャンネルを作成し、`!auto` で全工程を自動で流します。

| チャンネル | 担当 | 役割・成果物 |
|---|---|---|
| `1-curator` | 曲選定 | 日本のチャート(Apple Music/iTunes)+ Web 検索から、今最も聞かれている**英語の曲**を選ぶ。履歴で重複回避 → 曲URL |
| `2-recorder` | 録画 | YouTube Music の歌詞(和訳)画面を録画、失敗時は原因を読んで1回再試行 → 録画+時刻つき歌詞 |
| `3-editor` | 動画編集 | ジャケット/アーティスト写真/サムネの候補を**画像で見比べて選び**、元の背景を抜いて敷く。仕上がりフレームも目視確認して必要なら再調整 → 歌詞動画 |
| `4-teacher` | 教材 | 単語・フレーズ・文法・文化背景・クイズを作成(行番号と単語を検証して自己修正) → lesson.html / anki_vocab.tsv / quiz.md |
| `lyrics-lobby` | — | `!auto [ヒント]` / `!auto resume <工程>` で起動・再開、全体の進捗 |

各担当のチャンネルで話しかければ、その担当と直接やり取りして調整できます(例: 3-editor に「ジャケットじゃなくアーティスト写真で」)。
引き継ぎは共有の state(`work/last_run.json`)で行い、担当が成果を出せなければ lobby に報告して止まります(途中から再開可能)。
ボットには「チャンネルの管理」権限が必要です。
