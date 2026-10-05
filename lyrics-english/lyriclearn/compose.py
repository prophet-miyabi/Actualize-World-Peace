"""録画を歌詞パネルに切り抜き、背景を整え、ダウンロードした音源と同期させて1本の動画にする。"""
import subprocess
from pathlib import Path

from .config import Config


def probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def build_filter(crop: dict | None, cfg: Config) -> str:
    """[0:v] → [v]。crop なしなら全画面をそのまま使う。"""
    w, h = cfg.out_w, cfg.out_h
    parts = []
    if crop:
        # 偶数に丸めて画面外にはみ出さないようにする
        cw, ch = int(crop["w"]) // 2 * 2, int(crop["h"]) // 2 * 2
        cx, cy = max(int(crop["x"]), 0), max(int(crop["y"]), 0)
        parts.append(f"crop={cw}:{ch}:{cx}:{cy}")
    parts.append(f"scale={w}:{h}:force_original_aspect_ratio=decrease")
    fg = ",".join(parts)
    if cfg.bg_key:
        fg += f",colorkey={cfg.bg_key}:0.15:0.1"
        return (f"[0:v]{fg}[fg];color=c={cfg.bg_color}:s={w}x{h}[bg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p[v]")
    return f"[0:v]{fg},pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={cfg.bg_color},format=yuv420p[v]"


def compose(recording: Path, audio: Path, meta: dict, out: Path, cfg: Config) -> Path:
    """offset 秒より前(曲の再生前)を捨て、音源の長さに合わせて出力する。"""
    dur = probe_duration(audio)
    cmd = ["ffmpeg", "-y", "-ss", f"{meta['offset']:.3f}", "-i", str(recording), "-i", str(audio),
           "-filter_complex", build_filter(meta.get("crop"), cfg),
           "-map", "[v]", "-map", "1:a", "-t", f"{dur:.3f}",
           "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-b:a", "192k",
           "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True, capture_output=True)
    return out
