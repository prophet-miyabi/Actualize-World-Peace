"""歌詞スタジオ: 解説 / タイミング / 動画編集 / 教材 の4担当と、全体を見るディレクター。

ディレクター(対話窓口) ─ create_from_lyrics ─▶ 解説 → タイミング → 動画編集 → 教材 を順に実行
                       └ revise(段階, 指示)  ─▶ 該当担当だけをやり直し(→ 対話のループ)
"""
import json
import re
import shutil
from difflib import SequenceMatcher
from pathlib import Path

from ..agent import search_songs
from ..compose import probe_duration
from ..download import download_audio
from ..team import images, lesson as lessonmod
from ..team.base import AgentBase, image_block
from . import timing
from .explain import render_explanation
from .lyricvideo import render
from .project import Project

WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 3}

ANALYST = """あなたは「歌詞解説担当」です。ユーザーが入力した英語の歌詞を、学習者向けに解説し日本語に訳します。
- まず get_inputs で歌詞と曲情報を読む。必要なら web_search でアーティストの発言や曲の背景を調べる(歌詞の検索には使わない)。
- 歌詞の本文は**入力のまま**1行ずつ en に入れる(綴り・語順を変えない。[Chorus] 等の見出しは section に回す)。
- ja は自然で、歌として読める日本語訳(直訳すぎず、意味を落とさない)。
- overview_ja: 曲のテーマ・物語・感情の流れを2〜4段落。themes_ja: キーワード的なテーマ。background_ja: 制作背景・文化的背景(わかる範囲で。不確かなことは書かない)。
- note_ja: 難所の行だけに(イディオム・スラング・比喩・文法・多義語・言葉遊び)。全行に付けない。
- 最後に必ず submit_analysis を呼ぶ。エラーが返ったら直して再送する。完了後は要点を2文で報告。"""

TIMER = """あなたは「タイミング担当」です。曲の音源を用意し、歌詞の各行に曲内の時刻を付けます。
- get_inputs で曲情報を読む。find_audio で候補を探し、公式の音源(アーティスト本人/Topic/Official Audio)を選んで fetch_audio で取得する。
  ライブ・カバー・リミックス・速度違い・歌詞動画は避け、曲の長さが妥当なもの(通常2〜6分)を選ぶ。
- 次に fetch_synced_lyrics で時刻つき歌詞を探し、見つかれば apply_timing(method=lrclib)。
  対応率が低い(quality が poor)なら whisper(使える場合)→ それも不可なら estimate を試し、estimate なら「時刻は推定で不正確」と必ず報告する。
- ユーザーが LRC 形式の歌詞を渡してきた場合は apply_timing(method=manual, lrc_text=...)。
- 最後に、使った音源・方法・品質(good/fair/poor)を2〜3文で報告する。"""

EDITOR = """あなたは「動画編集担当」です。歌詞動画(英語と日本語訳が同時に出る、YouTube でよくある和訳つき歌詞動画)を仕上げます。
- list_image_candidates の画像を実際に見比べて背景に使う1枚を選ぶ。基準: 曲の雰囲気に合う/高解像度/文字(ロゴ・帯)が少ない/公式のもの。
- render_video で動画を作り、preview_frame で仕上がりを必ず目視確認する(歌詞が読めるか・英語と和訳が同時に出ているか・背景が不自然でないか)。
  問題があれば blur・show_cover・別の画像で最大2回やり直す。
- 最後に、選んだ画像とその理由、確認結果を2〜3文で報告する。"""

EDUCATOR = """あなたは「教材作成担当」です。解説担当が作った歌詞の分析をもとに、英語学習教材を作ります。
- get_material で歌詞(行番号つき)と解説を読み、build_lesson で教材を作る。
- 内容: テーマ解説 / 単語(5〜15語・学習価値が高いもの・歌詞中の意味で) / フレーズ・句動詞・口語表現 / 文法ポイント / 文化背景(あれば) / クイズ(穴埋め・選択・和訳で6〜10問)。
- line_index は get_material の行番号(0始まり)に合わせる。単語は必ずその行に出てくる形で。errors が返ったら直して再送する。
- 成功したら、おすすめの学習手順を2〜3文で案内する。"""

