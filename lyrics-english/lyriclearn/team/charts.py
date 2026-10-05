"""日本の人気曲チャートの取得(Apple Music の公開RSS。API キー不要)。"""
import json
import urllib.request

SOURCES = [
    ("Apple Music 日本 最も再生された曲",
     "https://rss.applemarketingtools.com/api/v2/jp/music/most-played/{n}/songs.json",
     lambda d: [{"title": r["name"], "artist": r["artistName"]} for r in d["feed"]["results"]]),
    ("iTunes 日本 トップソング",
     "https://itunes.apple.com/jp/rss/topsongs/limit={n}/json",
     lambda d: [{"title": e["im:name"]["label"], "artist": e["im:artist"]["label"]} for e in d["feed"]["entry"]]),
]


def get_json(url: str, timeout: int = 15) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 lyriclearn"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def japan_chart(limit: int = 50) -> dict:
    errors = []
    for name, url, parse in SOURCES:
        try:
            songs = parse(get_json(url.format(n=limit)))
            return {"source": name, "songs": [{"rank": i + 1, **s} for i, s in enumerate(songs)]}
        except Exception as e:
            errors.append(f"{name}: {type(e).__name__}: {e}")
    raise RuntimeError("チャートを取得できませんでした: " + " / ".join(errors))
