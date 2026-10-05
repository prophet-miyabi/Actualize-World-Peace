"""エージェントから呼ばれるジョブ実行層。ブラウザは1つしか使えないので直列に処理する。"""
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .compose import compose
from .config import Config
from .download import download_audio, video_id
from .study import extract_words, llm_glosses, write_materials


@dataclass
class Job:
    id: str
    url: str
    dir: Path
    state: str = "queued"          # queued | running | done | error
    stage: str = ""
    message: str = ""
    result: dict = field(default_factory=dict)
    log: list[str] = field(default_factory=list)
    owner: object = None           # 通知先(例: Discord チャンネルID)


class JobManager:
    def __init__(self, work: Path, profile: Path, on_event=None, on_finish=None):
        self.work, self.profile = work, profile
        self.on_event = on_event or (lambda job, text: None)  # Discord への進捗通知などに使う
        self.on_finish = on_finish or (lambda job: None)   # done/error になったとき1回呼ぶ
        self.jobs: dict[str, Job] = {}
        self._pool = ThreadPoolExecutor(max_workers=1)
        self._lock = threading.Lock()

    def _say(self, job: Job, text: str):
        job.log.append(text)
        self.on_event(job, text)

    def start(self, url: str, headless: bool = False, llm: bool = False, cfg: Config | None = None, owner=None) -> Job:
        job = Job(uuid.uuid4().hex[:8], url, self.work / video_id(url), owner=owner)
        with self._lock:
            self.jobs[job.id] = job
        self._pool.submit(self._run, job, headless, llm, cfg or Config())
        return job

    def _run(self, job: Job, headless: bool, llm: bool, cfg: Config):
        job.state = "running"
        try:
            job.stage = "download"; self._say(job, "音源をダウンロード中…")
            download_audio(job.url, job.dir)
            job.stage = "record"; self._say(job, "YouTube Music を開いて歌詞画面を録画中(曲の長さぶん待ちます)…")
            from .record import record
            meta = record(job.url, job.dir, self.profile, cfg, headless=headless, manual_setup=False,
                          log=lambda t: self._say(job, t))
            self._say(job, f"録画完了: {len(meta['lines'])}行を取得")
            job.result = self._finish(job, meta, cfg, llm)
            job.state = "done"
            self._say(job, "完了: " + json.dumps(job.result, ensure_ascii=False))
        except Exception as e:  # エージェントに原因を伝えて対話で復旧させる
            job.state, job.message = "error", f"{type(e).__name__}: {e}"
            self._say(job, "エラー: " + job.message)
        finally:
            self.on_finish(job)

    def _finish(self, job: Job, meta: dict, cfg: Config, llm: bool) -> dict:
        job.stage = "compose"; self._say(job, "動画を編集中(切り抜き+音源同期)…")
        compose(job.dir / "recording.webm", job.dir / "audio.mp3", meta, job.dir / "lyrics_video.mp4", cfg)
        job.stage = "study"; self._say(job, "教材を作成中…")
        gl = llm_glosses(meta["lines"], extract_words(meta["lines"])) if llm else None
        stats = write_materials(meta, job.dir / "audio.mp3", job.dir / "study", gl)
        return {**stats, "video": str(job.dir / "lyrics_video.mp4"), "study_dir": str(job.dir / "study")}

    def retune(self, job_id: str, sync_nudge: float | None = None, bg_key: str | None = None,
               bg_color: str | None = None, llm: bool = False) -> Job:
        """再録画せずに compose / study だけやり直す。"""
        job = self.jobs[job_id]
        meta = json.loads((job.dir / "meta.json").read_text())
        cfg = Config()
        if bg_key:
            cfg.bg_key = bg_key
        if bg_color:
            cfg.bg_color = bg_color
        if sync_nudge:
            meta["offset"] += sync_nudge
            (job.dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
        job.state = "running"
        self._pool.submit(self._redo, job, meta, cfg, llm)
        return job

    def _redo(self, job: Job, meta: dict, cfg: Config, llm: bool):
        try:
            job.result = self._finish(job, meta, cfg, llm)
            job.state = "done"
            self._say(job, "再編集完了: " + json.dumps(job.result, ensure_ascii=False))
        except Exception as e:
            job.state, job.message = "error", f"{type(e).__name__}: {e}"
            self._say(job, "エラー: " + job.message)
        finally:
            self.on_finish(job)
