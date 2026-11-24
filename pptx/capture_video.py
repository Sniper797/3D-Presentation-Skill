"""Record the moving 3D scene of every slide of a built deck, for PowerPoint (or for any video use).

    python capture_video.py <deck folder> [slide numbers...] [--crf 26] [--text]

For every slide whose scene is visible it writes into <deck>/pptx/vid/:
    loop-NN.mp4   the scene in motion, a clip that repeats exactly (the frame after the last one equals frame 0)
    fly-NN.mp4    2.4 s: the camera flying in from the previous slide's view, ending on the first frame of the loop
    loop-NN.jpg, fly-NN.jpg   their first frames (poster pictures)
and videos.json. Slides with data-dim >= 0.9 stay still pictures: their scene is dimmed out anyway.
The loop length is the scene's `period` (STAGE.scene(name, {period})). With slide numbers, only those are recorded
and videos.json is left alone.

--text keeps the slide text, callouts and frame in the picture, writes into <deck>/video/ instead, and joins every
clip in slide order into <deck>/video/walkthrough.mp4: the deck as a film, to watch on a phone or to send.

The page is driven frame by frame in its loop mode (PRES3D.loop / PRES3D.renderAt), so the clip does not depend on
how fast this computer draws. Never wait on requestAnimationFrame here: headless Chrome gives about one per second.
`seam` in the report is the mean difference between frame 0 and the frame after the last one, in 8-bit levels:
it must be far below `frame-to-frame` (0.02 against 0.5 is typical); if it is not, something in scene.js does not
repeat (Math.random, a speed that is not passed through c.spin / c.osc / an emitter).
"""
import asyncio
import base64
import io
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
from PIL import Image, ImageChops, ImageStat

for _s in (sys.stdout, sys.stderr):                    # Arabic titles and folder names must not crash a cp1252 console
    _s.reconfigure(encoding="utf-8", errors="replace")

argv = sys.argv[1:]
CRF = "26"
if "--crf" in argv:
    CRF = argv[argv.index("--crf") + 1]
    del argv[argv.index("--crf"):argv.index("--crf") + 2]
TEXT = "--text" in argv
if TEXT:
    argv.remove("--text")
if not argv:
    sys.exit(__doc__)
DECK = pathlib.Path(argv[0]).resolve()
PAGE = DECK / "out" / "index.html"
OUT = DECK / "video" if TEXT else DECK / "pptx" / "vid"
OUT.mkdir(parents=True, exist_ok=True)
ONLY = [int(a) for a in argv[1:]]
W, H, FPS, FLY = 1920, 1080, 30, 2.4                      # FLY must equal STAGE.FLY
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
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


def encoder(path):
    """H.264 in an MP4 that PowerPoint plays everywhere: yuv420p, BT.709, video range, no audio."""
    return subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", str(FPS), "-c:v", "mjpeg", "-i", "-",
                             "-vf", "scale=in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuv420p",
                             "-c:v", "libx264", "-preset", "slow", "-crf", CRF, "-g", str(FPS), "-profile:v", "high", "-level", "4.1",
                             "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                             "-movflags", "+faststart", "-an", str(path)], stdin=subprocess.PIPE)


