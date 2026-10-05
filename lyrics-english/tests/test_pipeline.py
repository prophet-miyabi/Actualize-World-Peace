import json
import subprocess
from pathlib import Path

import pytest

from lyriclearn.compose import build_filter, compose, probe_duration
from lyriclearn.config import Config
from lyriclearn.download import video_id
from lyriclearn.segments import build_lines, estimate_offset
from lyriclearn.study import extract_phrases, extract_words, write_materials


def test_video_id():
    assert video_id("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x") == "dQw4w9WgXcQ"


def test_build_lines_merges_and_splits():
    s = [{"playhead": t / 10, "text": x, "translation": y} for t, x, y in
         [(0, "", ""), (5, "Hello", ""), (10, "Hello", "こんにちは"), (20, "", ""), (30, "Fly away", "飛び去れ"), (40, "Fly away", "飛び去れ")]]
    lines = build_lines(s)
    assert [(l.start, l.end, l.text, l.translation) for l in lines] == [
        (0.5, 2.0, "Hello", "こんにちは"), (3.0, 4.0, "Fly away", "飛び去れ")]


def test_estimate_offset():
    # 録画3.0秒目に再生位置0付近、wall = playhead + 3.0
    s = [{"wall": 3.0 + p, "playhead": p} for p in (0.0, 0.2, 0.4, 0.6, 0.8)]
    assert estimate_offset(s) == pytest.approx(3.0)
    with pytest.raises(ValueError):
        estimate_offset([{"wall": 1, "playhead": 0}])


def test_words_and_phrases():
    lines = [{"start": 0, "end": 2, "text": "We never give up on the dream", "translation": "諦めない"}]
    assert "dream" in [w["word"] for w in extract_words(lines)]
    assert "give up" in [p["phrase"] for p in extract_phrases(lines) if p["kind"] == "phrasal"]


def test_filter_bg_key():
    cfg = Config(bg_key="0x212121")
    assert "colorkey=0x212121" in build_filter({"x": 0, "y": 0, "w": 100, "h": 50}, cfg)


def _ff(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def test_compose_and_materials(tmp_path: Path):
    rec, audio = tmp_path / "rec.webm", tmp_path / "audio.mp3"
    _ff("-f", "lavfi", "-i", "testsrc=s=640x360:d=6:r=10", "-c:v", "libvpx", str(rec))
    _ff("-f", "lavfi", "-i", "sine=f=440:d=4", str(audio))
    meta = {"offset": 1.0, "crop": {"x": 100, "y": 50, "w": 301, "h": 201},
            "lines": [{"start": 0.5, "end": 2.0, "text": "Give up the dream", "translation": "夢を諦める"}]}
    out = compose(rec, audio, meta, tmp_path / "out.mp4", Config(out_w=640, out_h=360))
    assert probe_duration(out) == pytest.approx(4.0, abs=0.3)
    stats = write_materials(meta, audio, tmp_path / "study")
    assert stats["lines"] == 1
    assert (tmp_path / "study/clips/line_000.mp3").exists()
    assert "[sound:line_000.mp3]" in (tmp_path / "study/anki_lines.tsv").read_text()
