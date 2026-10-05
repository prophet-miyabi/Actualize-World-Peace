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
