"""Discord で対話しながら教材作成を回す。ブラウザ録画をするため、ログイン済みの自分のPC上で動かすこと。

環境変数:
  DISCORD_BOT_TOKEN         必須
  DISCORD_ALLOWED_USER_IDS  必須。操作を許可するユーザーID(カンマ区切り)。YouTubeログインを使うので必ず絞る
  DISCORD_CHANNEL_ID        任意。指定するとそのチャンネルだけで反応(未指定ならDMとメンション)
  ANTHROPIC_API_KEY         必須
"""
import asyncio
import json
import os
import subprocess
from pathlib import Path

import discord

from . import devops
from .agent import Agent
from .compose import probe_duration
from .jobs import JobManager
from .team.orchestrator import STAGES, PipelineError, run_pipeline
from .team.roles import Team

UPLOAD_LIMIT = 24 * 1024 * 1024

# 担当エージェントごとのチャンネル(!setup で作成)
LAB = {"lobby": ("lyrics-lobby", "全自動の起動 (!auto) と進捗の確認"),
       "curator": ("1-curator", "曲選定担当: 日本で今聞かれている英語の曲を選ぶ"),
       "recorder": ("2-recorder", "録画担当: YouTube Music の歌詞(和訳)画面を録画"),
       "editor": ("3-editor", "編集担当: 背景を抜いてジャケット/アーティスト写真を挿入"),
       "teacher": ("4-teacher", "教材担当: 歌詞から単語・フレーズ・文法・クイズを作る")}
