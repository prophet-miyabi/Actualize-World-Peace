"""録画中に取得した (再生位置, 現在行の英語, 和訳) のサンプル列から、時刻つき歌詞行を作る。"""
from dataclasses import dataclass, asdict
from statistics import median


@dataclass
class Line:
    start: float   # 曲内の秒数(再生位置基準)
    end: float
    text: str
    translation: str = ""

    def to_dict(self):
        return asdict(self)


def build_lines(samples: list[dict], min_duration: float = 0.3) -> list[Line]:
    """samples: [{"playhead": float, "text": str, "translation": str}, ...] 時系列順。

    同じ text が連続している間を1行とみなす。空文字(間奏など)は行を切るだけ。
    """
    lines: list[Line] = []
    cur: Line | None = None
    last_t = 0.0
    for s in samples:
        t, text = s["playhead"], (s.get("text") or "").strip()
        if cur and text != cur.text:
            cur.end = t
            lines.append(cur)
            cur = None
        if text and cur is None:
            cur = Line(t, t, text, (s.get("translation") or "").strip())
        elif cur and not cur.translation and s.get("translation"):
            cur.translation = s["translation"].strip()
        last_t = t
    if cur:
        cur.end = last_t
        lines.append(cur)
    return [l for l in lines if l.end - l.start >= min_duration]


def estimate_offset(samples: list[dict]) -> float:
    """録画動画内で曲の再生位置が 0 になる時刻(秒)。

    samples: [{"wall": 録画開始からの秒, "playhead": 再生位置秒}, ...]
    再生中(playheadが前進)のサンプルだけを使い、wall - playhead の中央値を取る。
    """
    diffs = []
    for a, b in zip(samples, samples[1:]):
        if b["playhead"] > a["playhead"] > 0 and abs((b["wall"] - a["wall"]) - (b["playhead"] - a["playhead"])) < 0.3:
            diffs.append(b["wall"] - b["playhead"])
    if not diffs:
        raise ValueError("再生が進んでいるサンプルがありません。録画中に曲が再生されていたか確認してください")
    return median(diffs)
