"""Playwright で YouTube Music の歌詞画面を録画し、同時に歌詞DOMと再生位置を記録する。

初回は `login` でブラウザを開き、サブスク加入済みアカウントでログインしておく(プロファイルは保存される)。
"""
import json
import shutil
import time
from pathlib import Path

from .config import Config
from .segments import build_lines, estimate_offset

POLL_JS = """
(sel) => {
  const v = document.querySelector(sel.video);
  const lines = [...document.querySelectorAll(sel.line)];
  const act = lines.find(e => e.matches(sel.active));
  const tr = act ? act.querySelector(sel.translation) : null;
  let text = act ? act.innerText : '';
  if (tr) text = text.replace(tr.innerText, '');
  const p = document.querySelector(sel.panel);
  const r = p ? p.getBoundingClientRect() : null;
  return {
    playhead: v ? v.currentTime : -1, paused: v ? v.paused : true, duration: v ? v.duration : 0,
    text: text.trim(), translation: tr ? tr.innerText.trim() : '',
    rect: r ? {x: r.x, y: r.y, w: r.width, h: r.height} : null,
  };
}
"""


def _context(pw, profile: Path, cfg: Config, headless: bool, video_dir: Path | None):
    kw = dict(user_data_dir=str(profile), headless=headless,
              viewport={"width": cfg.viewport_w, "height": cfg.viewport_h},
              args=["--autoplay-policy=no-user-gesture-required"])
    if video_dir:
        kw.update(record_video_dir=str(video_dir), record_video_size={"width": cfg.viewport_w, "height": cfg.viewport_h})
    return pw.chromium.launch_persistent_context(**kw)


def login(profile: Path, cfg: Config):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        ctx = _context(pw, profile, cfg, headless=False, video_dir=None)
        page = ctx.new_page()
        page.goto("https://music.youtube.com")
        input("ブラウザで YouTube Music にログインしたら Enter を押してください > ")
        ctx.close()


def inspect_dom(url: str, profile: Path, cfg: Config):
    """歌詞タブを開いた状態の DOM 候補を表示する。selector 調整用。"""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        ctx = _context(pw, profile, cfg, headless=False, video_dir=None)
        page = ctx.new_page()
        page.goto(url)
        input("歌詞タブを開き、和訳を表示してから Enter > ")
        info = page.evaluate("""() => [...document.querySelectorAll('[class*=lyric],[class*=translat],ytmusic-description-shelf-renderer')]
            .slice(0, 40).map(e => ({tag: e.tagName.toLowerCase(), cls: e.className, text: (e.innerText||'').slice(0, 60)}))""")
        print(json.dumps(info, ensure_ascii=False, indent=2))
        ctx.close()


def record(url: str, out_dir: Path, profile: Path, cfg: Config, headless: bool = False,
           manual_setup: bool = True, max_seconds: float | None = None) -> dict:
    from playwright.sync_api import sync_playwright

    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / "_video"
    shutil.rmtree(tmp, ignore_errors=True)
    sel = cfg.selectors.__dict__
    poll, wall_samples, rect = [], [], None

    with sync_playwright() as pw:
        ctx = _context(pw, profile, cfg, headless, tmp)
        page = ctx.new_page()
        t0 = time.monotonic()  # 録画は page 作成時から始まる
        page.goto(url)
        page.wait_for_selector(sel["video"], state="attached", timeout=30000)
        if manual_setup:
            input("歌詞タブを開き和訳を表示、録画したい画面にしたら Enter(その後 0:00 から再生し直します) > ")
        page.evaluate("(s) => { const v = document.querySelector(s); v.currentTime = 0; v.play(); }", sel["video"])
        while True:
            time.sleep(cfg.poll_interval)
            d = page.evaluate(POLL_JS, sel)
            wall = time.monotonic() - t0
            if d["playhead"] >= 0:
                wall_samples.append({"wall": wall, "playhead": d["playhead"]})
                poll.append({"playhead": d["playhead"], "text": d["text"], "translation": d["translation"]})
            rect = d["rect"] or rect
            ended = d["duration"] and d["playhead"] >= d["duration"] - 0.3
            if ended or (max_seconds and d["playhead"] >= max_seconds):
                break
        page.close()
        ctx.close()

    webm = next(tmp.glob("*.webm"))
    rec = out_dir / "recording.webm"
    shutil.move(webm, rec)
    shutil.rmtree(tmp, ignore_errors=True)

    meta = {
        "url": url,
        "offset": estimate_offset(wall_samples) + cfg.sync_nudge,
        "crop": rect,
        "lines": [l.to_dict() for l in build_lines(poll)],
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    return meta
