import argparse
import json
from pathlib import Path

from .config import Config
from .download import download_audio, video_id
from .compose import compose
from .study import extract_words, llm_glosses, write_materials


def _work(url: str, root: Path) -> Path:
    return root / video_id(url)


def demo(d: Path):
    """ffmpeg の合成映像/音声と固定の歌詞で、編集と教材作成まで通す。ffmpeg と環境の確認用。"""
    import subprocess
    d.mkdir(parents=True, exist_ok=True)
    ff = lambda *x: subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *x], check=True)
    ff("-f", "lavfi", "-i", "testsrc=s=1280x720:d=14:r=15", "-c:v", "libvpx", str(d / "recording.webm"))
    ff("-f", "lavfi", "-i", "sine=f=440:d=10", str(d / "audio.mp3"))
    lines = [("We never give up on the dream", "夢を決して諦めない"), ("Hold on to the light tonight", "今夜は光にしがみついて"),
             ("Running through the endless night", "終わらない夜を駆け抜ける")]
    meta = {"offset": 2.0, "crop": {"x": 160, "y": 90, "w": 960, "h": 540},
            "lines": [{"start": i * 3.0, "end": i * 3.0 + 2.5, "text": t, "translation": j} for i, (t, j) in enumerate(lines)]}
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print("video:", compose(d / meta.get("recording", "recording.webm"), d / "audio.mp3", meta, d / "lyrics_video.mp4", Config()))
    print("materials:", write_materials(meta, d / "audio.mp3", d / "study"))
    print("出力先:", d.resolve())


def main(argv=None):
    ap = argparse.ArgumentParser(prog="lyriclearn")
    ap.add_argument("--work", type=Path, default=Path("work"), help="作業ディレクトリ")
    ap.add_argument("--profile", type=Path, default=Path(".profile"), help="ブラウザのログイン情報の保存先")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("login", help="YouTube Music にログイン(初回のみ)")
    sub.add_parser("adb-setup", help="[Android] ワイヤレスデバッグのペアリングと接続")
    sub.add_parser("adb-inspect", help="[Android] 歌詞画面を出した状態で、読み取れるテキストと対応を表示")
    sp = sub.add_parser("search", help="曲名で検索して YouTube Music の URL 候補を表示")
    sp.add_argument("query", nargs="+")
    sub.add_parser("demo", help="ログイン不要の動作確認(合成の録画/音声で compose→study を実行)")
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

    if a.cmd == "adb-setup":
        from .android import setup
        return setup(cfg)
    if a.cmd == "adb-inspect":
        from .android import inspect
        return inspect(cfg)
    if a.cmd == "search":
        from .agent import search_songs
        for r in search_songs(" ".join(a.query)):
            print(f"{r['n']}. {r['title']} / {r['channel']} ({r['duration']}s)\n   {r['url']}")
        return
    if a.cmd == "demo":
        return demo(a.work / "demo")
    if a.cmd == "login":
        from .record import login
        return login(a.profile, cfg)
    if a.cmd == "inspect":
        from .record import inspect_dom
        return inspect_dom(a.url, a.profile, cfg)
    try:
        d = _work(a.url, a.work)
    except ValueError as e:
        raise SystemExit(f"{e}\n例: https://music.youtube.com/watch?v=dQw4w9WgXcQ のように、実際の曲のURLを指定してください")
    steps = ["download", "record", "compose", "study"] if a.cmd == "all" else [a.cmd]
    if "download" in steps:
        print("audio:", download_audio(a.url, d))
    if "record" in steps:
        if cfg.backend == "android":
            from .android import record as arecord
            from .compose import probe_duration
            m = arecord(a.url, d, cfg, duration=probe_duration(d / "audio.mp3"))
        else:
            from .record import record
            m = record(a.url, d, a.profile, cfg, headless=a.headless, manual_setup=not a.auto)
        print(f"recorded: {len(m['lines'])} lines, offset={m['offset']:.2f}s")
    meta = json.loads((d / "meta.json").read_text()) if (d / "meta.json").exists() else None
    if "compose" in steps:
        print("video:", compose(d / meta.get("recording", "recording.webm"), d / "audio.mp3", meta, d / "lyrics_video.mp4", cfg))
    if "study" in steps:
        gl = llm_glosses(meta["lines"], extract_words(meta["lines"])) if a.llm else None
        print("materials:", write_materials(meta, d / "audio.mp3", d / "study", gl))


if __name__ == "__main__":
    main()
