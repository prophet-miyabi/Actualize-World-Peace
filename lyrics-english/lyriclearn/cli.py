import argparse
import json
from pathlib import Path

from .config import Config
from .download import download_audio, video_id
from .compose import compose
from .study import extract_words, llm_glosses, write_materials


def _work(url: str, root: Path) -> Path:
    return root / video_id(url)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="lyriclearn")
    ap.add_argument("--work", type=Path, default=Path("work"), help="作業ディレクトリ")
    ap.add_argument("--profile", type=Path, default=Path(".profile"), help="ブラウザのログイン情報の保存先")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("login", help="YouTube Music にログイン(初回のみ)")
    for name, h in [("inspect", "歌詞DOMの候補を表示(selector調整用)"), ("download", "音源MP3を取得"),
                    ("record", "歌詞画面を録画し歌詞/同期情報を保存"), ("compose", "切り抜き+音源合成で歌詞動画を作る"),
                    ("study", "教材(Anki/HTML/音声クリップ)を作る"), ("all", "download→record→compose→study")]:
        p = sub.add_parser(name, help=h)
        p.add_argument("url", help="https://music.youtube.com/watch?v=...")
        if name in ("record", "all"):
            p.add_argument("--headless", action="store_true")
            p.add_argument("--auto", action="store_true", help="手動セットアップを省略(歌詞タブを自動で開けた場合のみ)")
        if name in ("compose", "all"):
            p.add_argument("--bg-key", help="置換したい元の背景色 例 0x212121")
            p.add_argument("--bg-color", default="black")
        if name in ("study", "all"):
            p.add_argument("--llm", action="store_true", help="Claude で単語の日本語の意味を付与(要 ANTHROPIC_API_KEY)")
    a = ap.parse_args(argv)
    cfg = Config()
    if getattr(a, "bg_key", None):
        cfg.bg_key = a.bg_key
    if getattr(a, "bg_color", None):
        cfg.bg_color = a.bg_color

    if a.cmd == "login":
        from .record import login
        return login(a.profile, cfg)
    d = _work(a.url, a.work)
    steps = ["download", "record", "compose", "study"] if a.cmd == "all" else [a.cmd]
    if "inspect" in steps:
        from .record import inspect_dom
        return inspect_dom(a.url, a.profile, cfg)
    if "download" in steps:
        print("audio:", download_audio(a.url, d))
    if "record" in steps:
        from .record import record
        m = record(a.url, d, a.profile, cfg, headless=a.headless, manual_setup=not a.auto)
        print(f"recorded: {len(m['lines'])} lines, offset={m['offset']:.2f}s")
    meta = json.loads((d / "meta.json").read_text()) if (d / "meta.json").exists() else None
    if "compose" in steps:
        print("video:", compose(d / "recording.webm", d / "audio.mp3", meta, d / "lyrics_video.mp4", cfg))
    if "study" in steps:
        gl = llm_glosses(meta["lines"], extract_words(meta["lines"])) if a.llm else None
        print("materials:", write_materials(meta, d / "audio.mp3", d / "study", gl))


if __name__ == "__main__":
    main()
