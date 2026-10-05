"""Discord から端末(Pixel/Termux)のボットを保守するための固定操作。

コードの配信経路は「自分の GitHub リポジトリ → git pull」だけ。Discord の添付ファイルをコードとして
書き込む機能や、任意のシェル実行は意図的に持たない(アカウントが乗っ取られても端末でコードを実行させない)。
呼べるのは DISCORD_ALLOWED_USER_IDS のユーザーのみ。
"""
import os
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent      # lyrics-english/


def _run(cmd: list[str], cwd: Path = PROJECT, timeout: int = 300) -> tuple[int, str]:
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
    return r.returncode, (r.stdout + r.stderr).strip()


def revision() -> str:
    code, out = _run(["git", "log", "-1", "--format=%h %s"])
    return out if code == 0 else "(git 情報なし)"


def update() -> str:
    """origin の最新を fast-forward で取り込み、依存を入れ直す。ローカル変更があれば失敗する(上書きしない)。"""
    log = []
    for label, cmd in (("git pull --ff-only", ["git", "pull", "--ff-only"]),
                       ("pip install -e .", [sys.executable, "-m", "pip", "install", "-e", str(PROJECT), "-q"])):
        code, out = _run(cmd)
        log.append(f"$ {label}\n{out[-600:]}")
        if code != 0:
            raise RuntimeError("\n".join(log))
    return "\n".join(log) + f"\n現在: {revision()}"


def adb_status() -> str:
    try:
        return _run(["adb", "devices"], timeout=15)[1]
    except FileNotFoundError:
        return "adb が見つかりません(pkg install android-tools)"


def status(jobs=None) -> str:
    run = [f"{j.id}:{j.state}/{j.stage}" for j in (jobs.jobs.values() if jobs else [])][-5:]
    return (f"版: {revision()}\nPython {sys.version.split()[0]} / backend={os.environ.get('LYRICLEARN_BACKEND') or 'auto'}\n"
            f"adb:\n{adb_status()}\nジョブ: {', '.join(run) or 'なし'}")


def restart():
    """プロセスを入れ替えてボットを再起動する(update で取り込んだコードを読み込む)。"""
    os.execv(sys.executable, [sys.executable, "-m", "lyriclearn.discord_bot"])
