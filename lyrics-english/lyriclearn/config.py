"""調整が必要になりやすい設定値。YouTube Music の DOM は変わるので selector はここに集約する。"""
import os
import sys
from dataclasses import dataclass, field


@dataclass
class Selectors:
    # 歌詞パネル全体（切り抜き範囲の基準になる要素）
    panel: str = "ytmusic-player-page #tabs-content, ytmusic-description-shelf-renderer"
    # 歌詞1行ぶんの要素
    line: str = "ytmusic-player-page .lyrics-line, ytmusic-player-page [class*='lyric'] [class*='line']"
    # line の中の和訳テキスト（無ければ空文字扱い）
    translation: str = "[class*='translation'], [class*='translated']"
    # 現在再生中の行にだけ当てはまる selector
    active: str = ".active, [active], [aria-current='true'], [class*='current']"
    video: str = "video"
    # 自動セットアップ用: タブ名・和訳トグルのラベルに一致する正規表現
    lyrics_tab_re: str = "歌詞|Lyrics"
    translate_btn_re: str = "翻訳|和訳|Translat"


@dataclass
class Config:
    viewport_w: int = 1280
    viewport_h: int = 720
    out_w: int = 1280
    out_h: int = 720
    bg_color: str = "black"          # 余白(背景)の色
    bg_key: str | None = None        # 元画面の背景色(例 "0x212121")。指定すると透過して bg_color に置換
    poll_interval: float = 0.2       # 歌詞DOMを読む間隔(秒)
    sync_nudge: float = 0.0          # 録画開始と再生位置のズレ補正(秒)。+で映像を遅らせる
    # 同梱 Chromium は Google ログインで弾かれるため、Windows では本物の Edge を使う。
    # LYRICLEARN_BROWSER=chrome|msedge|chromium で変更可(chromium=同梱版)
    browser: str = os.environ.get("LYRICLEARN_BROWSER", "msedge" if sys.platform == "win32" else "chromium")
    selectors: Selectors = field(default_factory=Selectors)