STAGE_ROLE = {"download": "recorder", "record": "recorder", "compose": "editor", "study": "teacher"}


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
        self.work, self.team, self.pipeline_running = work, None, False
        self.reg_path = work / "discord_channels.json"
        self.channels: dict[str, int] = json.loads(self.reg_path.read_text()) if self.reg_path.exists() else {}

    # ---- job thread → Discord ----
    def _post(self, channel_id: int, coro_factory):
        asyncio.run_coroutine_threadsafe(coro_factory(), self.loop)

    def _on_event(self, job, text):
        async def send():
            ch = self.get_channel(job.owner) or await self.fetch_channel(job.owner)
            await ch.send(f"`{job.id}` {text}"[:1900])
        if job.owner and not text.startswith(("完了", "再編集完了", "エラー")):   # 結果はエージェントが説明する
            self._post(job.owner, send)
        elif not job.owner and not text.startswith("完了"):                    # チーム実行のジョブ: 担当チャンネルへ進捗
            role = STAGE_ROLE.get(job.stage, "recorder")
            if role in self.channels:
                asyncio.run_coroutine_threadsafe(self._send(role, f"`{job.id}` {text}"), self.loop)

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
        text = m.content.replace(f"<@{self.user.id}>", "").strip()
        role = next((r for r, cid in self.channels.items() if cid == m.channel.id), None)
        if role:                                              # 担当チャンネル: その担当と直接話す
            if text.startswith("!"):
                return await self._command(m.channel, text)
            if role == "lobby":
                return await m.channel.send("全自動は `!auto`。個別の指示は各担当のチャンネルへ。")
            return await self._team_chat(role, text)
        if self.channel_id and m.channel.id != self.channel_id:
            return
        if not self.channel_id and not (isinstance(m.channel, discord.DMChannel) or self.user in m.mentions or text.startswith("!")):
            return
        if text.startswith("!"):
            return await self._command(m.channel, text)
        if text:
            await self._turn(m.channel.id, text)

    # ---- 担当チーム ----
    def _team(self) -> Team:
        if self.team is None:
            self.team = Team(self.jobs, self.work)
        return self.team

    async def _send(self, role: str, text: str, files: list[Path] | None = None):
        ch = self.get_channel(self.channels[role]) or await self.fetch_channel(self.channels[role])
        att = []
        for f in files or []:
            f = await asyncio.to_thread(shrink_video, f) if f.suffix == ".mp4" else f
            att.append(discord.File(f, filename=f.name))
        chunks = [text[i:i + 1900] for i in range(0, len(text), 1900)] or ["(空)"]
        for i, c in enumerate(chunks):
            await ch.send(c, files=att if i == len(chunks) - 1 else [])

    async def _team_chat(self, role: str, text: str):
        ch = self.get_channel(self.channels[role])
        async with ch.typing():
            reply = await asyncio.to_thread(self._team().agents[role].chat, text)
        await self._send(role, reply)

    async def _setup_channels(self, guild: discord.Guild):
        cat = discord.utils.get(guild.categories, name="Lyrics Lab") or await guild.create_category("Lyrics Lab")
        for role, (name, topic) in LAB.items():
            ch = discord.utils.get(cat.text_channels, name=name) or await guild.create_text_channel(name, category=cat, topic=topic)
            self.channels[role] = ch.id
        self.reg_path.parent.mkdir(parents=True, exist_ok=True)
        self.reg_path.write_text(json.dumps(self.channels))
        return {r: f"<#{c}>" for r, c in self.channels.items()}

    async def _auto(self, hint: str, start: str):
        loop = asyncio.get_running_loop()

        def post(role, text, files=None):
            asyncio.run_coroutine_threadsafe(self._send(role, text, files), loop).result(timeout=300)
        self.pipeline_running = True
        try:
            await asyncio.to_thread(run_pipeline, self._team(), post, hint or None, start)
        except PipelineError:
            pass                                              # 失敗内容は lobby に投稿済み
        except Exception as e:
            await self._send("lobby", f"パイプラインが失敗: {type(e).__name__}: {str(e)[:1500]}")
        finally:
            self.pipeline_running = False

    HELP = ("`!setup` 担当チャンネルを作成 / `!auto [ヒント]` 全自動 / `!auto resume <curator|recorder|editor|teacher>` 途中から再開 / "
            "`!status` 端末の状態 / `!update` GitHub の最新コードを取り込んで再起動 / "
            "`!adb` adb 接続確認 / `!restart` 再起動")

    async def _command(self, ch, text: str):
        """端末の保守コマンド。許可ユーザーのみ(on_message で確認済み)。コードは git pull でしか入らない。"""
        cmd = text.split()[0].lower()
        busy = [j.id for j in self.jobs.jobs.values() if j.state == "running"]
        try:
            if cmd == "!setup":
                if not getattr(ch, "guild", None):
                    return await ch.send("サーバー(ギルド)のチャンネルで実行してください")
                made = await self._setup_channels(ch.guild)
                return await ch.send("担当チャンネルを用意しました: " + " / ".join(f"{r} {c}" for r, c in made.items())
                                     + "\n(ボットに「チャンネルの管理」権限が必要です)")
            if cmd == "!auto":
                if not self.channels:
                    return await ch.send("先に `!setup` で担当チャンネルを作成してください")
                if self.pipeline_running or busy:
                    return await ch.send("実行中のパイプライン/ジョブがあります。終わってから実行してください")
                rest = text.split(maxsplit=1)[1] if " " in text else ""
                start = "curator"
                if rest.startswith("resume"):
                    start = (rest.split() + [""])[1]
                    if start not in STAGES:
                        return await ch.send(f"再開できる工程: {', '.join(STAGES)}")
                    rest = ""
                asyncio.create_task(self._auto(rest, start))
                return await ch.send("全自動を開始します。進捗は各担当のチャンネルへ。")
            if cmd == "!status":
                return await ch.send("```\n" + devops.status(self.jobs) + "\n```")
            if cmd == "!adb":
                return await ch.send("```\n" + await asyncio.to_thread(devops.adb_status) + "\n```")
            if cmd in ("!update", "!restart"):
                if busy and "force" not in text:
                    return await ch.send(f"ジョブ実行中({', '.join(busy)})のため中断。終わってからか `{cmd} force` で")
                msg = ("```\n" + await asyncio.to_thread(devops.update) + "\n```") if cmd == "!update" else ""
                await ch.send((msg[:1700] + "\n再起動して反映します…").strip())
                await asyncio.sleep(1)
                devops.restart()
                return
            await ch.send(self.HELP)
        except Exception as e:
            await ch.send(f"失敗: {type(e).__name__}: {str(e)[:1500]}")


def main():
    allowed = {int(x) for x in os.environ.get("DISCORD_ALLOWED_USER_IDS", "").split(",") if x.strip()}
    if not allowed:
        raise SystemExit("DISCORD_ALLOWED_USER_IDS を設定してください(ログイン済みブラウザを操作するため必須)")
    cid = os.environ.get("DISCORD_CHANNEL_ID")
    Bot(Path(os.environ.get("LYRICLEARN_WORK", "work")), Path(os.environ.get("LYRICLEARN_PROFILE", ".profile")),
        allowed, int(cid) if cid else None).run(os.environ["DISCORD_BOT_TOKEN"])


if __name__ == "__main__":
    main()
