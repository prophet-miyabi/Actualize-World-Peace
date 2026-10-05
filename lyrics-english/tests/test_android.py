import subprocess
from pathlib import Path

import pytest

from lyriclearn.android import active_entry, pair_lines, parse_nodes, parse_playback
from lyriclearn.compose import probe_duration, stitch_segments

H = 2400
XML = """UI hierchary dumped to: /dev/tty<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
 <node text="歌詞" content-desc="" class="android.widget.TextView" bounds="[400,2000][700,2100]"/>
 <node text="Look at the stars" content-desc="" bounds="[60,500][1000,600]"/>
 <node text="星を見て" content-desc="" bounds="[60,600][1000,660]"/>
 <node text="Don't let go&#10;手を離さないで" content-desc="" bounds="[60,800][1000,950]"/>
 <node text="Hold me tight" content-desc="" bounds="[60,1100][1000,1200]"/>
 <node text="" content-desc="" bounds="[0,0][10,10]"/>
</hierarchy>
UI hierchary dumped to: /dev/tty"""

DUMPSYS = """  Sessions Stack
    com.google.android.apps.youtube.music/MediaSession  (userId=0)
      state=PlaybackState {state=3, position=12000, buffered position=30000, speed=1.0, updated=1000000, actions=823}
"""


def test_parse_and_pair():
    nodes = parse_nodes(XML)
    assert len(nodes) == 5                      # 文字のないノードは捨てる
    ents = pair_lines(nodes, H, "歌詞|Lyrics")
    assert [(e["text"], e["translation"]) for e in ents] == [
        ("Look at the stars", "星を見て"), ("Don't let go", "手を離さないで"), ("Hold me tight", "")]


def test_active_entry_nearest_focus():
    ents = pair_lines(parse_nodes(XML), H, "歌詞")
    assert active_entry(ents, 0.35 * H)["text"] == "Don't let go"      # y=875 が 840 に最も近い
    assert active_entry([], 100) is None


def test_playback_position_advances_from_updated():
    # 更新から 2.5 秒後(uptime 1002500ms) → 12.0 + 2.5
    assert parse_playback(DUMPSYS, "com.google.android.apps.youtube.music", 1002500) == pytest.approx(14.5)
    assert parse_playback(DUMPSYS.replace("state=3", "state=2"), "com.google.android.apps.youtube.music", 1002500) is None


def _ff(*a):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)


def test_stitch_fills_gap(tmp_path: Path):
    a, b = tmp_path / "a.mp4", tmp_path / "b.mp4"
    _ff("-f", "lavfi", "-i", "testsrc=s=320x240:d=3:r=15", "-pix_fmt", "yuv420p", str(a))
    _ff("-f", "lavfi", "-i", "testsrc=s=320x240:d=2:r=15", "-pix_fmt", "yuv420p", str(b))
    out = stitch_segments([(a, 0.0), (b, 3.5)], tmp_path / "out.mp4")   # 0.5秒の隙間
    assert probe_duration(out) == pytest.approx(5.5, abs=0.3)
