"""教材担当が作った構造化レッスン(JSON)の検証と、HTML / Anki / クイズへの書き出し。"""
import html
import json
from pathlib import Path

from ..study import cut_audio

SCHEMA = {
    "type": "object",
    "properties": {
        "theme_ja": {"type": "string", "description": "曲のテーマを1〜2文で"},
        "level": {"type": "string", "description": "全体の難易度 A2〜C1 など"},
        "vocab": {"type": "array", "items": {"type": "object", "properties": {
            "word": {"type": "string"}, "pos": {"type": "string"}, "meaning_ja": {"type": "string"},
            "level": {"type": "string"}, "line_index": {"type": "integer"}, "note": {"type": "string"}},
            "required": ["word", "meaning_ja", "line_index"]}},
        "phrases": {"type": "array", "items": {"type": "object", "properties": {
            "phrase": {"type": "string"}, "meaning_ja": {"type": "string"},
            "line_index": {"type": "integer"}, "note": {"type": "string"}},
            "required": ["phrase", "meaning_ja", "line_index"]}},
        "grammar": {"type": "array", "items": {"type": "object", "properties": {
            "point": {"type": "string"}, "explanation_ja": {"type": "string"}, "line_index": {"type": "integer"}},
            "required": ["point", "explanation_ja", "line_index"]}},
        "culture_note_ja": {"type": "string"},
        "quiz": {"type": "array", "items": {"type": "object", "properties": {
            "type": {"type": "string", "enum": ["fill", "choice", "translate"]},
            "question": {"type": "string"}, "answer": {"type": "string"},
            "choices": {"type": "array", "items": {"type": "string"}}, "line_index": {"type": "integer"}},
            "required": ["type", "question", "answer", "line_index"]}},
    },
    "required": ["theme_ja", "vocab", "phrases", "quiz"],
}


def validate(lesson: dict, lines: list[dict]) -> list[str]:
    """モデルに自己修正させるためのエラー一覧。空なら OK。"""
    errs, n = [], len(lines)
    for key in ("vocab", "phrases", "grammar", "quiz"):
        for i, it in enumerate(lesson.get(key, [])):
            li = it.get("line_index")
            if not isinstance(li, int) or not 0 <= li < n:
                errs.append(f"{key}[{i}].line_index={li!r} は 0〜{n - 1} の範囲外です")
    for i, w in enumerate(lesson.get("vocab", [])):
        line = lines[w["line_index"]]["text"].lower() if isinstance(w.get("line_index"), int) and 0 <= w["line_index"] < n else ""
        if line and w["word"].lower().split()[0].strip(",.!?") not in line:
            errs.append(f"vocab[{i}] '{w['word']}' が line_index={w['line_index']} の歌詞に含まれていません")
    for i, q in enumerate(lesson.get("quiz", [])):
        if q.get("type") == "choice" and q.get("answer") not in q.get("choices", []):
            errs.append(f"quiz[{i}] の answer が choices に含まれていません")
    if len(lesson.get("vocab", [])) < 3:
        errs.append("vocab が少なすぎます(5〜15語を目安に)")
    return errs


def render(job_dir: Path, meta: dict, lesson: dict, audio: Path | None) -> dict:
    out = job_dir / "lesson"
    out.mkdir(parents=True, exist_ok=True)
    lines = meta["lines"]
    clips = cut_audio(audio, lines, out / "clips") if audio else [None] * len(lines)
    esc = html.escape
    (out / "lesson.json").write_text(json.dumps(lesson, ensure_ascii=False, indent=2))

    def row(li):
        c = clips[li]
        return (f"<div class=ctx>“{esc(lines[li]['text'])}” — {esc(lines[li]['translation'])}"
                + (f" <audio controls src='clips/{c.name}'></audio>" if c else "") + "</div>")

    sec = lambda title, items: f"<h2>{title}</h2>" + "".join(items) if items else ""
    body = (f"<p>{esc(lesson['theme_ja'])} <small>(難易度 {esc(lesson.get('level', '-'))})</small></p>"
            + sec("単語", [f"<div class=card><b>{esc(v['word'])}</b> <i>{esc(v.get('pos', ''))}</i> "
                         f"{esc(v['meaning_ja'])} <small>{esc(v.get('level', ''))}</small>{row(v['line_index'])}"
                         f"<small>{esc(v.get('note', ''))}</small></div>" for v in lesson["vocab"]])
            + sec("フレーズ", [f"<div class=card><b>{esc(p['phrase'])}</b> {esc(p['meaning_ja'])}{row(p['line_index'])}"
                           f"<small>{esc(p.get('note', ''))}</small></div>" for p in lesson["phrases"]])
            + sec("文法", [f"<div class=card><b>{esc(g['point'])}</b><br>{esc(g['explanation_ja'])}{row(g['line_index'])}</div>"
                         for g in lesson.get("grammar", [])])
            + (f"<h2>背景</h2><p>{esc(lesson['culture_note_ja'])}</p>" if lesson.get("culture_note_ja") else "")
            + sec("クイズ", [f"<details class=card><summary>{i + 1}. {esc(q['question'])}"
                           + (f" ({' / '.join(map(esc, q['choices']))})" if q.get("choices") else "")
                           + f"</summary>答え: <b>{esc(q['answer'])}</b>{row(q['line_index'])}</details>"
                           for i, q in enumerate(lesson["quiz"])]))
    (out / "lesson.html").write_text(
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>lesson</title><style>body{font-family:sans-serif;max-width:720px;margin:auto;padding:12px}"
        ".card{border:1px solid #ccc;border-radius:8px;padding:8px;margin:8px 0}.ctx{color:#555;font-size:.9em}"
        "small{color:#888}</style>" + body)

    tsv = []
    for v in lesson["vocab"]:
        li = v["line_index"]
        snd = f" [sound:{clips[li].name}]" if clips[li] else ""
        tsv.append(f"{v['word']}\t{v['meaning_ja']}<br>{esc(lines[li]['text'])}{snd}<br>{esc(lines[li]['translation'])}")
    for p in lesson["phrases"]:
        li = p["line_index"]
        tsv.append(f"{p['phrase']}\t{p['meaning_ja']}<br>{esc(lines[li]['text'])}<br>{esc(lines[li]['translation'])}")
    (out / "anki_vocab.tsv").write_text("\n".join(tsv) + "\n")

    qz = ["# クイズ\n"]
    for i, q in enumerate(lesson["quiz"]):
        qz.append(f"{i + 1}. {q['question']}" + (f"  \n   選択肢: {' / '.join(q['choices'])}" if q.get("choices") else ""))
    qz += ["\n---\n# 答え\n"] + [f"{i + 1}. {q['answer']}" for i, q in enumerate(lesson["quiz"])]
    (out / "quiz.md").write_text("\n".join(qz) + "\n")
    return {"dir": str(out), "vocab": len(lesson["vocab"]), "phrases": len(lesson["phrases"]), "quiz": len(lesson["quiz"]),
            "files": ["lesson.html", "anki_vocab.tsv", "quiz.md"]}