def diff(a, b):
    """Mean absolute difference of two JPEG frames, in 8-bit levels."""
    ia, ib = Image.open(io.BytesIO(a)).convert("RGB"), Image.open(io.BytesIO(b)).convert("RGB")
    return sum(ImageStat.Stat(ImageChops.difference(ia, ib)).mean) / 3


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

        async def frame(t):
            """Draw the scene at time t (one frame after the previous one) and return it as JPEG bytes."""
            await js("PRES3D.renderAt(%.6f, %.6f); 1" % (t, 1 / FPS))
            r = await call("Page.captureScreenshot", format="jpeg", quality=93, optimizeForSpeed=True)
            return base64.b64decode(r["data"])

        await call("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=1, mobile=False)
        await call("Page.enable")
        await call("Page.navigate", url=PAGE.as_uri() + "?capture&t=%d#1" % time.time())
        for _ in range(120):
            await asyncio.sleep(0.5)
            if await js("!!(window.PRES3D && window.PRES3D.renderAt && window.goSlide && PRES3D.S.scene)"):
                break
        await js("(() => { const s = document.createElement('style'); s.textContent = %s; document.head.appendChild(s); if (%s) document.body.classList.add('bgonly'); })()" % (json.dumps(HIDE), 'false' if TEXT else 'true'))
        await js("PRES3D.tick(4); 1")
        count = await js("document.querySelectorAll('.slide').length")
        # what every slide shows: scene, camera, lens shift, dimming, loop length
        cfg = []
        for i in range(count):
            cfg.append(json.loads(await js("window.__CUT = true; goSlide(%d); JSON.stringify({ scene: PRES3D.S.scene, cam: PRES3D.S.cam, shift: PRES3D.S.shift, dim: PRES3D.S.dim, period: PRES3D.S.period })" % i)))
        plan = []
        for i, c in enumerate(cfg):
            if c["dim"] >= 0.9:
                continue                                    # text-and-chart slide: the scene is dimmed out
            prev = cfg[i - 1] if i else None
            fly = bool(prev) and prev["scene"] == c["scene"] and (prev["cam"] != c["cam"] or abs(prev["shift"] - c["shift"]) > 1e-6)
            plan.append({"n": i + 1, "scene": c["scene"], "period": int(c["period"]), "fly": fly})
        if ONLY:
            plan = [p for p in plan if p["n"] in ONLY]
        print("renderer:", await js("(() => { const gl = PRES3D.R.gl, d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; })()"))
        print("slides with video:", [p["n"] for p in plan], "| flights:", [p["n"] for p in plan if p["fly"]])
        t0 = time.time()
        done = []
        for p in plan:
            i, P = p["n"] - 1, p["period"]
            tag = f"{p['n']:02d}"
            if p["fly"]:
                await js("window.__CUT = true; goSlide(%d); PRES3D.loop(%d); 1" % (i - 1, P))
                for k in range(36):                         # let the previous slide settle in loop mode
                    await js("PRES3D.renderAt(%.6f, %.6f); 1" % (-FLY - (36 - k) / FPS, 1 / FPS))
                await js("window.__CUT = false; goSlide(%d); 1" % i)
                enc = encoder(OUT / f"fly-{tag}.mp4")
                nfly = round(FLY * FPS)
                for k in range(1, nfly + 1):
                    f = await frame(-FLY + k / FPS)
                    if k == 1:
                        (OUT / f"fly-{tag}.jpg").write_bytes(f)
                    enc.stdin.write(f)
                enc.stdin.close()
                enc.wait()
            else:
                await js("window.__CUT = true; goSlide(%d); PRES3D.loop(%d); 1" % (i, P))
                for k in range(45):
                    await js("PRES3D.renderAt(%.6f, %.6f); 1" % (-1.5 + k / FPS, 1 / FPS))
            enc = encoder(OUT / f"loop-{tag}.mp4")
            first = None
            step = 0.0
            for k in range(P * FPS):
                f = await frame(k / FPS)
                if k == 0:
                    first = f
                    (OUT / f"loop-{tag}.jpg").write_bytes(f)
                if k == 1:
                    step = diff(first, f)
                enc.stdin.write(f)
            enc.stdin.close()
            enc.wait()
            wrap = await frame(P)                           # the frame that follows the last one: it must be frame 0 again
            p["seam"] = round(diff(first, wrap), 3)
            p["step"] = round(step, 3)
            p["loop"] = f"loop-{tag}.mp4"
            p["loop_bytes"] = (OUT / p["loop"]).stat().st_size
            if p["fly"]:
                p["flyfile"] = f"fly-{tag}.mp4"
                p["fly_bytes"] = (OUT / p["flyfile"]).stat().st_size
            done.append(p)
            print(f"{tag} {p['scene']:<6} {P:>2}s loop {p['loop_bytes'] / 1e6:5.2f} MB" + (f"  fly {p['fly_bytes'] / 1e6:4.2f} MB" if p["fly"] else "  (no flight)   ")
                  + f"  frame-to-frame {p['step']:.3f}  seam {p['seam']:.3f}" + ("   <-- DOES NOT REPEAT" if p["seam"] > max(0.05, 0.3 * p["step"]) else "") + f"  t={time.time() - t0:5.0f}s", flush=True)
            await js("PRES3D.loop(0); 1")
        if not ONLY:
            (OUT / "videos.json").write_text(json.dumps({"fps": FPS, "fly_seconds": FLY, "slides": done}, indent=1), encoding="utf-8")
        total = sum(p["loop_bytes"] + p.get("fly_bytes", 0) for p in done)
        secs = sum(p["period"] + (FLY if p["fly"] else 0) for p in done)
        print(f"saved {len(done)} loops, {sum(1 for p in done if p['fly'])} flights, {secs:.0f} s of video, {total / 1e6:.1f} MB in {time.time() - t0:.0f} s -> {OUT}")
        if TEXT and done:                                   # one film: every flight followed by its loop, in slide order (same codec settings, so no re-encode)
            parts = [name for p in done for name in ([p["flyfile"]] if p["fly"] else []) + [p["loop"]]]
            (OUT / "parts.txt").write_text("".join(f"file '{n}'\n" for n in parts), encoding="utf-8")
            film = OUT / "walkthrough.mp4"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "parts.txt", "-c", "copy", "-movflags", "+faststart", film.name], cwd=OUT, check=True)
            print(f"{film}  {film.stat().st_size / 1e6:.1f} MB  {secs:.0f} s")


profile = pathlib.Path(tempfile.mkdtemp(prefix="deck-vid-"))
port = free_port()
proc = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
                         "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                         "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
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
