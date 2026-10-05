import json
import subprocess
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from lyriclearn.compose import compose, detect_bg_key, probe_duration
from lyriclearn.config import Config
from lyriclearn.jobs import Job, JobManager
from lyriclearn.team import images, lesson as L
from lyriclearn.team.base import AgentBase
from lyriclearn.team.orchestrator import PipelineError, run_pipeline
from lyriclearn.team.roles import Team

LINES = [{"start": 0.2 + i * 1.5, "end": 1.5 + i * 1.5, "text": t, "translation": j} for i, (t, j) in enumerate([
    ("Never give up on the dream", "夢を諦めない"), ("Hold on to the light tonight", "今夜は光にしがみついて"),
    ("Running through the endless night", "終わらない夜を駆け抜ける")])]


def _ff(*a):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)


def make_job(tmp: Path) -> Path:
    d = tmp / "vid"
    d.mkdir()
    _ff("-f", "lavfi", "-i", "testsrc=s=640x360:d=8:r=10", "-c:v", "libvpx", str(d / "recording.webm"))
    _ff("-f", "lavfi", "-i", "sine=f=440:d=5", str(d / "audio.mp3"))
    (d / "meta.json").write_text(json.dumps({"offset": 1.0, "crop": None, "lines": LINES}, ensure_ascii=False))
    return d


def test_lesson_validate_and_render(tmp_path):
    d = make_job(tmp_path)
    good = {"theme_ja": "夢を追う歌", "level": "B1",
            "vocab": [{"word": "give up", "meaning_ja": "諦める", "line_index": 0},
                      {"word": "endless", "meaning_ja": "終わりのない", "line_index": 2},
                      {"word": "tight", "meaning_ja": "しっかり", "line_index": 1}],
            "phrases": [{"phrase": "hold on to", "meaning_ja": "〜にしがみつく", "line_index": 1}],
            "grammar": [], "quiz": [{"type": "fill", "question": "Never ___ up", "answer": "give", "line_index": 0}]}
    assert L.validate(good, LINES) == [] or L.validate(good, LINES) == ["vocab[2] 'tight' が line_index=1 の歌詞に含まれていません"]
    bad = {**good, "vocab": [{"word": "zebra", "meaning_ja": "x", "line_index": 9}] * 3}
    errs = L.validate(bad, LINES)
    assert any("範囲外" in e for e in errs)
    good["vocab"][2] = {"word": "tonight", "meaning_ja": "今夜", "line_index": 1}
    assert L.validate(good, LINES) == []
    res = L.render(d, json.loads((d / "meta.json").read_text()), good, d / "audio.mp3")
    assert (Path(res["dir"]) / "lesson.html").exists() and "[sound:line_001.mp3]" in (Path(res["dir"]) / "anki_vocab.tsv").read_text()


def test_bg_key_and_compose_with_image(tmp_path):
    d = make_job(tmp_path)
    key = detect_bg_key(d / "recording.webm", None)
    assert key.startswith("0x") and len(key) == 8
    img = tmp_path / "cover.jpg"
    _ff("-f", "lavfi", "-i", "color=c=0x884422:s=500x500", "-frames:v", "1", str(img))
    for w, h in ((1280, 720), (720, 1280)):          # 横長/縦長(ジャケット挿入)の両方
        cfg = Config(out_w=w, out_h=h, bg_image=str(img), bg_key=key, backend="web")
        out = compose(d / "recording.webm", d / "audio.mp3", json.loads((d / "meta.json").read_text()), tmp_path / f"o{w}.mp4", cfg)
        assert probe_duration(out) == pytest.approx(5.0, abs=0.3)
        assert len(images.extract_frame(out, 2)) > 1000


class Fake:
    """担当(system の先頭)ごとの台本。要素は (ツール名, 入力) か 最終テキスト。"""
    def __init__(self, scripts):
        self.scripts, self.messages = scripts, NS(create=self.create)
        self.n = 0

    def create(self, **kw):
        role = next(r for r, k in (("curator", "曲選定"), ("recorder", "録画担当"), ("editor", "動画編集"), ("teacher", "教材作成")) if k in kw["system"])
        step = self.scripts[role].pop(0)
        if isinstance(step, str):
            return NS(stop_reason="end_turn", content=[NS(type="text", text=step)])
        self.n += 1
        return NS(stop_reason="tool_use", content=[NS(type="tool_use", id=f"t{self.n}", name=step[0], input=step[1])])


