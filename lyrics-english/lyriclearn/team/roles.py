"""4つの担当エージェント。それぞれ専用の役割・ツール・成果物を持ち、成果は共有の state(dict)で引き継ぐ。"""
import json
import time
from pathlib import Path

from ..agent import search_songs
from ..config import Config
from ..jobs import JobManager
from . import images, lesson as lessonmod
from .base import AgentBase, image_block
from .charts import japan_chart

WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 5}

CURATOR = """あなたは「曲選定担当」です。英語学習の教材にする曲を1曲選びます。
- 日本で今最も聞かれている**英語の曲**を選ぶ。japan_chart で日本のチャートを取り、必要なら web_search で裏付けを取る。
- 歌詞が主に英語であること(K-POP・邦楽・インスト・ほぼ他言語は除外)。ライブ版・リミックスより原曲を優先。
- past_songs にある曲は選ばない(重複回避)。
- 選ぶ曲が決まったら resolve_song で YouTube Music の URL 候補を探し、公式音源(アーティスト本人/Topic/Official Audio)を選ぶ。
- 最後に必ず select_song を呼んで確定する。返信は「誰のどの曲を、なぜ選んだか」を2〜3文で。"""

RECORDER = """あなたは「録画担当」です。選ばれた曲の、YouTube Music の歌詞(和訳つき)画面を録画します。
- start_recording で開始し、wait_job で完了まで待つ(曲の長さぶん数分かかる。待つたびに状況を一言で伝える必要はない)。
- 失敗(state=error)したら原因をログから読み、再試行で直りそうなら1回だけ start_recording をやり直す。直らなければ原因と必要な対応を報告して終了。
- 成功したら、取得した歌詞行数と所要状況を1〜2文で報告する。"""

EDITOR = """あなたは「動画編集担当」です。録画動画の背景を取り除き、曲に最も合う画像を背景に敷いて歌詞動画を仕上げます。
- list_image_candidates で候補(アルバムジャケット/アーティスト写真/サムネ)を見て、画像を実際に見比べて1枚選ぶ。
  選定基準: 曲の雰囲気に合う / 解像度が高い / 文字(ロゴ・帯)が少ない / 歌詞が読みやすい暗さにできる / 公式のもの。
- compose_video で合成し、preview_frame で仕上がりを必ず目視確認する。歌詞が読みにくい、背景が抜け残っている、
  画像が不適切なら、blur・key_similarity・別の画像で最大2回やり直す。
- 最終報告は、選んだ画像とその理由、仕上がりの確認結果を2〜3文で。"""

TEACHER = """あなたは「教材作成担当」です。歌詞から英語学習教材を作ります。
- get_lyrics で歌詞(行番号つきの英語と和訳)を読み、build_lesson で教材を作る。
- 内容: テーマ解説 / 単語(5〜15語。学習価値の高いもの。歌詞中の意味で) / フレーズ・句動詞・口語表現 /
  文法ポイント / 文化的背景(あれば) / クイズ(穴埋め・選択・和訳を合わせて6〜10問)。
- 全項目の line_index は get_lyrics の行番号に合わせる。単語は必ずその行に実際に出てくる形で。
- build_lesson が errors を返したら直して再送する。成功したら、学習の進め方(おすすめの順番)を2〜3文で案内する。"""


