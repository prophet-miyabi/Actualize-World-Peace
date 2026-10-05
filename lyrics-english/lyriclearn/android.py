"""Android(Pixel)版バックエンド。Termux から adb(ワイヤレスデバッグで自端末に接続)で
YouTube Music アプリを操作し、画面録画と歌詞(英語+和訳)の読み取りを行う。

読み取りは uiautomator のUIダンプ。英語行の直後にある日本語を含む行を「和訳」として対にするので、
アプリの内部ID(resource-id)に依存しない。
"""
import re
import subprocess
import threading
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

from .config import Config
from .segments import build_lines, estimate_offset

CJK = re.compile(r"[぀-ヿ㐀-鿿]")
BOUNDS = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
PLAYBACK = re.compile(r"state=PlaybackState \{state=(\d+), position=(\d+), buffered position=\d+, speed=([\d.]+), updated=(\d+)")


class Adb:
    def __init__(self, serial: str | None = None):
        self.base = ["adb"] + (["-s", serial] if serial else [])

    def run(self, *args, timeout=60, check=True) -> str:
        r = subprocess.run(self.base + list(args), capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
        if check and r.returncode != 0:
            raise RuntimeError(f"adb {' '.join(args)} 失敗: {r.stderr.strip() or r.stdout.strip()}")
        return r.stdout

    def shell(self, cmd: str, **kw) -> str:
        return self.run("shell", cmd, **kw)

    def popen(self, cmd: str):
        return subprocess.Popen(self.base + ["shell", cmd], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def check_connected(self):
        out = self.run("devices")
        if not re.search(r"\tdevice\b", out):
            raise RuntimeError("adb に接続できていません。`lyriclearn adb-setup` を実行してください(ワイヤレスデバッグ要)")

    def screen_size(self) -> tuple[int, int]:
        m = re.search(r"(\d+)x(\d+)", self.shell("wm size").splitlines()[-1])
        return int(m.group(1)), int(m.group(2))

    def tap(self, x: int, y: int):
        self.shell(f"input tap {x} {y}")


@dataclass
class Node:
    text: str
    desc: str
    l: int
    t: int
    r: int
    b: int

    @property
    def center(self):
        return (self.l + self.r) // 2, (self.t + self.b) // 2


def parse_nodes(xml: str) -> list[Node]:
    """uiautomator dump の出力から、文字を持つノードを取り出す。"""
    i, j = xml.find("<?xml"), xml.rfind("</hierarchy>")
    if i < 0 or j < 0:
        return []
    out = []
    for e in ET.fromstring(xml[i:j + len("</hierarchy>")]).iter("node"):
        m = BOUNDS.match(e.get("bounds", ""))
        text, desc = e.get("text", ""), e.get("content-desc", "")
        if m and (text or desc):
            out.append(Node(text, desc, *map(int, m.groups())))
    return out


def find_node(nodes: list[Node], pattern: str) -> Node | None:
    rx = re.compile(pattern)
    return next((n for n in nodes if rx.search(n.text) or rx.search(n.desc)), None)


def pair_lines(nodes: list[Node], height: int, skip: str) -> list[dict]:
    """歌詞ノードを上から並べ、英語行+直後の日本語行を (text, translation, bounds) に対にする。"""
    skip_rx = re.compile(skip)
    entries: list[dict] = []
    for n in sorted((n for n in nodes if n.text and 0.12 * height < n.center[1] < 0.92 * height), key=lambda n: (n.t, n.l)):
        if skip_rx.fullmatch(n.text.strip()):
            continue
        for part in n.text.split("\n"):
            part = part.strip()
            if not part:
                continue
            if CJK.search(part) and entries and not entries[-1]["translation"] and not CJK.search(entries[-1]["text"]):
                entries[-1]["translation"] = part
                entries[-1]["b"] = max(entries[-1]["b"], n.b)
            else:
                entries.append({"text": part, "translation": "", "y": n.center[1], "t": n.t, "b": n.b})
    return entries


def active_entry(entries: list[dict], focus_y: float) -> dict | None:
    """再生中の行は画面内の決まった高さに来る前提で、そこに最も近い行を採る。"""
    return min(entries, key=lambda e: abs(e["y"] - focus_y)) if entries else None


def parse_playback(dump: str, pkg: str, uptime_ms: float) -> float | None:
    """dumpsys media_session から曲内の再生位置(秒)を求める。再生中でなければ None。"""
    i = dump.find(pkg)
    m = PLAYBACK.search(dump, i if i >= 0 else 0)
    if not m:
        return None
    state, pos, speed, updated = int(m[1]), int(m[2]), float(m[3]), int(m[4])
    if state != 3:     # 3 = PLAYING
        return None
    return (pos + (uptime_ms - updated) * speed) / 1000.0


SNAPSHOT = ("cat /proc/uptime; echo ===MS; dumpsys media_session; echo ===UI; "
            "uiautomator dump /dev/tty; echo ===UP2; cat /proc/uptime")


def snapshot(adb: Adb, cfg: Config) -> dict:
    """1回のadb呼び出しで 再生位置 と 歌詞UI を同時に取る(別々に取ると時刻がずれるため)。"""
    out = adb.shell(SNAPSHOT, timeout=30)
    t_host = time.monotonic()
    ms = out.split("===MS", 1)[1]
    dump, up2 = ms.split("===UI", 1)[1].split("===UP2")
    ms = ms.split("===UI", 1)[0]
    uptime_ms = float(up2.split()[0]) * 1000
    return {"wall": t_host, "playhead": parse_playback(ms, cfg.music_pkg, uptime_ms), "nodes": parse_nodes(dump)}


def open_lyrics(adb: Adb, cfg: Config, log=print):
    nodes = snapshot(adb, cfg)["nodes"]
    tab = find_node(nodes, cfg.selectors.lyrics_tab_re)
    if tab:
        adb.tap(*tab.center)
        time.sleep(1.5)
    else:
        log("歌詞タブが見つかりません(既に開いている可能性があります)")
    nodes = snapshot(adb, cfg)["nodes"]
    tr = find_node(nodes, cfg.selectors.translate_btn_re)
    if tr:
        adb.tap(*tr.center)
        time.sleep(1.5)
    else:
        log("和訳トグルが見つかりません(既に表示済みか、アプリ側に機能がありません)")


class _Recorder(threading.Thread):
    """screenrecord(1本3分上限)を連続起動して、各セグメントの開始時刻を記録する。"""
    def __init__(self, adb: Adb, size: tuple[int, int], cfg: Config):
        super().__init__(daemon=True)
        self.adb, self.size, self.cfg = adb, size, cfg
        self.starts: list[float] = []
        self._stop = threading.Event()

    def run(self):
        i = 0
        while not self._stop.is_set():
            self.starts.append(time.monotonic())
            p = self.adb.popen(f"screenrecord --time-limit {self.cfg.segment_sec} --size {self.size[0]}x{self.size[1]} "
                               f"--bit-rate 8000000 /sdcard/lyric_seg{i}.mp4")
            while p.poll() is None and not self._stop.is_set():
                time.sleep(0.2)
            i += 1

    def stop(self):
        self._stop.set()
        self.adb.shell("pkill -2 screenrecord", check=False)
        time.sleep(2.0)    # mp4 の書き出し完了待ち


def record(url: str, out_dir: Path, cfg: Config, duration: float | None = None, log=print,
           max_seconds: float | None = None) -> dict:
    from .compose import stitch_segments

    out_dir.mkdir(parents=True, exist_ok=True)
    adb = Adb(cfg.adb_serial)
    adb.check_connected()
    w, h = adb.screen_size()
    size = (w // 2 * 2, h // 2 * 2)
    adb.shell("rm -f /sdcard/lyric_seg*.mp4", check=False)
    adb.shell("svc power stayon true", check=False)       # 録画中に画面が消えないように
    try:
        adb.shell(f'am start -a android.intent.action.VIEW -d "{url}" -p {cfg.music_pkg}')
        for _ in range(40):                                  # 再生開始待ち
            s = snapshot(adb, cfg)
            if s["playhead"] is not None:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("YouTube Music で再生が始まりません(ログイン/Premium/アプリの前面表示を確認)")
        open_lyrics(adb, cfg, log)
        if not pair_lines(snapshot(adb, cfg)["nodes"], h, cfg.ui_skip):
            raise RuntimeError("歌詞行を検出できません。`lyriclearn adb-inspect` で画面を確認し ui_skip/focus_y を調整してください")
        # 曲の頭から録画するため、3秒以上再生してから「前の曲」キーで曲頭に戻す
        while (snapshot(adb, cfg)["playhead"] or 0) < 3.6:
            time.sleep(0.3)
        adb.shell("input keyevent KEYCODE_MEDIA_PREVIOUS")
        time.sleep(0.8)

        rec = _Recorder(adb, size, cfg)
        rec.start()
        samples, sync, y_lo, y_hi = [], [], h, 0
        while True:
            s = snapshot(adb, cfg)
            if rec.starts and s["playhead"] is not None:
                wall = s["wall"] - rec.starts[0] + cfg.sync_nudge
                sync.append({"wall": wall, "playhead": s["playhead"]})
                entries = pair_lines(s["nodes"], h, cfg.ui_skip)
                act = active_entry(entries, cfg.focus_y * h)
                samples.append({"playhead": s["playhead"], "text": act["text"] if act else "",
                                "translation": act["translation"] if act else ""})
                for e in entries:
                    y_lo, y_hi = min(y_lo, e["t"]), max(y_hi, e["b"])
                if (duration and s["playhead"] >= duration - 0.5) or (max_seconds and s["playhead"] >= max_seconds):
                    break
            elif s["playhead"] is None and sync and sync[-1]["playhead"] > 5:
                break                                        # 再生が止まった(曲終了)
        rec.stop()
    finally:
        adb.shell("svc power stayon false", check=False)

    seg_dir = out_dir / "_seg"
    seg_dir.mkdir(exist_ok=True)
    files = []
    for i, st in enumerate(rec.starts):
        f = seg_dir / f"seg{i}.mp4"
        r = subprocess.run(adb.base + ["pull", f"/sdcard/lyric_seg{i}.mp4", str(f)], capture_output=True)
        if r.returncode == 0 and f.stat().st_size > 0:
            files.append((f, st - rec.starts[0]))
    adb.shell("rm -f /sdcard/lyric_seg*.mp4", check=False)
    recording = stitch_segments(files, out_dir / "recording.mp4")

    pad = 24
    meta = {
        "url": url, "recording": recording.name,
        "offset": estimate_offset(sync),
        "crop": {"x": 0, "y": max(y_lo - pad, 0), "w": w, "h": min(y_hi + pad, h) - max(y_lo - pad, 0)} if y_hi > y_lo else None,
        "lines": [l.to_dict() for l in build_lines(samples, min_duration=0.8)],
    }
    import json
    (out_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    return meta


def inspect(cfg: Config):
    """歌詞画面を出した状態で、見えているテキストと、対にした結果を表示する(設定調整用)。"""
    adb = Adb(cfg.adb_serial)
    adb.check_connected()
    _, h = adb.screen_size()
    s = snapshot(adb, cfg)
    print(f"画面高さ={h}  再生位置={s['playhead']}")
    for n in s["nodes"]:
        print(f"y={n.center[1]:5d} [{n.t}-{n.b}] text={n.text!r} desc={n.desc!r}")
    print("--- 対にした歌詞 ---")
    ents = pair_lines(s["nodes"], h, cfg.ui_skip)
    for e in ents:
        print(f"y={e['y']:5d} {e['text']!r} => {e['translation']!r}")
    a = active_entry(ents, cfg.focus_y * h)
    print("再生中と判定:", a and a["text"], f"(focus_y={cfg.focus_y})")


def setup(cfg: Config):
    """ワイヤレスデバッグのペアリングと接続(Termux から自端末へ)。"""
    print("設定 > 開発者向けオプション > ワイヤレスデバッグ をオンにし、「ペア設定コードによるデバイスのペア設定」を開いてください。")
    pair = input("ペア設定の IP:ポート (例 127.0.0.1:37123) > ").strip()
    code = input("ペア設定コード(6桁) > ").strip()
    r = subprocess.run(["adb", "pair", pair, code], capture_output=True, text=True)
    print(r.stdout or r.stderr)
    conn = input("ワイヤレスデバッグ画面のメインの IP:ポート (ペア用とは別のポート) > ").strip()
    print(subprocess.run(["adb", "connect", conn], capture_output=True, text=True).stdout)
    print(subprocess.run(["adb", "devices"], capture_output=True, text=True).stdout)
