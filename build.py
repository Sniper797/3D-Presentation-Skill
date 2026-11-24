"""Build a 3D deck into one offline HTML file.

    python build.py <deck folder> [--name File.html] [--desktop]

<deck>/slides.html   the slides: <section class="slide" ...> blocks. It may start with
                         <!-- deck: lang=en dir=ltr -->
                         <title>...</title>, <meta name="author" content="...">
                         <style> palette overrides </style>
                         <div id="logo">...</div>          (the corner mark)
<deck>/scene.js      the 3D world, built through STAGE (engine/stage.js)
<deck>/assets.js     optional: window.ASSETS = { img: { "key": "data:image/png;base64,..." } }
<deck>/models.js     optional: real parts packed from STL files by stl2models.py

-> <deck>/out/index.html always (check.py opens that one), a copy under --name beside it, and with --desktop that
   copy on the Desktop as well.
The engine is read from the folder of this script, so a rebuilt deck picks up engine fixes.
"""
import re
import shutil
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):                    # Arabic titles and folder names must not crash a cp1252 console
    _s.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).parent
ENGINE = HERE / "engine"


def fail(msg):
    print("ERROR:", msg)
    sys.exit(1)


argv = sys.argv[1:]
name = "index.html"
if "--name" in argv:
    name = argv[argv.index("--name") + 1]
    del argv[argv.index("--name"):argv.index("--name") + 2]
args = [a for a in argv if not a.startswith("--")]
if not args:
    fail("usage: python build.py <deck folder> [--name File.html] [--desktop]")
deck = Path(args[0]).resolve()
if not (deck / "slides.html").exists() or not (deck / "scene.js").exists():
    fail(f"{deck} needs slides.html and scene.js")

slides = (deck / "slides.html").read_text(encoding="utf-8")
scene = (deck / "scene.js").read_text(encoding="utf-8")
assets = (deck / "assets.js").read_text(encoding="utf-8") if (deck / "assets.js").exists() else "window.ASSETS = { img: {} };"
models = (deck / "models.js").read_text(encoding="utf-8") if (deck / "models.js").exists() else ""

# head matter that slides.html may carry
m = re.search(r"<!--\s*deck:(.*?)-->", slides)
opts = dict(re.findall(r"(\w+)=([\w-]+)", m.group(1))) if m else {}
lang, direction = opts.get("lang", "en"), opts.get("dir", "ltr")
head = []
for pat in (r"<title>.*?</title>", r"<meta\b[^>]*>", r"<style>.*?</style>"):
    for block in re.findall(pat, slides, flags=re.S):
        head.append(block)
        slides = slides.replace(block, "", 1)
if not any(h.startswith("<title>") for h in head):
    head.insert(0, f"<title>{deck.name}</title>")

# mistakes that are cheaper to catch here than in the browser
for label, text in (("scene.js", scene), ("assets.js", assets), ("models.js", models)):
    if "</script" in text.lower():
        fail(f"{label} contains </script, which would end the inline script early")
keys = set(re.findall(r'data-asset="([^"]+)"', slides))
missing = sorted(k for k in keys if f'"{k}"' not in assets)
if missing:
    fail(f"slides.html uses pictures that assets.js does not have: {missing}")
count = len(re.findall(r'<section class="slide\b', slides))
if not count:
    fail('no <section class="slide"> in slides.html')
if "Math.random(" in scene:
    print("WARNING: scene.js calls Math.random(); use STAGE.rs() / STAGE.rnd(a, b) so that every load and every loop looks the same")

hint = "&larr; &rarr; للتنقّل &middot; F لملء الشاشة" if direction == "rtl" else "&larr; &rarr; to navigate &middot; F for full screen"
read = lambda f: (ENGINE / f).read_text(encoding="utf-8")
html = f"""<!doctype html>
<html lang="{lang}" dir="{direction}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
{read("deck.css")}</style>
{chr(10).join(head)}
</head>
<body>
<canvas id="gl"></canvas>
<div id="dim"></div>
<div id="vignette"></div>
<div id="labels"></div>
<div id="chap"></div>
{slides.strip()}
<div id="prog"></div><div id="count"></div><div id="hint">{hint}</div>
<script>{read("mini3d.js")}</script>
<script>{assets}</script>
<script>{models}</script>
<script>{read("stage.js")}</script>
<script>{scene}</script>
<script>{read("ctrl.js")}</script>
</body>
</html>
"""
out = deck / "out"
out.mkdir(exist_ok=True)
(out / "index.html").write_text(html, encoding="utf-8", newline="\n")
target = out / name
target.write_text(html, encoding="utf-8", newline="\n")
print(f"{target}  {target.stat().st_size:,} bytes  slides={count}  lang={lang} dir={direction}")
if "--desktop" in sys.argv:
    desk = Path.home() / "Desktop" / name
    if name == "index.html":
        fail("--desktop needs --name <File.html> (index.html on the Desktop says nothing)")
    shutil.copyfile(target, desk)
    print(f"{desk}  {desk.stat().st_size:,} bytes")
