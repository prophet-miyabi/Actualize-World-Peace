import json
import subprocess
from pathlib import Path
from types import SimpleNamespace as NS

import pytest

from lyriclearn.studio import studio as S
from lyriclearn.studio import timing
from lyriclearn.studio.lyricvideo import build_ass
from lyriclearn.studio.project import Project
from lyriclearn.team import images

# テスト用に作ったオリジナルの歌詞
RAW = "\n".join(["We drift along the paper sea", "Counting lanterns, one by three",
                 "The clock forgets to wind itself", "Tomorrow waits upon the shelf",
                 "So hum with me, the tune is ours", "Beneath a sky of borrowed stars"])
JA = ["紙の海をぼくらは漂う", "ランタンを数える、一つ、また三つ", "時計はねじを巻くのを忘れて", "明日は棚の上で待っている", "一緒に口ずさもう、この歌は僕らのもの", "借り物の星空の下で"]
LRC = "\n".join(f"[00:{10 + i * 4:02d}.00] {t}" for i, t in enumerate(RAW.splitlines()))


def _ff(*a):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)


def test_timing_helpers():
    t = timing.parse_lrc("[00:05.50][01:00.00] hello\n[00:09.00]world")
    assert t == [(5.5, "hello"), (9.0, "world"), (60.0, "hello")]
    starts, q = timing.align_lines(["hello", "world", "unrelated words here"], t)
    assert starts[:2] == [5.5, 9.0] and q == pytest.approx(2 / 3)
    est = timing.estimate(["aaa", "bbbbbb"], 100)
    assert est[0] < est[1] < 100
    tl = timing.to_timeline([1, 3, 30], 40, max_len=9)
    assert tl[0] == (1, 2.92) and tl[2][1] == 39


def test_ass_has_english_and_japanese_at_same_time():
    lines = [{"start": 1, "end": 4, "text": "line one", "translation": "一行目"}, {"start": 5, "end": 8, "text": "line two", "translation": "二行目"}]
    ass = build_ass(lines, "T", "A", 1280, 720)
    en = [l for l in ass.splitlines() if l.startswith("Dialogue") and ",EN," in l][0]
    ja = [l for l in ass.splitlines() if l.startswith("Dialogue") and ",JA," in l][0]
    assert en.split(",")[1:3] == ja.split(",")[1:3]          # 開始・終了が同じ = 同時表示
    assert "一行目" in ja and "line two" in ass              # 次の行のプレビュー


class Fake:
    def __init__(self, scripts):
        self.scripts, self.messages, self.n = scripts, NS(create=self.create), 0

    def create(self, **kw):
        role = next(r for r, k in (("director", "ディレクター"), ("analyst", "歌詞解説担当"), ("timer", "タイミング担当"),
                                   ("editor", "動画編集担当"), ("educator", "教材作成担当")) if k in kw["system"])
        step = self.scripts[role].pop(0)
        if isinstance(step, str):
            return NS(stop_reason="end_turn", content=[NS(type="text", text=step)])
        self.n += 1
        return NS(stop_reason="tool_use", content=[NS(type="tool_use", id=f"t{self.n}", name=step[0], input=step[1])])


