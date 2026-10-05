"""録画を歌詞パネルに切り抜き、背景を整え、ダウンロードした音源と同期させて1本の動画にする。"""
import subprocess
from pathlib import Path

from .config import Config


def probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def detect_bg_key(recording: Path, crop: dict | None, at: float = 3.0) -> str:
    """録画の四隅の色から、元の背景色(colorkey 用の 0xRRGGBB)を推定する。"""
    x, y, w, h = (int(crop[k]) for k in ("x", "y", "w", "h")) if crop else (0, 0, 640, 360)
    pts = [(x + 2, y + 2), (x + w - 6, y + 2), (x + 2, y + h - 6), (x + w - 6, y + h - 6)]
    cols = []
    for px, py in pts:
        r = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(at), "-i", str(recording), "-vf",
                            f"crop=4:4:{px}:{py},scale=1:1,format=rgb24", "-frames:v", "1", "-f", "rawvideo", "-"],
                           capture_output=True)
        if len(r.stdout) >= 3:
            cols.append(tuple(r.stdout[:3]))
    if not cols:
        raise RuntimeError("背景色を検出できませんでした")
    med = [sorted(c[i] for c in cols)[len(cols) // 2] for i in range(3)]
    return "0x%02X%02X%02X" % tuple(med)


def build_filter(crop: dict | None, cfg: Config, has_image: bool = False) -> str:
    """[0:v](+ 画像なら [2:v]) → [v]。crop なしなら全画面をそのまま使う。"""
    w, h = cfg.out_w, cfg.out_h
    parts = []
    if crop:
        # 偶数に丸めて画面外にはみ出さないようにする
        cw, ch = int(crop["w"]) // 2 * 2, int(crop["h"]) // 2 * 2
        cx, cy = max(int(crop["x"]), 0), max(int(crop["y"]), 0)
        parts.append(f"crop={cw}:{ch}:{cx}:{cy}")
    key = f",colorkey={cfg.bg_key}:{cfg.key_similarity}:0.1" if cfg.bg_key else ""
    if has_image:
        inset = cfg.inset_cover and h > w
        cov = int(min(w, h) * 0.42) // 2 * 2
        top, margin = int(h * 0.03), int(h * 0.03)
        ph = (h - cov - top - 2 * margin) if inset else h
        fg = ",".join(parts + [f"scale={w}:{ph}:force_original_aspect_ratio=decrease"]) + key
        bg = (f"[2:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},split=2[a][b];"
              f"[a]gblur=sigma={cfg.bg_blur},eq=brightness=-0.3:saturation=1.1[bg];"
              f"[b]scale={cov}:{cov}:force_original_aspect_ratio=increase,crop={cov}:{cov}[cov];") if inset else (
              f"[2:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
              f"gblur=sigma={cfg.bg_blur},eq=brightness=-0.3:saturation=1.1[bg];")
        y = f"(H+{top + cov}-h)/2" if inset else "(H-h)/2"      # ジャケットの下の領域の中央
        out = f"[bg][fg]overlay=(W-w)/2:{y}:shortest=1[t];" + ("[t][cov]overlay=(W-w)/2:%d[v0];" % top if inset else "[t]null[v0];")
        return f"{bg}[0:v]{fg}[fg];{out}[v0]format=yuv420p[v]"
    parts.append(f"scale={w}:{h}:force_original_aspect_ratio=decrease")
    fg = ",".join(parts)
    if cfg.bg_key:
        fg += f",colorkey={cfg.bg_key}:{cfg.key_similarity}:0.1"
        return (f"[0:v]{fg}[fg];color=c={cfg.bg_color}:s={w}x{h}[bg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p[v]")
    return f"[0:v]{fg},pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={cfg.bg_color},format=yuv420p[v]"


def compose(recording: Path, audio: Path, meta: dict, out: Path, cfg: Config) -> Path:
    """offset 秒より前(曲の再生前)を捨て、音源の長さに合わせて出力する。cfg.bg_image があれば背景に敷く。"""
    dur = probe_duration(audio)
    img = Path(cfg.bg_image) if cfg.bg_image else None
    cmd = ["ffmpeg", "-y", "-ss", f"{meta['offset']:.3f}", "-i", str(recording), "-i", str(audio)]
    if img:
        cmd += ["-loop", "1", "-i", str(img)]
    cmd += ["-filter_complex", build_filter(meta.get("crop"), cfg, has_image=bool(img)),
            "-map", "[v]", "-map", "1:a", "-t", f"{dur:.3f}",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True, capture_output=True)
    return out


def stitch_segments(segments: list[tuple[Path, float]], out: Path) -> Path:
    """screenrecord の分割ファイルを、実時刻どおりの1本に繋ぐ。

    segments: [(ファイル, 最初のセグメント開始からの開始秒), ...]。区間の隙間は直前の最終フレームで埋め、
    動画の時間軸が実時間とずれないようにする。
    """
    if not segments:
        raise RuntimeError("録画ファイルを取得できませんでした")
    cmd, parts = ["ffmpeg", "-y"], []
    for i, (f, start) in enumerate(segments):
        cmd += ["-i", str(f)]
        nxt = segments[i + 1][1] if i + 1 < len(segments) else None
        gap = max(nxt - start - probe_duration(f), 0) if nxt is not None else 0
        pad = f",tpad=stop_mode=clone:stop_duration={gap:.3f}" if gap > 0 else ""
        parts.append(f"[{i}:v]fps=30,setpts=PTS-STARTPTS{pad}[v{i}]")
    chain = "".join(f"[v{i}]" for i in range(len(segments)))
    flt = ";".join(parts) + f";{chain}concat=n={len(segments)}:v=1:a=0[v]"
    cmd += ["-filter_complex", flt, "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", str(out)]
    subprocess.run(cmd, check=True, capture_output=True)
    return out
