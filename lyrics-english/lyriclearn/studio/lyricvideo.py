"""音源+背景画像+(英語, 日本語訳)の行から、英語と和訳が同時に出る歌詞動画を作る(ASS字幕+ffmpeg)。"""
import subprocess
from pathlib import Path

from ..compose import probe_duration

FONT_DIRS = ["/system/fonts", "/usr/share/fonts", "/Library/Fonts", "C:/Windows/Fonts"]


def font_dir() -> str | None:
    return next((d for d in FONT_DIRS if Path(d).is_dir()), None)


def _t(sec: float) -> str:
    cs = int(round(sec * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def _esc(s: str) -> str:
    return s.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", "\\N")


def build_ass(lines: list[dict], title: str, artist: str, w: int, h: int, font: str = "Noto Sans CJK JP") -> str:
    """lines: [{start,end,text,translation}]。英語を中央線の上、和訳を下に同時表示し、次の行を薄くプレビュー。"""
    base = min(w, h * 1.4) * 0.056 if w >= h else w * 0.07
    en, ja, nx, hd = int(base), int(base * 0.68), int(base * 0.5), int(base * 0.55)
    head = (f"[Script Info]\nScriptType: v4.00+\nPlayResX: {w}\nPlayResY: {h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
            "[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,"
            "Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\n"
            f"Style: EN,{font},{en},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,{int(w*.06)},{int(w*.06)},20,1\n"
            f"Style: JA,{font},{ja},&H0000E5FF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2.5,1,8,{int(w*.06)},{int(w*.06)},20,1\n"
            f"Style: NEXT,{font},{nx},&H80FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,{int(w*.08)},{int(w*.08)},20,1\n"
            f"Style: HEAD,{font},{hd},&H30FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,8,{int(w*.05)},{int(w*.05)},20,1\n\n"
            "[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n")
    cy = int(h * 0.50)
    ev = []
    if title or artist:
        ev.append(f"Dialogue: 0,{_t(0)},9:59:59.00,HEAD,,0,0,0,,{{\\pos({w//2},{int(h*0.04)})}}{_esc(' — '.join(x for x in (artist, title) if x))}")
    for i, ln in enumerate(lines):
        s, e = _t(ln["start"]), _t(ln["end"])
        ev.append(f"Dialogue: 1,{s},{e},EN,,0,0,0,,{{\\an2\\pos({w//2},{cy})\\fad(120,120)}}{_esc(ln['text'])}")
        if ln.get("translation"):
            ev.append(f"Dialogue: 1,{s},{e},JA,,0,0,0,,{{\\an8\\pos({w//2},{cy + int(en*0.25)})\\fad(120,120)}}{_esc(ln['translation'])}")
        if i + 1 < len(lines):
            ev.append(f"Dialogue: 0,{_t(ln['start'])},{_t(lines[i+1]['start'])},NEXT,,0,0,0,,"
                      f"{{\\an8\\pos({w//2},{int(h*0.80)})}}{_esc(lines[i+1]['text'])}")
    return head + "\n".join(ev) + "\n"


def render(lines: list[dict], audio: Path, out: Path, work_dir: Path, title: str = "", artist: str = "",
           bg_image: str | None = None, w: int = 1280, h: int = 720, blur: float = 24, show_cover: bool = True,
           font: str = "Noto Sans CJK JP") -> Path:
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / "lyrics.ass").write_text(build_ass(lines, title, artist, w, h, font), encoding="utf-8")
    dur = probe_duration(audio)
    fd = font_dir()
    ass = "ass=lyrics.ass" + (f":fontsdir={fd}" if fd else "")
    cmd = ["ffmpeg", "-y"]
    if bg_image:
        cmd += ["-loop", "1", "-framerate", "30", "-i", str(Path(bg_image).resolve())]
        cov = int((w if h > w else h) * (0.3 if h > w else 0.2)) // 2 * 2
        pos = f"(W-w)/2:{int(h*0.1)}" if h > w else f"{int(w*0.04)}:H-h-{int(h*0.06)}"
        scaled = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"
        dim = f"gblur=sigma={blur},eq=brightness=-0.28:saturation=1.1"
        if show_cover:    # 背景はぼかして暗く、ジャケットは鮮明なまま小さく添える
            flt = (f"[0:v]{scaled},split=2[a][b];[a]{dim}[bg];"
                   f"[b]scale={cov}:{cov}:force_original_aspect_ratio=increase,crop={cov}:{cov}[cv];"
                   f"[bg][cv]overlay={pos}[v0];[v0]{ass}[v]")
        else:
            flt = f"[0:v]{scaled},{dim},{ass}[v]"
    else:
        cmd += ["-f", "lavfi", "-i", f"color=c=0x101828:s={w}x{h}:r=30"]
        flt = f"[0:v]{ass}[v]"
    cmd += ["-i", str(audio), "-filter_complex", flt, "-map", "[v]", "-map", "1:a", "-t", f"{dur:.3f}", "-r", "30",
            "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(out.resolve())]
    r = subprocess.run(cmd, cwd=work_dir, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("動画の生成に失敗: " + r.stderr[-600:])
    return out