DIRECTOR = """あなたは「歌詞スタジオのディレクター」です。ユーザーと対話しながら、英語の歌詞から
①詳細な解説 ②英語教材 ③英語+日本語訳が同時に出る歌詞動画 を作ります(個人利用)。
- ユーザーが歌詞を貼ったら create_from_lyrics を呼ぶ。曲名とアーティストが不明なら、1度だけ短く聞く(歌詞の中身から分かるならそのまま進めてよい)。
- 完了したら、成果(解説・教材・動画)を簡潔に伝え、send_files で送る。時刻が推定(poor)のときは必ず伝える。
- 修正の依頼は revise で該当の段階だけやり直す: analysis(訳・解説) / timing(時刻・音源) / video(見た目・背景画像) / lesson(教材)。
  訳を直したら video も更新が必要。revise のあと、必要なら続けて video を revise する。
- 返信は簡潔な日本語。毎回、次にできること(別の曲 / 訳の調整 / 時刻のズレ / 背景画像の変更)を一言添える。"""


class PipelineError(RuntimeError):
    pass


def _norm(s: str) -> str:
    return re.sub(r"[^\w぀-ヿ㐀-鿿]+", "", s.lower())


class Studio:
    def __init__(self, work: Path, client=None, post=None, width=1280, height=720):
        self.work, self.client = work, client
        self.post = post or (lambda role, text, files=None: print(f"[{role}] {text}"))
        self.w, self.h = width, height
        self.projects: dict[str, Project] = {}
        self.cur: Project | None = None
        self.pending_files: list[Path] = []
        mk = lambda name, system, th, **kw: AgentBase(name, system, th[0], th[1], client=client, **kw)
        self.analyst = mk("analyst", ANALYST, self._analyst_tools(), server_tools=[WEB_SEARCH], max_turns=10, max_tokens=16000)
        self.timer = mk("timer", TIMER, self._timer_tools(), max_turns=14)
        self.editor = mk("editor", EDITOR, self._editor_tools(), max_turns=12)
        self.educator = mk("educator", EDUCATOR, self._educator_tools(), max_turns=8, max_tokens=16000)
        self.director = mk("director", DIRECTOR, self._director_tools(), max_turns=10)
        self.sub = {"analysis": self.analyst, "timing": self.timer, "video": self.editor, "lesson": self.educator}

    # ---------- 共通 ----------
    def _inputs(self):
        p = self.cur
        return {"title": p.title, "artist": p.artist, "raw_lyrics": p.raw_lyrics, "audio_url": p.audio_url,
                "has_analysis": p.analysis is not None, "has_audio": p.audio.exists(), "has_timing": p.meta is not None}

    def _lines(self):
        m = self.cur.meta
        if not m:
            raise RuntimeError("時刻つき歌詞がまだありません(タイミング担当の工程が先に必要です)")
        return m["lines"]

    # ---------- 歌詞解説 ----------
    def _analyst_tools(self):
        def submit_analysis(analysis: dict):
            p, lines = self.cur, analysis.get("lines", [])
            errs = []
            if len(lines) < 2:
                errs.append("lines が少なすぎます")
            for i, ln in enumerate(lines):
                if not ln.get("en") or not ln.get("ja"):
                    errs.append(f"lines[{i}] に en / ja が必要です")
            if not errs:
                a, b = _norm("".join(l["en"] for l in lines)), _norm(p.raw_lyrics)
                ratio = SequenceMatcher(None, a, b, autojunk=False).ratio()
                if ratio < 0.85:
                    errs.append(f"en が入力の歌詞と一致しません(一致度 {ratio:.2f})。歌詞の本文は入力のまま1行ずつ入れてください")
            if errs:
                return {"ok": False, "errors": errs}
            (p.dir / "analysis.json").write_text(json.dumps(analysis, ensure_ascii=False, indent=2))
            m = p.meta
            if m and len(m["lines"]) == len(lines):            # 訳を直しただけなら時刻はそのまま引き継ぐ
                for ml, al in zip(m["lines"], lines):
                    ml["translation"], ml["note"] = al["ja"], al.get("note_ja", "")
                (p.dir / "meta.json").write_text(json.dumps(m, ensure_ascii=False, indent=2))
            render_explanation(p)
            return {"ok": True, "lines": len(lines)}
        schema = {"type": "object", "properties": {
            "overview_ja": {"type": "string"}, "themes_ja": {"type": "array", "items": {"type": "string"}},
            "background_ja": {"type": "string"},
            "lines": {"type": "array", "items": {"type": "object", "properties": {
                "en": {"type": "string"}, "ja": {"type": "string"}, "note_ja": {"type": "string"}, "section": {"type": "string"}},
                "required": ["en", "ja"]}}}, "required": ["overview_ja", "lines"]}
        tools = [{"name": "get_inputs", "description": "曲情報・入力歌詞・既存の分析の有無を読む。", "input_schema": {"type": "object", "properties": {}}},
                 {"name": "get_current_analysis", "description": "現在の分析(修正依頼のとき)を読む。", "input_schema": {"type": "object", "properties": {}}},
                 {"name": "submit_analysis", "description": "解説と日本語訳を提出する。", "input_schema": {"type": "object", "properties": {"analysis": schema}, "required": ["analysis"]}}]
        return tools, {"get_inputs": self._inputs, "get_current_analysis": lambda: self.cur.analysis, "submit_analysis": submit_analysis}

    # ---------- タイミング ----------
    def _timer_tools(self):
        def fetch_audio(url: str):
            p = self.cur
            download_audio(url, p.dir)
            p.audio_url = url
            p.save()
            return {"duration_sec": round(probe_duration(p.audio), 1)}

        def fetch_synced_lyrics():
            p = self.cur
            lrc = timing.fetch_synced(p.artist, p.title, probe_duration(p.audio) if p.audio.exists() else None)
            if not lrc:
                return {"found": False}
            (p.dir / "synced.lrc").write_text(lrc)
            return {"found": True, "timed_lines": len(timing.parse_lrc(lrc))}

        def apply_timing(method: str, lrc_text: str | None = None):
            p, an = self.cur, self.cur.analysis
            if not an:
                raise RuntimeError("先に歌詞解説担当の分析が必要です")
            if not p.audio.exists():
                raise RuntimeError("先に fetch_audio で音源を取得してください")
            dur, texts = probe_duration(p.audio), [l["en"] for l in an["lines"]]
            quality_ratio = None
            if method in ("lrclib", "manual"):
                src = lrc_text if method == "manual" else (p.dir / "synced.lrc").read_text() if (p.dir / "synced.lrc").exists() else None
                if not src:
                    raise RuntimeError("時刻つき歌詞がありません(fetch_synced_lyrics が見つかりませんでした)")
                starts, quality_ratio = timing.align_lines(texts, timing.parse_lrc(src))
            elif method == "whisper":
                starts, quality_ratio = timing.align_lines(texts, timing.transcribe_segments(str(p.audio)))
            elif method == "estimate":
                starts = timing.estimate(texts, dur)
            else:
                raise ValueError("method は lrclib / whisper / manual / estimate")
            tl = timing.to_timeline(starts, dur)
            lines = [{"start": s, "end": e, "text": a["en"], "translation": a["ja"], "note": a.get("note_ja", "")}
                     for (s, e), a in zip(tl, an["lines"])]
            quality = "poor(推定)" if quality_ratio is None else "good" if quality_ratio >= 0.8 else "fair" if quality_ratio >= 0.5 else "poor"
            (p.dir / "meta.json").write_text(json.dumps(
                {"offset": 0, "crop": None, "lines": lines, "timing": {"method": method, "quality": quality, "matched": quality_ratio}},
                ensure_ascii=False, indent=2))
            return {"method": method, "quality": quality, "matched_ratio": quality_ratio, "duration_sec": round(dur, 1),
                    "first_line_at": lines[0]["start"], "last_line_at": lines[-1]["start"]}
        tools = [{"name": "get_inputs", "description": "曲情報と進捗を読む。", "input_schema": {"type": "object", "properties": {}}},
                 {"name": "find_audio", "description": "曲名+アーティストで YouTube Music の音源候補を検索。", "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
                 {"name": "fetch_audio", "description": "選んだ音源をダウンロードする。", "input_schema": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
                 {"name": "fetch_synced_lyrics", "description": "LRCLIB から時刻つき歌詞を探す(内容は返さず件数のみ)。", "input_schema": {"type": "object", "properties": {}}},
                 {"name": "apply_timing", "description": "歌詞の各行に時刻を付けて meta.json を作る。", "input_schema": {"type": "object", "properties": {
                     "method": {"type": "string", "enum": ["lrclib", "whisper", "manual", "estimate"]}, "lrc_text": {"type": "string"}}, "required": ["method"]}}]
        return tools, {"get_inputs": self._inputs, "find_audio": lambda query: search_songs(query), "fetch_audio": fetch_audio,
                       "fetch_synced_lyrics": fetch_synced_lyrics, "apply_timing": apply_timing}

    # ---------- 動画編集 ----------
    def _editor_tools(self):
        def list_image_candidates():
            p = self.cur
            cands = images.collect(p.title, p.artist, p.audio_url, p.dir / "images")
            self.cands = cands
            if not cands:
                return "候補画像を取得できませんでした。render_video を image_id なしで呼んでください(単色背景になります)。"
            blocks = [{"type": "text", "text": f"{len(cands)}件。image_id を選んでください。"}]
            for c in cands:
                blocks += [{"type": "text", "text": f"image_id={c['id']}: {c['source']}"}, image_block(images.shrink_jpeg(Path(c["path"])))]
            return blocks

        def render_video(image_id: int | None = None, blur: float = 24, show_cover: bool = True, portrait: bool = False):
            p = self.cur
            w, h = (self.h, self.w) if portrait else (self.w, self.h)
            bg = self.cands[image_id]["path"] if image_id is not None else None
            render(self._lines(), p.audio, p.video, p.dir / "_render", p.title, p.artist, bg, w, h, blur, show_cover)
            p.notes.append(f"video bg={image_id}")
            return {"video": str(p.video), "size": f"{w}x{h}"}

        def preview_frame(t: float | None = None):
            ls = self._lines()
            t = t if t is not None else (ls[min(1, len(ls) - 1)]["start"] + ls[min(1, len(ls) - 1)]["end"]) / 2
            return [{"type": "text", "text": f"t={t:.1f}s の仕上がり"}, image_block(images.extract_frame(self.cur.video, t))]
        tools = [{"name": "list_image_candidates", "description": "背景画像の候補(ジャケット/アーティスト写真/サムネ)を画像つきで返す。", "input_schema": {"type": "object", "properties": {}}},
                 {"name": "render_video", "description": "英語+日本語訳が同時に出る歌詞動画を作る。", "input_schema": {"type": "object", "properties": {
                     "image_id": {"type": "integer", "description": "省略で単色背景"}, "blur": {"type": "number"},
                     "show_cover": {"type": "boolean", "description": "ジャケットを鮮明に小さく添える"}, "portrait": {"type": "boolean", "description": "縦長(スマホ向け)"}}}},
                 {"name": "preview_frame", "description": "仕上がり動画の指定秒のフレームを見る。", "input_schema": {"type": "object", "properties": {"t": {"type": "number"}}}}]
        self.cands = []
        return tools, {"list_image_candidates": list_image_candidates, "render_video": render_video, "preview_frame": preview_frame}

    # ---------- 教材 ----------
    def _educator_tools(self):
        def get_material():
            a, ls = self.cur.analysis, self._lines()
            return {"overview_ja": a.get("overview_ja"), "themes_ja": a.get("themes_ja"),
                    "lines": [{"i": i, "en": l["text"], "ja": l["translation"], "note": l.get("note", "")} for i, l in enumerate(ls)]}

        def build_lesson(lesson: dict):
            p, meta = self.cur, self.cur.meta
            errs = lessonmod.validate(lesson, meta["lines"])
            if errs:
                return {"ok": False, "errors": errs}
            return {"ok": True, **lessonmod.render(p.dir, meta, lesson, p.audio)}
        tools = [{"name": "get_material", "description": "歌詞(行番号つき)と解説を読む。", "input_schema": {"type": "object", "properties": {}}},
                 {"name": "build_lesson", "description": "教材を構造化データで渡して書き出す。", "input_schema": {"type": "object", "properties": {"lesson": lessonmod.SCHEMA}, "required": ["lesson"]}}]
        return tools, {"get_material": get_material, "build_lesson": build_lesson}

    # ---------- パイプライン ----------
    def _run_stage(self, key: str, prompt: str, check) -> str:
        agent = self.sub[key]
        agent.messages = []                      # 担当の履歴は曲ごとに新しく始める
        text = agent.chat(prompt)
        if not check():
            text += "\n" + agent.chat("成果物がまだ確認できません。必要なツールを呼んで完了させてください。")
        if not check():
            raise PipelineError(f"{key} 担当が成果を出せませんでした")
        return text

    def run_pipeline(self, p: Project) -> dict:
        self.cur = p
        self.projects[p.id] = p
        self.post("director", f"『{p.artist} — {p.title}』の制作を開始します(解説 → タイミング → 動画 → 教材)")
        t = self._run_stage("analysis", "入力された歌詞を解説し、日本語訳を付けてください。", lambda: p.analysis is not None)
        self.post("analyst", t, [p.dir / "explanation" / "explanation.html"])
        t = self._run_stage("timing", "音源を用意し、歌詞の各行に時刻を付けてください。", lambda: p.audio.exists() and p.meta is not None)
        self.post("timer", t)
        t = self._run_stage("video", "背景画像を選んで歌詞動画を仕上げてください。", lambda: p.video.exists())
        self.post("editor", t, [p.video])
        t = self._run_stage("lesson", "歌詞から英語教材を作ってください。", lambda: (p.dir / "lesson" / "lesson.html").exists())
        lesson_dir = p.dir / "lesson"
        self.post("educator", t, [lesson_dir / "lesson.html", lesson_dir / "anki_vocab.tsv", lesson_dir / "quiz.md"])
        q = (p.meta or {}).get("timing", {})
        return {"project_id": p.id, "video": str(p.video), "timing_quality": q.get("quality"), "timing_method": q.get("method")}

    # ---------- ディレクター(対話ループ) ----------
    def _director_tools(self):
        def create_from_lyrics(title: str, artist: str, lyrics: str, audio_url: str | None = None):
            if len(lyrics.strip().splitlines()) < 4:
                raise ValueError("歌詞が短すぎます(4行以上)")
            return self.run_pipeline(Project.create(self.work, title, artist, lyrics, audio_url))

        def revise(project_id: str, stage: str, instruction: str):
            if project_id not in self.projects:
                raise KeyError(f"project {project_id} は存在しません")
            self.cur = self.projects[project_id]
            agent = self.sub[stage]
            agent.messages = []
            text = agent.chat(f"修正依頼: {instruction}\n(現在の状態は各ツールで読んでから対応してください)")
            if stage == "video":
                self.post("editor", text, [self.cur.video])
            return {"reply": text, "project_id": project_id}

        def list_projects():
            return [{"id": p.id, "song": f"{p.artist} — {p.title}", "has_video": p.video.exists()} for p in self.projects.values()]

        def send_files(project_id: str, what: list[str]):
            p = self.projects[project_id]
            paths = {"video": p.video, "explanation": p.dir / "explanation" / "explanation.html",
                     "lesson": p.dir / "lesson" / "lesson.html", "anki": p.dir / "lesson" / "anki_vocab.tsv", "quiz": p.dir / "lesson" / "quiz.md"}
            sent = [w for w in what if w in paths and paths[w].exists()]
            self.pending_files += [paths[w] for w in sent]
            return {"queued": sent}
        tools = [{"name": "create_from_lyrics", "description": "歌詞から解説・教材・歌詞動画まで一括で作る(数分かかる)。", "input_schema": {"type": "object", "properties": {
                     "title": {"type": "string"}, "artist": {"type": "string"}, "lyrics": {"type": "string"}, "audio_url": {"type": "string", "description": "音源のURL(省略可。省略時は自動検索)"}},
                     "required": ["title", "artist", "lyrics"]}},
                 {"name": "revise", "description": "指定した段階の担当だけにやり直しを依頼する。", "input_schema": {"type": "object", "properties": {
                     "project_id": {"type": "string"}, "stage": {"type": "string", "enum": ["analysis", "timing", "video", "lesson"]}, "instruction": {"type": "string"}},
                     "required": ["project_id", "stage", "instruction"]}},
                 {"name": "list_projects", "description": "これまでの曲の一覧。", "input_schema": {"type": "object", "properties": {}}},
                 {"name": "send_files", "description": "成果物をユーザーに送る。", "input_schema": {"type": "object", "properties": {
                     "project_id": {"type": "string"}, "what": {"type": "array", "items": {"type": "string", "enum": ["video", "explanation", "lesson", "anki", "quiz"]}}}, "required": ["project_id", "what"]}}]
        return tools, {"create_from_lyrics": create_from_lyrics, "revise": revise, "list_projects": list_projects, "send_files": send_files}

    def chat(self, text: str) -> str:
        """ユーザー発言を受けて返信する(Discord のスタジオチャンネルから呼ぶ)。"""
        return self.director.chat(text)

    def take_files(self) -> list[Path]:
        files, self.pending_files = self.pending_files, []
        return [f for f in files if f.exists()]