class Team:
    def __init__(self, jobs: JobManager, work: Path, client=None):
        self.jobs, self.work, self.client = jobs, work, client
        self.state: dict = {}
        self.history_path = work / "history.json"
        self.curator = self._make("curator", CURATOR, self._curator_tools(), server_tools=[WEB_SEARCH], max_turns=14)
        self.recorder = self._make("recorder", RECORDER, self._recorder_tools(), max_turns=40)
        self.editor = self._make("editor", EDITOR, self._editor_tools(), max_turns=14, max_tokens=4096)
        self.teacher = self._make("teacher", TEACHER, self._teacher_tools(), max_turns=8, max_tokens=16000)
        self.agents = {a.name: a for a in (self.curator, self.recorder, self.editor, self.teacher)}

    def _make(self, name, system, tools_handlers, **kw):
        tools, handlers = tools_handlers
        return AgentBase(name, system, tools, handlers, client=self.client, **kw)

    # ---------- 共通 ----------
    def _history(self) -> list[dict]:
        return json.loads(self.history_path.read_text()) if self.history_path.exists() else []

    def save_state(self):
        (self.work / "last_run.json").write_text(json.dumps(self.state, ensure_ascii=False, indent=2, default=str))

    def load_state(self):
        self.state = json.loads((self.work / "last_run.json").read_text())

    def _job(self):
        return self.jobs.jobs[self.state["job_id"]]

    # ---------- 曲選定 ----------
    def _curator_tools(self):
        def select_song(title: str, artist: str, url: str, reason: str):
            self.state["song"] = {"title": title, "artist": artist, "url": url, "reason": reason}
            self.history_path.parent.mkdir(parents=True, exist_ok=True)
            self.history_path.write_text(json.dumps(
                self._history() + [{"title": title, "artist": artist, "url": url, "at": time.strftime("%Y-%m-%d")}],
                ensure_ascii=False, indent=2))
            return {"selected": f"{artist} - {title}"}
        tools = [
            {"name": "japan_chart", "description": "日本の人気曲チャート(Apple Music/iTunes)を取得する。",
             "input_schema": {"type": "object", "properties": {"limit": {"type": "integer"}}}},
            {"name": "resolve_song", "description": "曲名+アーティスト名で YouTube Music の URL 候補を検索する。",
             "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
            {"name": "past_songs", "description": "これまでに教材化した曲の一覧(重複回避用)。",
             "input_schema": {"type": "object", "properties": {}}},
            {"name": "select_song", "description": "曲を確定する。最後に必ず1回呼ぶ。",
             "input_schema": {"type": "object", "properties": {
                 "title": {"type": "string"}, "artist": {"type": "string"}, "url": {"type": "string"},
                 "reason": {"type": "string"}}, "required": ["title", "artist", "url", "reason"]}},
        ]
        handlers = {"japan_chart": lambda limit=50: japan_chart(limit), "resolve_song": lambda query: search_songs(query),
                    "past_songs": self._history, "select_song": select_song}
        return tools, handlers

    # ---------- 録画 ----------
    def _recorder_tools(self):
        def start_recording(url: str):
            j = self.jobs.start(url, stages=("download", "record"))
            self.state["job_id"] = j.id
            return {"job_id": j.id}

        def wait_job(job_id: str, max_wait_sec: int = 90):
            j = self.jobs.wait(job_id, min(max_wait_sec, 120))
            return {"state": j.state, "stage": j.stage, "error": j.message, "result": j.result, "log": j.log[-4:]}
        tools = [
            {"name": "start_recording", "description": "曲の音源取得と歌詞画面の録画を開始(非同期)。",
             "input_schema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
            {"name": "wait_job", "description": "ジョブの完了を最大 max_wait_sec 秒(上限120)待ち、状態を返す。未完了なら繰り返し呼ぶ。",
             "input_schema": {"type": "object", "properties": {"job_id": {"type": "string"}, "max_wait_sec": {"type": "integer"}},
                              "required": ["job_id"]}},
        ]
        return tools, {"start_recording": start_recording, "wait_job": wait_job}

    # ---------- 動画編集 ----------
    def _editor_tools(self):
        def list_image_candidates():
            s = self.state["song"]
            cands = images.collect(s["title"], s["artist"], s["url"], self._job().dir / "images")
            self.state["candidates"] = cands
            if not cands:
                return "候補画像を取得できませんでした。compose_video を image_id なしで呼んでください。"
            blocks = [{"type": "text", "text": f"{len(cands)}件の候補。image_id を選んでください。"}]
            for c in cands:
                blocks += [{"type": "text", "text": f"image_id={c['id']}: {c['source']}"},
                           image_block(images.shrink_jpeg(Path(c["path"])))]
            return blocks

        def compose_video(image_id: int | None = None, blur: float = 24, key_similarity: float = 0.22,
                          inset_cover: bool = True, bg_key: str | None = None):
            cfg = Config(bg_blur=blur, key_similarity=key_similarity, inset_cover=inset_cover, bg_key=bg_key)
            if image_id is not None:
                cfg.bg_image = self.state["candidates"][image_id]["path"]
                self.state["image"] = self.state["candidates"][image_id]
            j = self.jobs.run_stage(self.state["job_id"], ("compose",), cfg)
            self.jobs.wait(j.id, 900)
            if j.state != "done":
                raise RuntimeError(j.message or "合成に失敗")
            self.state["video"] = j.result["video"]
            return {"video": j.result["video"], "bg_key": cfg.bg_key}

        def preview_frame(t: float = 20):
            return [{"type": "text", "text": f"t={t}s の仕上がり"},
                    image_block(images.extract_frame(Path(self.state["video"]), t))]
        tools = [
            {"name": "list_image_candidates", "description": "背景画像の候補を集めて画像つきで返す。",
             "input_schema": {"type": "object", "properties": {}}},
            {"name": "compose_video", "description": "元の背景を抜いて画像を敷き、歌詞動画を合成する。",
             "input_schema": {"type": "object", "properties": {
                 "image_id": {"type": "integer", "description": "候補の番号。省略で画像なし"},
                 "blur": {"type": "number", "description": "背景のぼかし(既定24)"},
                 "key_similarity": {"type": "number", "description": "元背景の抜き具合 0.1〜0.4(既定0.22)"},
                 "inset_cover": {"type": "boolean", "description": "縦長のとき上部に鮮明なジャケットを入れる"},
                 "bg_key": {"type": "string", "description": "元背景色 0xRRGGBB(省略で自動検出)"}}}},
            {"name": "preview_frame", "description": "仕上がり動画の指定秒のフレームを見る(品質確認)。",
             "input_schema": {"type": "object", "properties": {"t": {"type": "number"}}}},
        ]
        return tools, {"list_image_candidates": list_image_candidates, "compose_video": compose_video,
                       "preview_frame": preview_frame}

    # ---------- 教材 ----------
    def _teacher_tools(self):
        def get_lyrics():
            m = self._job().meta
            return {"song": self.state.get("song"), "lines": [
                {"i": i, "en": l["text"], "ja": l["translation"]} for i, l in enumerate(m["lines"])]}

        def build_lesson(lesson: dict):
            j = self._job()
            meta = j.meta
            errs = lessonmod.validate(lesson, meta["lines"])
            if errs:
                return {"ok": False, "errors": errs}
            res = lessonmod.render(j.dir, meta, lesson, j.dir / "audio.mp3")
            self.state["lesson"] = res
            return {"ok": True, **res}
        tools = [
            {"name": "get_lyrics", "description": "歌詞(行番号つきの英語と和訳)を取得する。",
             "input_schema": {"type": "object", "properties": {}}},
            {"name": "build_lesson", "description": "教材(単語/フレーズ/文法/クイズ)を構造化データで渡して書き出す。",
             "input_schema": {"type": "object", "properties": {"lesson": lessonmod.SCHEMA}, "required": ["lesson"]}},
        ]
        return tools, {"get_lyrics": get_lyrics, "build_lesson": build_lesson}
