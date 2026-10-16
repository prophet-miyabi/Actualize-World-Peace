"""歌詞の各行に曲内の時刻を付ける。

優先順: ① LRCLIB の時刻つき歌詞(LRC) → ② 音声認識(faster-whisper があれば) → ③ 長さからの推定。
いずれも「ユーザーが入力した歌詞の行」に時刻を対応づける(歌詞の本文は入力のものを使う)。
"""
import json
import re
import urllib.parse
import urllib.request
from difflib import SequenceMatcher

LRC_LINE = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)$")


def parse_lrc(text: str) -> list[tuple[float, str]]:
    """LRC 形式('[mm:ss.xx] 歌詞')を (秒, 文字列) の列にする。時刻タグが複数ある行にも対応。"""
    out = []
    for raw in text.splitlines():
        tags, rest = [], raw.strip()
        while (m := re.match(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)$", rest)):
            tags.append(int(m[1]) * 60 + float(m[2]))
            rest = m[3]
        out += [(t, rest.strip()) for t in tags]
    return sorted(out)


def _get(url: str, timeout: int = 15):
    req = urllib.request.Request(url, headers={"User-Agent": "lyriclearn (personal use)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_synced(artist: str, title: str, duration: float | None = None) -> str | None:
    """LRCLIB から時刻つき歌詞(LRC文字列)を探す。見つからなければ None。"""
    q = {"artist_name": artist, "track_name": title}
    if duration:
        q["duration"] = int(round(duration))
    try:
        j = _get("https://lrclib.net/api/get?" + urllib.parse.urlencode(q))
        if j.get("syncedLyrics"):
            return j["syncedLyrics"]
    except Exception:
        pass
    try:
        res = _get("https://lrclib.net/api/search?" + urllib.parse.urlencode({"q": f"{artist} {title}"}))
    except Exception:
        return None
    res = [r for r in res if r.get("syncedLyrics")]
    if duration:
        res.sort(key=lambda r: abs((r.get("duration") or 0) - duration))
    return res[0]["syncedLyrics"] if res else None


def transcribe_segments(audio_path: str, language: str = "en") -> list[tuple[float, str]]:
    """faster-whisper があれば音声認識の区間(開始秒, 文字)を返す。なければ ImportError。"""
    from faster_whisper import WhisperModel
    model = WhisperModel("small", compute_type="int8")
    segs, _ = model.transcribe(audio_path, language=language, vad_filter=True)
    return [(s.start, s.text.strip()) for s in segs if s.text.strip()]


def _norm(s: str) -> str:
    return re.sub(r"[^\w\u3040-\u30ff\u3400-\u9fff]+", "", s.lower())


def align_lines(lines: list[str], timed: list[tuple[float, str]], min_ratio: float = 0.55, window: int = 8):
    """入力歌詞の各行を、時刻つきテキストの行へ順番を保ったまま対応づける。

    戻り値: (各行の開始秒[未対応は補間], 対応できた割合)。
    """
    starts: list[float | None] = [None] * len(lines)
    j = 0
    for i, ln in enumerate(lines):
        a = _norm(ln)
        best, best_k = 0.0, None
        for k in range(j, min(j + window, len(timed))):
            r = SequenceMatcher(None, a, _norm(timed[k][1])).ratio() if a else 0.0
            if r > best:
                best, best_k = r, k
        if best_k is not None and best >= min_ratio:
            starts[i], j = timed[best_k][0], best_k + 1
    matched = sum(s is not None for s in starts)
    return _interpolate(starts), (matched / len(lines) if lines else 0.0)


def _interpolate(starts: list[float | None], gap: float = 3.0) -> list[float]:
    known = [i for i, s in enumerate(starts) if s is not None]
    if not known:
        return [i * gap for i in range(len(starts))]
    out = list(starts)
    for a, b in zip(known, known[1:]):                       # 既知の間は等間隔で補間
        for i in range(a + 1, b):
            out[i] = starts[a] + (starts[b] - starts[a]) * (i - a) / (b - a)
    for i in range(known[0] - 1, -1, -1):                    # 先頭側
        out[i] = max(out[i + 1] - gap, 0.0)
    for i in range(known[-1] + 1, len(out)):                 # 末尾側
        out[i] = out[i - 1] + gap
    return out


def estimate(lines: list[str], duration: float, lead: float = 0.06, tail: float = 0.08) -> list[float]:
    """時刻情報がないときの推定。文字数に比例して曲の中盤に配分する(精度は低い)。"""
    weights = [max(len(_norm(l)), 1) for l in lines]
    total, t, out = sum(weights), duration * lead, []
    span = duration * (1 - lead - tail)
    for w in weights:
        out.append(t)
        t += span * w / total
    return out


def to_timeline(starts: list[float], duration: float, max_len: float = 9.0, min_len: float = 1.2) -> list[tuple[float, float]]:
    """開始秒から (開始, 終了) を作る。終了は次の行の直前まで(長すぎる間奏は max_len で切る)。"""
    out = []
    for i, s in enumerate(starts):
        nxt = starts[i + 1] if i + 1 < len(starts) else duration
        end = min(max(nxt - 0.08, s + min_len), s + max_len, duration)
        out.append((round(s, 2), round(max(end, s + 0.5), 2)))
    return out
