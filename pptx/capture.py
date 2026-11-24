"""Capture every slide of a built 3D deck for the PowerPoint build.

    python capture.py <deck folder>

For each slide it writes into <deck>/pptx/cap/:
    bg-NN.jpg    the 3D scene with its scrims, and nothing that PowerPoint will draw itself
    ref-NN.jpg   the slide as the browser shows it (the reference for visual comparison)
and layout.json with every text block, box, curve, picture and callout, measured in CSS pixels.

Headless Chrome is driven over DevTools because `--screenshot` returns a blank picture for WebGL, and frames are
advanced by hand (PRES3D.tick) because a hidden page gets about one animation frame per second.
"""
import asyncio
import base64
import json
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

import websockets

for _s in (sys.stdout, sys.stderr):                    # Arabic titles and folder names must not crash a cp1252 console
    _s.reconfigure(encoding="utf-8", errors="replace")

if len(sys.argv) < 2:
    sys.exit(__doc__)
HERE = pathlib.Path(__file__).parent
DECK = pathlib.Path(sys.argv[1]).resolve()
PAGE = DECK / "out" / "index.html"
OUT = DECK / "pptx" / "cap"
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1920, 1080
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
EXTRACT = (HERE / "extract.js").read_text(encoding="utf-8")
# PowerPoint breaks lines greedily, so the page must too while it is measured; bgonly hides what PowerPoint draws itself
HIDE = """
h1, h2, h3, p, li, .sub { text-wrap: wrap !important; }
body.bgonly #labels, body.bgonly #chap, body.bgonly #logo, body.bgonly #count, body.bgonly #prog, body.bgonly #hint { visibility: hidden !important; }
body.bgonly .slide .panel > *, body.bgonly .slide .full, body.bgonly .slide .prolog, body.bgonly .slide .titlecard > *,
body.bgonly .slide .cv, body.bgonly .slide .bar-side { visibility: hidden !important; }
"""


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def main(port):
    tabs = None
    for _ in range(80):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
            break
        except Exception:
            time.sleep(0.25)
    ws_url = next(t["webSocketDebuggerUrl"] for t in tabs if t["type"] == "page")
    async with websockets.connect(ws_url, max_size=200_000_000) as ws:
        n = 0

        async def call(method, **params):
            nonlocal n
            n += 1
            await ws.send(json.dumps({"id": n, "method": method, "params": params}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == n:
                    if "error" in msg:
                        raise RuntimeError(f"{method}: {msg['error']}")
                    return msg.get("result", {})

        async def js(expr, wait=False):
            r = await call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=wait)
            if "exceptionDetails" in r:
                raise RuntimeError(json.dumps(r["exceptionDetails"])[:600])
            return r["result"].get("value")

        await call("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=1, mobile=False)
        await call("Page.enable")
        await call("Page.navigate", url=PAGE.as_uri() + "?capture&t=%d#1" % time.time())
        for _ in range(120):
            await asyncio.sleep(0.5)
            if await js("!!(window.PRES3D && window.goSlide && PRES3D.S.scene)"):
                break
        await js("(() => { const s = document.createElement('style'); s.textContent = %s; document.head.appendChild(s); })()" % json.dumps(HIDE))
        await js("PRES3D.tick(4); 1")
        info = await js("(() => { const gl = PRES3D.R.gl, d = gl.getExtension('WEBGL_debug_renderer_info'); return JSON.stringify({ renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?', canvas: PRES3D.R.canvas.width + 'x' + PRES3D.R.canvas.height, slides: document.querySelectorAll('.slide').length, shadows: PRES3D.R.shOk }); })()")
        print("page:", info)
        count = json.loads(info)["slides"]
        slides = []
        for i in range(count):
            await js(f"PRES3D.setT(0.3); goSlide({i}); PRES3D.tick(8); 1")
            data = json.loads(await js(EXTRACT))
            ref = await call("Page.captureScreenshot", format="jpeg", quality=82)
            (OUT / f"ref-{i + 1:02d}.jpg").write_bytes(base64.b64decode(ref["data"]))
            await js("document.body.classList.add('bgonly'); PRES3D.setT(0.3); PRES3D.tick(1); 1")
            bg = await call("Page.captureScreenshot", format="jpeg", quality=93)
            (OUT / f"bg-{i + 1:02d}.jpg").write_bytes(base64.b64decode(bg["data"]))
            await js("document.body.classList.remove('bgonly'); 1")
            data["n"] = i + 1
            slides.append(data)
            kinds = {}
            for it in data["items"]:
                kinds[it["t"]] = kinds.get(it["t"], 0) + 1
            print(f"{i + 1:02d} {data['panel']:<14} {kinds}")
        (OUT / "layout.json").write_text(json.dumps({"w": W, "h": H, "slides": slides}, ensure_ascii=False, indent=1), encoding="utf-8")
        print("saved", len(slides), "slides ->", OUT)


profile = pathlib.Path(tempfile.mkdtemp(prefix="deck-cap-"))
port = free_port()
proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
                         "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                         "--allow-file-access-from-files", f"--window-size={W},{H}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    asyncio.run(main(port))
finally:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        pass
    shutil.rmtree(profile, ignore_errors=True)
