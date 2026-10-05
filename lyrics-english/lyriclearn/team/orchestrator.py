"""4担当を順に走らせ、引き継ぎを検証し、各担当のチャンネルへ投稿する。"""
from pathlib import Path

from .roles import Team

STAGES = ("curator", "recorder", "editor", "teacher")
REQUIRE = {"curator": "song", "recorder": "lines_ok", "editor": "video", "teacher": "lesson"}


class PipelineError(RuntimeError):
    pass


def run_pipeline(team: Team, post, hint: str | None = None, start: str = "curator") -> dict:
    """post(role, text, files=None) で各チャンネルに投稿する。start を指定すると途中から再開できる。"""
    if start != "curator":
        team.load_state()
    else:
        team.state = {}
    post("lobby", f"パイプライン開始(開始工程: {start})")
    prompts = {
        "curator": lambda: f"日本で今最も聞かれている英語の曲を1曲選んで確定してください。{hint or ''}",
        "recorder": lambda: f"次の曲の歌詞画面を録画してください: {team.state['song']['artist']} - {team.state['song']['title']}\n"
                            f"URL: {team.state['song']['url']}",
        "editor": lambda: f"録画は完了しています(job {team.state['job_id']})。{team.state['song']['artist']} - "
                          f"{team.state['song']['title']} に最も合う背景画像を選んで歌詞動画を仕上げてください。",
        "teacher": lambda: "歌詞から教材を作ってください。",
    }
    for stage in STAGES[STAGES.index(start):]:
        agent = team.agents[stage]
        text = agent.chat(prompts[stage]())
        if stage == "recorder":                       # 録画の成否は事実(ジョブ状態)で判定する
            j = team._job() if team.state.get("job_id") else None
            n = len(j.meta["lines"]) if j and j.state == "done" else 0
            if n >= 3:
                team.state["lines_ok"] = n
        if REQUIRE[stage] not in team.state:          # 担当が成果を出していなければ1回だけ催促
            text += "\n" + agent.chat(f"成果がまだ確定していません({REQUIRE[stage]})。必要なツールを呼んで完了させてください。")
            if stage == "recorder" and team.state.get("job_id"):
                j = team._job()
                if j.state == "done" and len(j.meta["lines"]) >= 3:
                    team.state["lines_ok"] = len(j.meta["lines"])
        post(stage, text)
        if REQUIRE[stage] not in team.state:
            post("lobby", f"⚠ {stage} 担当が成果を出せませんでした。{stage} チャンネルで指示するか `!auto resume {stage}` で再開できます。")
            team.save_state()
            raise PipelineError(f"{stage} failed")
        team.save_state()
        song = team.state.get("song", {})
        post("lobby", {"curator": f"🎵 選曲: {song.get('artist')} - {song.get('title')}",
                       "recorder": f"🎬 録画完了({team.state.get('lines_ok')}行)",
                       "editor": "🖼 動画編集完了", "teacher": "📚 教材完成"}[stage])
    files = [Path(team.state["video"])] + [Path(team.state["lesson"]["dir"]) / f for f in team.state["lesson"]["files"]]
    post("lobby", "完成しました。成果物を送ります。", files)
    return team.state