def test_full_pipeline_with_stubs(tmp_path, monkeypatch):
    d = make_job(tmp_path)
    jm = JobManager(tmp_path, tmp_path)
    monkeypatch.setattr(jm, "start", lambda url, **kw: jm.jobs.setdefault("j1", Job("j1", url, d, state="done")))
    def fake_collect(title, artist, url, out):
        out.mkdir(exist_ok=True)
        p = out / "cand_0.jpg"
        _ff("-f", "lavfi", "-i", "color=c=0x336699:s=600x600", "-frames:v", "1", str(p))
        return [{"id": 0, "source": "アルバムジャケット", "path": str(p), "url": "x"}]
    monkeypatch.setattr(images, "collect", fake_collect)
    lesson = {"theme_ja": "夢", "level": "B1", "vocab": [
        {"word": "give", "meaning_ja": "与える", "line_index": 0}, {"word": "light", "meaning_ja": "光", "line_index": 1},
        {"word": "endless", "meaning_ja": "終わりのない", "line_index": 2}],
        "phrases": [{"phrase": "hold on", "meaning_ja": "しがみつく", "line_index": 1}],
        "quiz": [{"type": "fill", "question": "Never ___ up", "answer": "give", "line_index": 0}]}
    fake = Fake({
        "curator": [("select_song", {"title": "Dream", "artist": "Band", "url": "https://music.youtube.com/watch?v=abcdefghijk", "reason": "日本でヒット"}), "Band の Dream を選びました"],
        "recorder": [("start_recording", {"url": "u"}), ("wait_job", {"job_id": "j1"}), "録画完了"],
        "editor": [("list_image_candidates", {}), ("compose_video", {"image_id": 0}), ("preview_frame", {"t": 2}), "ジャケットを採用"],
        "teacher": [("get_lyrics", {}), ("build_lesson", {"lesson": lesson}), "この順で学習を"],
    })
    team = Team(jm, tmp_path, client=fake)
    posts = []
    st = run_pipeline(team, lambda role, text, files=None: posts.append((role, text, files)))
    assert [r for r, *_ in posts if r != "lobby"] == ["curator", "recorder", "editor", "teacher"]
    assert Path(st["video"]).exists() and posts[-1][2] and any(f.name == "lesson.html" for f in posts[-1][2])
    assert json.loads((tmp_path / "history.json").read_text())[0]["title"] == "Dream"   # 重複回避の履歴


def test_pipeline_stops_when_agent_gives_no_result(tmp_path):
    fake = Fake({"curator": ["選べませんでした", "やはり選べません"]})
    team = Team(JobManager(tmp_path, tmp_path), tmp_path, client=fake)
    posts = []
    with pytest.raises(PipelineError):
        run_pipeline(team, lambda role, text, files=None: posts.append((role, text)))
    assert posts[-1][0] == "lobby" and "再開" in posts[-1][1]


def test_agentbase_image_result_and_pause_turn():
    class C:
        def __init__(self):
            self.msgs = NS(create=self.create); self.calls = []
            self.q = [NS(stop_reason="pause_turn", content=[NS(type="text", text="...")]),
                      NS(stop_reason="tool_use", content=[NS(type="tool_use", id="a", name="pic", input={})]),
                      NS(stop_reason="end_turn", content=[NS(type="text", text="done")])]
        messages = property(lambda s: s.msgs)
        def create(self, **kw):
            self.calls.append(len(kw["messages"]))
            return self.q.pop(0)
    c = C()
    ag = AgentBase("x", "sys", [], {"pic": lambda: [{"type": "text", "text": "hi"}, {"type": "image", "source": {}}]}, client=c)
    assert ag.chat("go") == "done"
    tr = ag.messages[-2]["content"][0]
    assert tr["type"] == "tool_result" and isinstance(tr["content"], list)   # 画像ブロックがそのまま渡る
