"""Claude が対話しながら教材作成を回すエージェント。Discord など任意のフロントから chat() を呼ぶ。"""
import json
import os
from pathlib import Path

from .jobs import JobManager

MODEL = os.environ.get("LYRICLEARN_MODEL", "claude-opus-5-5")
MAX_MESSAGES = 80

SYSTEM = """あなたは英語学習用の歌詞教材づくりを手伝うアシスタントです(個人利用)。
流れ: 曲の特定 → 録画ジョブ開始(YouTube Musicを自動で開き歌詞+和訳を録画→切り抜き→音源と同期→教材作成) → 結果の報告 → 微調整 → 次の曲。
- 曲名だけ渡されたら search_songs で候補を出し、曖昧なら番号で選んでもらう。URLが来たらそのまま使う。
- ジョブは数分かかる。start_lyrics_job を呼んだら「始めました、完了したらお知らせします」と短く伝えて待つ。
  完了/失敗は [system] メッセージで届くので、それを受けて結果を報告し次の提案をする。
- 失敗時は原因を平易に説明し、retune(再編集のみ)で直せるものか、再録画が必要かを判断して提案する。
- 完了時は show_vocab で学習ポイントを数個ピックして紹介し、send_files で成果物を送る。
- 返信は簡潔な日本語。毎回、次にできること(別の曲/単語を絞る/同期ズレ修正)を一言添える。"""

TOOLS = [
    {"name": "search_songs", "description": "曲名/アーティスト名で YouTube Music の候補を検索する。",
     "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "start_lyrics_job", "description": "録画→編集→教材作成ジョブを開始する(数分かかる。非同期)。",
     "input_schema": {"type": "object", "properties": {
         "url": {"type": "string", "description": "https://music.youtube.com/watch?v=..."},
         "llm_glosses": {"type": "boolean", "description": "単語に日本語の意味を付ける(既定 true)"}},
         "required": ["url"]}},
    {"name": "job_status", "description": "ジョブの状態・直近ログ・結果を返す。",
     "input_schema": {"type": "object", "properties": {"job_id": {"type": "string"}}, "required": ["job_id"]}},
    {"name": "list_jobs", "description": "これまでのジョブ一覧。",
     "input_schema": {"type": "object", "properties": {}}},
    {"name": "show_vocab", "description": "完了ジョブの歌詞行(英/和)と抽出された単語・フレーズを返す。",
     "input_schema": {"type": "object", "properties": {"job_id": {"type": "string"}, "max_lines": {"type": "integer"}},
                      "required": ["job_id"]}},
    {"name": "retune", "description": "再録画せず編集と教材だけやり直す。同期ズレ補正(秒,+で映像を遅らせる)や背景色変更。",
     "input_schema": {"type": "object", "properties": {
         "job_id": {"type": "string"}, "sync_nudge": {"type": "number"},
         "bg_key": {"type": "string", "description": "置換元の背景色 例 0x212121"}, "bg_color": {"type": "string"},
         "llm_glosses": {"type": "boolean"}}, "required": ["job_id"]}},
    {"name": "send_files", "description": "成果物をユーザーに送る。",
     "input_schema": {"type": "object", "properties": {
         "job_id": {"type": "string"},
         "what": {"type": "array", "items": {"type": "string", "enum": ["video", "anki_lines", "anki_words", "html"]}}},
         "required": ["job_id", "what"]}},
]


def search_songs(query: str, n: int = 5) -> list[dict]:
    import yt_dlp

    with yt_dlp.YoutubeDL({"quiet": True, "extract_flat": True}) as ydl:
        info = ydl.extract_info(f"ytsearch{n}:{query}", download=False)
    return [{"n": i + 1, "title": e.get("title"), "channel": e.get("channel") or e.get("uploader"),
             "duration": e.get("duration"), "url": f"https://music.youtube.com/watch?v={e['id']}"}
            for i, e in enumerate(info["entries"])]


class Agent:
    """1会話(Discordのチャンネル/スレッド)ぶんの状態。"""

    def __init__(self, jobs: JobManager, client=None, owner=None):
        import anthropic

        self.jobs, self.owner = jobs, owner
        self.client = client or anthropic.Anthropic()
        self.messages: list[dict] = []
        self.pending_files: list[Path] = []

    # ---- tools ----
    def _job(self, job_id):
        if job_id not in self.jobs.jobs:
            raise KeyError(f"job {job_id} は存在しません。list_jobs で確認してください")
        return self.jobs.jobs[job_id]

    def run_tool(self, name: str, a: dict):
        if name == "search_songs":
            return search_songs(a["query"])
        if name == "start_lyrics_job":
            j = self.jobs.start(a["url"], llm=a.get("llm_glosses", True), owner=self.owner)
            return {"job_id": j.id, "state": j.state}
        if name == "list_jobs":
            return [{"job_id": j.id, "url": j.url, "state": j.state, "stage": j.stage} for j in self.jobs.jobs.values()]
        j = self._job(a["job_id"])
        if name == "job_status":
            return {"state": j.state, "stage": j.stage, "error": j.message, "result": j.result, "log": j.log[-5:]}
        if name == "show_vocab":
            from .study import extract_phrases, extract_words
            meta = json.loads((j.dir / "meta.json").read_text())
            lines = meta["lines"]
            return {"lines": lines[: a.get("max_lines", 30)], "words": extract_words(lines)[:60],
                    "phrasal_verbs": [p for p in extract_phrases(lines) if p["kind"] == "phrasal"][:30]}
        if name == "retune":
            self.jobs.retune(j.id, a.get("sync_nudge"), a.get("bg_key"), a.get("bg_color"), a.get("llm_glosses", False))
            return {"state": "running"}
        if name == "send_files":
            paths = {"video": j.dir / "lyrics_video.mp4", "anki_lines": j.dir / "study/anki_lines.tsv",
                     "anki_words": j.dir / "study/anki_words.tsv", "html": j.dir / "study/study.html"}
            sent = []
            for w in a["what"]:
                if paths[w].exists():
                    self.pending_files.append(paths[w]); sent.append(w)
            return {"queued": sent}
        raise ValueError(f"unknown tool {name}")

    # ---- loop ----
    def chat(self, text: str) -> str:
        """ユーザー発言(または [system] 通知)を受け、ツールを回して最終の返信テキストを返す。"""
        if len(self.messages) > MAX_MESSAGES:   # 履歴が長くなったら新規会話に(ジョブ状態は list_jobs で復元できる)
            self.messages = []
        self.messages.append({"role": "user", "content": text})
        for _ in range(12):
            r = self.client.messages.create(model=MODEL, max_tokens=4096, system=SYSTEM, tools=TOOLS,
                                            messages=self.messages)
            self.messages.append({"role": "assistant", "content": r.content})  # thinking含め丸ごと戻す
            if r.stop_reason == "refusal":
                return "(この依頼には応答できませんでした)"
            uses = [b for b in r.content if b.type == "tool_use"]
            if r.stop_reason != "tool_use" or not uses:
                return "".join(b.text for b in r.content if b.type == "text").strip()
            results = []
            for b in uses:
                try:
                    out, err = json.dumps(self.run_tool(b.name, b.input), ensure_ascii=False, default=str), False
                except Exception as e:
                    out, err = f"{type(e).__name__}: {e}", True
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": out, "is_error": err})
            self.messages.append({"role": "user", "content": results})
        return "(ツール呼び出しが多すぎたため中断しました)"

    def take_files(self) -> list[Path]:
        files, self.pending_files = self.pending_files, []
        return files
