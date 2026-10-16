"""解説担当の分析(analysis.json)を、読みやすい HTML / Markdown にする。"""
import html
from pathlib import Path


def render_explanation(project) -> dict:
    a, esc = project.analysis, html.escape
    out = project.dir / "explanation"
    out.mkdir(exist_ok=True)
    md = [f"# {project.artist} — {project.title}\n", "## 概要\n", a.get("overview_ja", ""), ""]
    if a.get("themes_ja"):
        md += ["## テーマ\n"] + [f"- {t}" for t in a["themes_ja"]] + [""]
    if a.get("background_ja"):
        md += ["## 背景・文化\n", a["background_ja"], ""]
    md += ["## 歌詞と和訳・解説\n"]
    sec = None
    for i, ln in enumerate(a["lines"]):
        if ln.get("section") and ln["section"] != sec:
            sec = ln["section"]
            md.append(f"\n### {sec}\n")
        md.append(f"{i + 1}. **{ln['en']}**  \n   {ln['ja']}" + (f"  \n   > 💡 {ln['note_ja']}" if ln.get("note_ja") else ""))
    (out / "explanation.md").write_text("\n".join(md) + "\n")

    rows = []
    for i, ln in enumerate(a["lines"]):
        rows.append(f"<tr><td>{i + 1}</td><td><b>{esc(ln['en'])}</b><br><span class=ja>{esc(ln['ja'])}</span>"
                    + (f"<div class=note>💡 {esc(ln['note_ja'])}</div>" if ln.get("note_ja") else "") + "</td></tr>")
    themes = "".join(f"<li>{esc(t)}</li>" for t in a.get("themes_ja", []))
    (out / "explanation.html").write_text(
        "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{esc(project.title)}</title><style>body{{font-family:sans-serif;max-width:760px;margin:auto;padding:12px;line-height:1.6}}"
        ".ja{color:#b8860b}.note{color:#555;font-size:.9em;margin-top:2px}td{padding:6px 8px;border-bottom:1px solid #ddd;vertical-align:top}</style>"
        f"<h1>{esc(project.artist)} — {esc(project.title)}</h1><h2>概要</h2><p>{esc(a.get('overview_ja', ''))}</p>"
        + (f"<h2>テーマ</h2><ul>{themes}</ul>" if themes else "")
        + (f"<h2>背景・文化</h2><p>{esc(a['background_ja'])}</p>" if a.get("background_ja") else "")
        + f"<h2>歌詞と和訳・解説</h2><table>{''.join(rows)}</table>")
    return {"dir": str(out), "files": ["explanation.html", "explanation.md"]}
