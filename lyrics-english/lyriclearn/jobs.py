"""エージェントから呼ばれるジョブ実行層。ブラウザ/端末は1つしか使えないので直列に処理する。

工程: download → record → compose → study。全部まとめても、担当エージェントが工程ごとに呼んでもよい。
"""
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from .compose import compose, detect_bg_key
from .config import Config
from .download import download_audio, video_id
from .study import extract_words, llm_glosses, write_materials

ALL_STAGES = ("download", "record", "compose", "study")


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

    @property
    def meta(self) -> dict:
        return json.loads((self.dir / "meta.json").read_text())


class JobManager:
    def __init__(self, work: Path, profile: Path, on_event=None, on_finish=None):
        self.work, self.profile = work, profile
        self.on_event = on_event or (lambda job, text: None)  # Discord への進捗通知などに使う
        self.on_finish = on_finish or (lambda job: None)      # done/error になったとき1回呼ぶ
        self.jobs: dict[str, Job] = {}
        self._pool = ThreadPoolExecutor(max_workers=1)
        self._lock = threading.Lock()

    def _say(self, job: Job, text: str):
        job.log.append(text)
        self.on_event(job, text)

    def start(self, url: str, headless: bool = False, llm: bool = False, cfg: Config | None = None,
              owner=None, stages: tuple = ALL_STAGES) -> Job:
        job = Job(uuid.uuid4().hex[:8], url, self.work / video_id(url), owner=owner)
        with self._lock:
            self.jobs[job.id] = job
        self._submit(job, stages, headless, llm, cfg or Config())
        return job

    def run_stage(self, job_id: str, stages: tuple, cfg: Config | None = None, llm: bool = False) -> Job:
        """既存ジョブに対して compose / study などを実行する(再録画しない)。"""
        job = self.jobs[job_id]
        self._submit(job, stages, False, llm, cfg or Config())
        return job

    def _submit(self, job: Job, stages, headless, llm, cfg):
        job.state, job.message = "queued", ""
        self._pool.submit(self._run, job, tuple(stages), headless, llm, cfg)

    def wait(self, job_id: str, timeout: float) -> Job:
        """終わるか timeout 秒経つまで待つ(エージェントのツールから使う)。"""
        job, end = self.jobs[job_id], time.monotonic() + timeout
        while job.state in ("queued", "running") and time.monotonic() < end:
            time.sleep(1)
        return job

    def _run(self, job: Job, stages: tuple, headless: bool, llm: bool, cfg: Config):
        job.state = "running"
        log = lambda t: self._say(job, t)
        try:
            if "download" in stages:
                job.stage = "download"; log("音源をダウンロード中…")
                download_audio(job.url, job.dir)
            if "record" in stages:
                job.stage = "record"; log("YouTube Music を開いて歌詞画面を録画中(曲の長さぶん待ちます)…")
                if cfg.backend == "android":
                    from .android import record
                    from .compose import probe_duration
                    meta = record(job.url, job.dir, cfg, duration=probe_duration(job.dir / "audio.mp3"), log=log)
                else:
                    from .record import record
                    meta = record(job.url, job.dir, self.profile, cfg, headless=headless, manual_setup=False, log=log)
                log(f"録画完了: {len(meta['lines'])}行を取得")
                job.result.update(lines=len(meta["lines"]), recording=str(job.dir / meta.get("recording", "recording.webm")))
            if "compose" in stages:
                job.stage = "compose"; log("動画を編集中(切り抜き+音源同期)…")
                meta = job.meta
                if cfg.bg_image and not cfg.bg_key:
                    cfg.bg_key = detect_bg_key(job.dir / meta.get("recording", "recording.webm"), meta.get("crop"))
                    log(f"元の背景色を推定: {cfg.bg_key}")
                compose(job.dir / meta.get("recording", "recording.webm"), job.dir / "audio.mp3", meta,
                        job.dir / "lyrics_video.mp4", cfg)
                job.result["video"] = str(job.dir / "lyrics_video.mp4")
            if "study" in stages:
                job.stage = "study"; log("教材を作成中…")
                meta = job.meta
                gl = llm_glosses(meta["lines"], extract_words(meta["lines"])) if llm else None
                job.result.update(write_materials(meta, job.dir / "audio.mp3", job.dir / "study", gl))
                job.result["study_dir"] = str(job.dir / "study")
            job.state = "done"
            log("完了: " + json.dumps(job.result, ensure_ascii=False))
        except Exception as e:  # エージェントに原因を伝えて対話で復旧させる
            job.state, job.message = "error", f"{type(e).__name__}: {e}"
            log("エラー: " + job.message)
        finally:
            self.on_finish(job)

    def retune(self, job_id: str, sync_nudge: float | None = None, bg_key: str | None = None,
               bg_color: str | None = None, llm: bool = False) -> Job:
        """再録画せず compose / study だけやり直す。"""
        job = self.jobs[job_id]
        cfg = Config()
        if bg_key:
            cfg.bg_key = bg_key
        if bg_color:
            cfg.bg_color = bg_color
        if sync_nudge:
            meta = job.meta
            meta["offset"] += sync_nudge
            (job.dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
        return self.run_stage(job_id, ("compose", "study"), cfg, llm)
