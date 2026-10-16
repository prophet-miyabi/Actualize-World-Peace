"""1曲ぶんの作業フォルダ(入力・解説・時刻つき歌詞・動画・教材)。担当間の引き継ぎはこのファイルで行う。"""
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path


def make_slug(artist: str, title: str, lyrics: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", f"{artist}-{title}".lower()).strip("-")[:32] or "song"
    return f"{base}-{hashlib.sha1((artist + title + lyrics).encode()).hexdigest()[:6]}"


@dataclass
class Project:
    id: str
    title: str
    artist: str
    dir: Path
    raw_lyrics: str
    audio_url: str | None = None
    notes: list[str] = field(default_factory=list)

    @classmethod
    def create(cls, work: Path, title: str, artist: str, lyrics: str, audio_url: str | None = None) -> "Project":
        pid = make_slug(artist, title, lyrics)
        p = cls(pid, title, artist, work / "studio" / pid, lyrics.strip(), audio_url)
        p.dir.mkdir(parents=True, exist_ok=True)
        p.save()
        return p

    def save(self):
        (self.dir / "project.json").write_text(json.dumps(
            {"id": self.id, "title": self.title, "artist": self.artist, "raw_lyrics": self.raw_lyrics,
             "audio_url": self.audio_url, "notes": self.notes}, ensure_ascii=False, indent=2))

    def _json(self, name):
        f = self.dir / name
        return json.loads(f.read_text()) if f.exists() else None

    @property
    def analysis(self) -> dict | None:
        return self._json("analysis.json")

    @property
    def meta(self) -> dict | None:
        return self._json("meta.json")

    @property
    def audio(self) -> Path:
        return self.dir / "audio.mp3"

    @property
    def video(self) -> Path:
        return self.dir / "lyrics_video.mp4"
