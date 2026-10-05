"""Discord で対話しながら教材作成を回す。ブラウザ録画をするため、ログイン済みの自分のPC上で動かすこと。

環境変数:
  DISCORD_BOT_TOKEN         必須
  DISCORD_ALLOWED_USER_IDS  必須。操作を許可するユーザーID(カンマ区切り)。YouTubeログインを使うので必ず絞る
  DISCORD_CHANNEL_ID        任意。指定するとそのチャンネルだけで反応(未指定ならDMとメンション)
  ANTHROPIC_API_KEY         必須
"""
import asyncio
import os
import subprocess
from pathlib import Path

import discord

from .agent import Agent
from .compose import probe_duration
from .jobs import JobManager

UPLOAD_LIMIT = 24 * 1024 * 1024


def shrink_video(path: Path, limit: int = UPLOAD_LIMIT) -> Path:
    """Discord のアップロード上限に収まるようビットレートを下げて再エンコードする。"""
    if path.stat().st_size <= limit:
        return path
    out = path.with_name(path.stem + "_small.mp4")
    kbps = int(limit * 8 * 0.85 / probe_duration(path) / 1000) - 128
    subprocess.run(["ffmpeg", "-y", "-i", str(path), "-c:v", "libx264", "-b:v", f"{max(kbps, 100)}k",
                    "-c:a", "aac", "-b:a", "128k", str(out)], check=True, capture_output=True)
    return out


class Bot(discord.Client):
    def __init__(self, work: Path, profile: Path, allowed: set[int], channel_id: int | None):
        intents = discord.Intents.default()
        intents.message_content = True
        super().__init__(intents=intents)
        self.allowed, self.channel_id = allowed, channel_id
        self.agents: dict[int, Agent] = {}
        self.locks: dict[int, asyncio.Lock] = {}
        self.jobs = JobManager(work, profile, on_event=self._on_event, on_finish=self._on_finish)

    # ---- job thread → Discord ----
    def _post(self, channel_id: int, coro_factory):
        asyncio.run_coroutine_threadsafe(coro_factory(), self.loop)

    def _on_event(self, job, text):
        async def send():
            ch = self.get_channel(job.owner) or await self.fetch_channel(job.owner)
            await ch.send(f"`{job.id}` {text}"[:1900])
        if job.owner and not text.startswith(("完了", "再編集完了", "エラー")):   # 結果はエージェントが説明する
            self._post(job.owner, send)

    def _on_finish(self, job):
        """ジョブ完了/失敗をエージェントへ通知 → 返信と成果物を投稿。これが対話ループの駆動役。"""
        note = (f"[system] job {job.id} が完了しました。結果: {job.result}" if job.state == "done"
                else f"[system] job {job.id} が失敗しました: {job.message}")
        if job.owner:
            self._post(job.owner, lambda: self._turn(job.owner, note))

    # ---- conversation ----
    def _agent(self, channel_id: int) -> Agent:
        if channel_id not in self.agents:
            self.agents[channel_id] = Agent(self.jobs, owner=channel_id)
        return self.agents[channel_id]

    async def _turn(self, channel_id: int, text: str):
        ch = self.get_channel(channel_id) or await self.fetch_channel(channel_id)
        lock = self.locks.setdefault(channel_id, asyncio.Lock())
        async with lock:   # 同一チャンネルの発言/通知を直列化
            agent = self._agent(channel_id)
            async with ch.typing():
                reply = await asyncio.to_thread(agent.chat, text)
                files = []
                for p in agent.take_files():
                    p = await asyncio.to_thread(shrink_video, p) if p.suffix == ".mp4" else p
                    files.append(discord.File(p, filename=p.name))
            await ch.send(reply[:1900] or "(空の応答)", files=files)

    async def on_ready(self):
        print(f"logged in as {self.user}")

    async def on_message(self, m: discord.Message):
        if m.author.bot or m.author.id not in self.allowed:
            return
        if self.channel_id and m.channel.id != self.channel_id:
            return
        if not self.channel_id and not (isinstance(m.channel, discord.DMChannel) or self.user in m.mentions):
            return
        text = m.content.replace(f"<@{self.user.id}>", "").strip()
        if text:
            await self._turn(m.channel.id, text)


def main():
    allowed = {int(x) for x in os.environ.get("DISCORD_ALLOWED_USER_IDS", "").split(",") if x.strip()}
    if not allowed:
        raise SystemExit("DISCORD_ALLOWED_USER_IDS を設定してください(ログイン済みブラウザを操作するため必須)")
    cid = os.environ.get("DISCORD_CHANNEL_ID")
    Bot(Path(os.environ.get("LYRICLEARN_WORK", "work")), Path(os.environ.get("LYRICLEARN_PROFILE", ".profile")),
        allowed, int(cid) if cid else None).run(os.environ["DISCORD_BOT_TOKEN"])


if __name__ == "__main__":
    main()
