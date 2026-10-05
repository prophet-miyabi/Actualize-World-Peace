import json
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace as NS

from lyriclearn.agent import Agent
from lyriclearn.jobs import JobManager


def _ff(*a):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)


class FakeClient:
    """1回目: tool_use(list_jobs) → 2回目: テキスト。"""
    def __init__(self, script):
        self.script, self.calls = list(script), []
        self.messages = NS(create=self.create)

    def create(self, **kw):
        self.calls.append(kw)
        return self.script.pop(0)


def _tool(name, input, id="t1"):
    return NS(stop_reason="tool_use", content=[NS(type="tool_use", id=id, name=name, input=input)])


def _text(t):
    return NS(stop_reason="end_turn", content=[NS(type="text", text=t)])


def make_job_dir(tmp: Path, vid="abcdefghijk"):
    d = tmp / vid
    d.mkdir()
    _ff("-f", "lavfi", "-i", "testsrc=s=640x360:d=5:r=10", "-c:v", "libvpx", str(d / "recording.webm"))
    _ff("-f", "lavfi", "-i", "sine=f=440:d=3", str(d / "audio.mp3"))
    meta = {"offset": 1.0, "crop": None, "lines": [{"start": 0.2, "end": 1.5, "text": "Never give up", "translation": "諦めるな"}]}
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))
    return d


def test_agent_tool_loop_and_send_files(tmp_path):
    jm = JobManager(tmp_path, tmp_path / "p")
    d = make_job_dir(tmp_path)
    from lyriclearn.jobs import Job
    j = Job("j1", "https://music.youtube.com/watch?v=abcdefghijk", d, state="done")
    jm.jobs["j1"] = j
    (d / "lyrics_video.mp4").write_bytes(b"x")
    fake = FakeClient([_tool("send_files", {"job_id": "j1", "what": ["video", "html"]}), _text("送りました")])
    ag = Agent(jm, client=fake)
    assert ag.chat("動画ちょうだい") == "送りました"
    assert [p.name for p in ag.take_files()] == ["lyrics_video.mp4"]   # html はまだ無いので送らない
    # tool_result が履歴に入り、assistant の content がそのまま戻されている
    roles = [m["role"] for m in ag.messages]
    assert roles == ["user", "assistant", "user", "assistant"]
    assert ag.messages[2]["content"][0]["type"] == "tool_result"
    assert "tool_choice" not in fake.calls[0] and "thinking" not in fake.calls[0]


def test_tool_error_is_reported_not_raised(tmp_path):
    ag = Agent(JobManager(tmp_path, tmp_path), client=FakeClient([_tool("job_status", {"job_id": "nope"}), _text("ok")]))
    assert ag.chat("status") == "ok"
    res = ag.messages[2]["content"][0]
    assert res["is_error"] and "nope" in res["content"]


def test_retune_reruns_compose_and_notifies(tmp_path):
    finished = []
    jm = JobManager(tmp_path, tmp_path, on_finish=finished.append)
    d = make_job_dir(tmp_path)
    from lyriclearn.jobs import Job
    jm.jobs["j1"] = Job("j1", "u", d, state="done", owner=42)
    jm.retune("j1", sync_nudge=0.5, bg_color="navy")
    for _ in range(100):
        if jm.jobs["j1"].state == "done" and (d / "lyrics_video.mp4").exists():
            break
        time.sleep(0.1)
    assert jm.jobs["j1"].state == "done", jm.jobs["j1"].message
    assert json.loads((d / "meta.json").read_text())["offset"] == 1.5
    assert (d / "study/anki_lines.tsv").exists()