def test_full_studio_pipeline_and_revision(tmp_path, monkeypatch):
    def fake_download(url, out_dir):
        _ff("-f", "lavfi", "-i", "sine=f=330:d=40", str(Path(out_dir) / "audio.mp3"))
    monkeypatch.setattr(S, "download_audio", fake_download)
    monkeypatch.setattr(timing, "fetch_synced", lambda *a, **k: LRC)

    def fake_collect(title, artist, url, out):
        out.mkdir(exist_ok=True)
        p = out / "cand_0.jpg"
        _ff("-f", "lavfi", "-i", "color=c=0x336699:s=600x600", "-frames:v", "1", str(p))
        return [{"id": 0, "source": "ジャケット", "path": str(p), "url": "x"}]
    monkeypatch.setattr(images, "collect", fake_collect)

    analysis = {"overview_ja": "紙の海を漂う夜の歌。", "themes_ja": ["時間", "夜"], "lines": [
        {"en": e, "ja": j, **({"note_ja": "比喩表現"} if i == 1 else {}), "section": "Verse"} for i, (e, j) in enumerate(zip(RAW.splitlines(), JA))]}
    lesson = {"theme_ja": "夜と時間", "level": "B1", "vocab": [
        {"word": "drift", "meaning_ja": "漂う", "line_index": 0}, {"word": "lanterns", "meaning_ja": "ランタン", "line_index": 1},
        {"word": "borrowed", "meaning_ja": "借りた", "line_index": 5}], "phrases": [{"phrase": "hum with me", "meaning_ja": "一緒に口ずさむ", "line_index": 4}],
        "quiz": [{"type": "fill", "question": "We ___ along", "answer": "drift", "line_index": 0}]}
    bad = {"overview_ja": "x", "lines": [{"en": "totally different words about something else", "ja": "x"}] * 4}
    fake = Fake({
        "analyst": [("get_inputs", {}), ("submit_analysis", {"analysis": bad}), ("submit_analysis", {"analysis": analysis}), "解説を作りました"],
        "timer": [("fetch_audio", {"url": "https://music.youtube.com/watch?v=abcdefghijk"}), ("fetch_synced_lyrics", {}),
                  ("apply_timing", {"method": "lrclib"}), "lrclib で時刻を付けました(good)"],
        "editor": [("list_image_candidates", {}), ("render_video", {"image_id": 0}), ("preview_frame", {}), "ジャケットを採用"],
        "educator": [("get_material", {}), ("build_lesson", {"lesson": lesson}), "この順で学習を"],
        "director": [("create_from_lyrics", {"title": "Paper Sea", "artist": "Test Band", "lyrics": RAW}), "完成しました", ],
    })
    posts = []
    st = S.Studio(tmp_path, client=fake, post=lambda role, text, files=None: posts.append((role, text, files)))
    assert st.chat("歌詞です") == "完成しました"
    assert [r for r, *_ in posts] == ["director", "analyst", "timer", "editor", "educator"]
    pid = next(iter(st.projects))
    p = st.projects[pid]
    meta = p.meta
    assert meta["timing"]["quality"] == "good" and meta["lines"][0]["start"] == 10 and meta["lines"][0]["translation"] == JA[0]
    assert p.video.exists() and (p.dir / "explanation" / "explanation.html").exists() and (p.dir / "lesson" / "quiz.md").exists()
    # 不一致な歌詞(でっち上げ)は analyst の提出時に弾かれ、1回目の errors を受けて再提出している
    assert any(m["role"] == "user" and isinstance(m["content"], list) and "errors" in str(m["content"]) for m in st.analyst.messages)

    # --- 修正ループ: 訳を直す → 時刻は保持されたまま meta の訳が更新される ---
    analysis2 = json.loads(json.dumps(analysis))
    analysis2["lines"][0]["ja"] = "紙の海をふたりで漂う"
    fake.scripts["director"] += [("revise", {"project_id": pid, "stage": "analysis", "instruction": "1行目をもっと詩的に"}), "訳を直しました"]
    fake.scripts["analyst"] += [("get_current_analysis", {}), ("submit_analysis", {"analysis": analysis2}), "直しました"]
    assert st.chat("1行目の訳を直して") == "訳を直しました"
    assert p.meta["lines"][0]["translation"] == "紙の海をふたりで漂う" and p.meta["lines"][0]["start"] == 10


def test_pipeline_fails_cleanly_when_agent_gives_nothing(tmp_path):
    fake = Fake({"analyst": ["できませんでした", "やはり無理です"]})
    st = S.Studio(tmp_path, client=fake, post=lambda *a, **k: None)
    with pytest.raises(S.PipelineError):
        st.run_pipeline(Project.create(tmp_path, "T", "A", RAW))
