"""yt-dlp で音源(MP3)を取得する。"""
import re
from pathlib import Path


def video_id(url: str) -> str:
    m = re.search(r"[?&]v=([\w-]{11})", url) or re.search(r"youtu\.be/([\w-]{11})", url)
    if not m:
        raise ValueError(f"動画IDを URL から取得できません: {url}")
    return m.group(1)


def download_audio(url: str, out_dir: Path) -> Path:
    import yt_dlp

    out_dir.mkdir(parents=True, exist_ok=True)
    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(out_dir / "audio.%(ext)s"),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    return out_dir / "audio.mp3"
