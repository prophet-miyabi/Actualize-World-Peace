"""歌詞行から単語・フレーズを切り出し、音声クリップつきの教材(Anki TSV / HTML)にする。"""
import html
import json
import re
import subprocess
from pathlib import Path

STOPWORDS = set("""a about above after again all am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is
it its itself just me more most my myself no nor not now of off on once only or other our out over own same she should so some such
than that the their them then there these they this those through to too under until up very was we were what when where which while
who whom why will with would you your yours oh yeah ooh na la gonna wanna gotta cause""".split())
PARTICLES = {"up", "out", "off", "on", "in", "down", "away", "over", "back", "through", "around", "along", "into"}
TOKEN = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")


def tokens(text: str) -> list[str]:
    return [t.lower() for t in TOKEN.findall(text)]


def extract_words(lines: list[dict], max_zipf: float = 4.8) -> list[dict]:
    """行ごとに学習価値のある単語を拾う。wordfreq があれば頻出語(zipf > max_zipf)を除外。"""
    try:
        from wordfreq import zipf_frequency
    except ImportError:
        zipf_frequency = None
    seen, out = set(), []
    for i, ln in enumerate(lines):
        for w in tokens(ln["text"]):
            if w in STOPWORDS or len(w) < 3 or w in seen:
                continue
            if zipf_frequency and zipf_frequency(w, "en") > max_zipf:
                continue
            seen.add(w)
            out.append({"word": w, "line": i})
    return out


def extract_phrases(lines: list[dict]) -> list[dict]:
    """句動詞(動詞+前置詞/副詞)と、3〜8語の短い行をフレーズ候補にする。"""
    out = []
    for i, ln in enumerate(lines):
        toks = tokens(ln["text"])
        for a, b in zip(toks, toks[1:]):
            if b in PARTICLES and a not in STOPWORDS and len(a) > 2:
                out.append({"phrase": f"{a} {b}", "line": i, "kind": "phrasal"})
        if 3 <= len(toks) <= 8:
            out.append({"phrase": ln["text"].strip(), "line": i, "kind": "chunk"})
    return out


def cut_audio(audio: Path, lines: list[dict], out_dir: Path, pad: float = 0.25) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, ln in enumerate(lines):
        p = out_dir / f"line_{i:03d}.mp3"
        start = max(ln["start"] - pad, 0)
        subprocess.run(["ffmpeg", "-y", "-ss", f"{start:.3f}", "-to", f"{ln['end'] + pad:.3f}", "-i", str(audio),
                        "-c:a", "libmp3lame", "-q:a", "4", str(p)], check=True, capture_output=True)
        paths.append(p)
    return paths


def llm_glosses(lines: list[dict], words: list[dict], model: str = "claude-sonnet-5-5") -> dict[str, str]:
    """単語ごとの日本語の意味(歌詞中の用法に合わせた)を Claude に作らせる。ANTHROPIC_API_KEY が必要。"""
    import anthropic

    items = [{"word": w["word"], "context": lines[w["line"]]["text"]} for w in words]
    prompt = ("次の英単語それぞれについて、文脈(歌詞)での意味を日本語で簡潔に(20字以内)答えてください。"
              'JSONオブジェクト {"単語": "意味"} のみを返してください。\n' + json.dumps(items, ensure_ascii=False))
    msg = anthropic.Anthropic().messages.create(model=model, max_tokens=4096,
                                                messages=[{"role": "user", "content": prompt}])
    text = msg.content[0].text
    return json.loads(text[text.index("{"): text.rindex("}") + 1])


def write_materials(meta: dict, audio: Path | None, out_dir: Path, glosses: dict[str, str] | None = None) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    lines = meta["lines"]
    words, phrases = extract_words(lines), extract_phrases(lines)
    clips = cut_audio(audio, lines, out_dir / "clips") if audio else [None] * len(lines)
    glosses = glosses or {}

    rows = []  # Anki: 表=英語(+音声) / 裏=和訳+単語
    for i, ln in enumerate(lines):
        ws = [w["word"] for w in words if w["line"] == i]
        back = ln["translation"] + ("<br>" + " / ".join(f"{w}: {glosses.get(w, '')}" for w in ws) if ws else "")
        front = ln["text"] + (f" [sound:{clips[i].name}]" if clips[i] else "")
        rows.append(f"{front}\t{back}")
    (out_dir / "anki_lines.tsv").write_text("\n".join(rows) + "\n")

    wrows = [f"{w['word']}\t{glosses.get(w['word'], '')}<br>{html.escape(lines[w['line']]['text'])}"
             f"<br>{html.escape(lines[w['line']]['translation'])}" for w in words]
    (out_dir / "anki_words.tsv").write_text("\n".join(wrows) + "\n")
    (out_dir / "phrases.json").write_text(json.dumps(phrases, ensure_ascii=False, indent=2))

    body = "".join(
        f"<tr><td>{ln['start']:.1f}s</td><td>{html.escape(ln['text'])}</td><td>{html.escape(ln['translation'])}</td>"
        f"<td>{'<audio controls src=clips/' + clips[i].name + '></audio>' if clips[i] else ''}</td></tr>"
        for i, ln in enumerate(lines))
    wl = "".join(f"<li><b>{w['word']}</b> {html.escape(glosses.get(w['word'], ''))}</li>" for w in words)
    (out_dir / "study.html").write_text(
        f"<!doctype html><meta charset=utf-8><title>study</title><style>td{{padding:4px 10px;border-bottom:1px solid #ddd}}</style>"
        f"<h2>歌詞</h2><table>{body}</table><h2>単語</h2><ul>{wl}</ul>")
    return {"lines": len(lines), "words": len(words), "phrases": len(phrases)}
