"""背景に使う画像の候補集め(アルバムジャケット/アーティスト写真/YouTubeサムネ)と、確認用フレームの切り出し。"""
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

from .charts import get_json


def fetch(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 lyriclearn"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def candidate_urls(title: str, artist: str, video_url: str | None) -> list[tuple[str, str]]:
    """(説明, 画像URL) の候補。取得に失敗した情報源は黙って飛ばす。"""
    out = []
    try:
        q = urllib.parse.urlencode({"term": f"{artist} {title}", "entity": "song", "country": "jp", "limit": 3})
        for r in get_json(f"https://itunes.apple.com/search?{q}")["results"]:
            out.append((f"アルバムジャケット: {r['collectionName']} / {r['artistName']}",
                        r["artworkUrl100"].replace("100x100bb", "1000x1000bb")))
    except Exception:
        pass
    try:
        j = get_json("https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(artist.replace(" ", "_")))
        if "originalimage" in j:
            out.append((f"アーティスト写真(Wikipedia): {j.get('title')}", j["originalimage"]["source"]))
    except Exception:
        pass
    if video_url:
        try:
            import yt_dlp
            with yt_dlp.YoutubeDL({"quiet": True}) as ydl:
                info = ydl.extract_info(video_url, download=False)
            if info.get("thumbnail"):
                out.append(("YouTube のサムネイル", info["thumbnail"]))
        except Exception:
            pass
    return out


def collect(title: str, artist: str, video_url: str | None, out_dir: Path) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    res = []
    for i, (desc, url) in enumerate(candidate_urls(title, artist, video_url)):
        try:
            data = fetch(url)
        except Exception:
            continue
        p = out_dir / f"cand_{len(res)}.jpg"
        p.write_bytes(data)
        res.append({"id": len(res), "source": desc, "path": str(p), "url": url})
    return res


def shrink_jpeg(src: Path, max_side: int = 768) -> bytes:
    """確認用に縮小した JPEG を返す(モデルに見せる画像のサイズ節約)。"""
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-vf",
                        f"scale='min({max_side},iw)':'min({max_side},ih)':force_original_aspect_ratio=decrease",
                        "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"], capture_output=True, check=True)
    return r.stdout


def extract_frame(video: Path, t: float) -> bytes:
    r = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(video), "-frames:v", "1",
                        "-vf", "scale='min(768,iw)':-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
                       capture_output=True, check=True)
    return r.stdout
