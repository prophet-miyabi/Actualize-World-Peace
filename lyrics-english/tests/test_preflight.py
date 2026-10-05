from lyriclearn.android import preflight
from lyriclearn.config import Config


class FakeAdb:
    def __init__(self, pkgs):
        self.pkgs = pkgs

    def check_connected(self):
        pass

    def shell(self, cmd, **kw):
        if cmd.startswith("pm list"):
            return self.pkgs
        if cmd.startswith("ls /system/bin/screenrecord"):
            return "/system/bin/screenrecord"
        if cmd == "wm size":
            return "Physical size: 1080x2400"
        return ""

    def screen_size(self):
        return 1080, 2400


def test_preflight_ok_and_missing_app():
    cfg = Config(backend="android")
    ok = preflight(cfg, FakeAdb(f"package:{cfg.music_pkg}"))
    assert all(o for o, _ in ok) and len(ok) == 4
    ng = preflight(cfg, FakeAdb(""))
    assert [m for o, m in ng if not o][0].startswith("YouTube Music アプリ なし")
