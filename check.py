"""Measure a built 3D deck instead of looking at it: every slide is opened in headless Chrome on the real GPU.

    python check.py <deck folder | built .html> [--at 2.0,3.9] [--only 3,5] [--size 1920x1080] [--shots <folder>] [--live]

--at takes extra pictures at chosen seconds of the scene's loop (NN-at-03.90.jpg): the way to see a moment of the
motion, such as a part being pushed, which the one picture per slide cannot show. Use it with --only.

--live adds a second pass with flights and transitions running (about 4 s per slide); put it last on the line.
Writes <deck>/shots/NN.jpg (one picture per slide) and prints, then exits 1 if anything failed:
    * JavaScript errors and console errors (unknown camera, label, scene, material, picture ...)
    * interference: PRES3D.check() -> every pipe and solid against every other; hits must be 0
    * per slide: text that leaves the screen or its box, callouts that were asked for but cannot be shown and why,
      the number of words, and the milliseconds one frame takes

No server is needed: the deck is one file. Headless Chrome is driven over DevTools because `--screenshot` gives
a blank picture for WebGL, and the frames are advanced by hand (PRES3D.tick) because a hidden page gets about
one animation frame per second.
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

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
opt = {sys.argv[i][2:]: sys.argv[i + 1] for i in range(1, len(sys.argv) - 1) if sys.argv[i].startswith("--")}
if not args:
    sys.exit(__doc__)
src = pathlib.Path(args[0]).resolve()
page = src if src.suffix == ".html" else src / "out" / "index.html"
if not page.exists():
    sys.exit(f"{page} not found: run build.py first")
deck = page.parent.parent
shots = pathlib.Path(opt["shots"]).resolve() if "shots" in opt else deck / "shots"
shots.mkdir(parents=True, exist_ok=True)
W, H = (int(v) for v in opt.get("size", "1920x1080").split("x"))
ONLY = [int(v) for v in opt["only"].split(",")] if "only" in opt else []
LIVE = "--live" in sys.argv
AT = [float(v) for v in opt["at"].split(",")] if "at" in opt else []

MEASURE = r"""
(() => {
  const s = document.querySelector('.slide.on'), W = innerWidth, H = innerHeight, out = { clipped: [], words: 0, panel: null };
  const txt = (e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
  s.querySelectorAll('h1, h2, h3, h4, p, li, td, .kick, .sub, .proc, .k, .course, .cap, .cv-chip, .cv-place, .stat .v, .stat .l, .barrow > *, .card, svg').forEach((e) => {
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return;
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.clipped.push('off the screen: "' + txt(e) + '"');
    else if (e.scrollWidth > e.clientWidth + 2 && getComputedStyle(e).display !== 'inline') out.clipped.push('wider than its box: "' + txt(e) + '"');
  });
  const chrome = ['chap', 'logo', 'count'].map((id) => document.getElementById(id)).filter((e) => e && +getComputedStyle(e).opacity > 0.1 && e.textContent.trim()).map((e) => [e.id, e.getBoundingClientRect()]);
  s.querySelectorAll('h1, h2, p, .kick, .stats, .cards, svg').forEach((e) => { const r = e.getBoundingClientRect(); if (!r.width) return;
    chrome.forEach(([id, c]) => { if (r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top) out.clipped.push('under #' + id + ': "' + txt(e) + '"'); }); });
  const p = s.querySelector('.panel, .full, .cv, .titlecard, .prolog'); if (p) { const r = p.getBoundingClientRect(); out.panel = Math.round(r.height / H * 100); }
  const clone = s.cloneNode(true); clone.querySelectorAll('svg').forEach((e) => e.remove());
  out.words = (clone.textContent.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,%-]*/gu) || []).length;
  out.labels = PRES3D.labels(); out.scene = PRES3D.S.scene; out.title = txt(s.querySelector('h1, h2') || s);
  return JSON.stringify(out);
})()
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
    problems, events = [], []
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
                m, p = msg.get("method"), msg.get("params", {})
                if m == "Runtime.exceptionThrown":
                    d = p["exceptionDetails"]
                    events.append("exception: " + (d.get("exception", {}).get("description") or d.get("text", ""))[:300])
                elif m == "Runtime.consoleAPICalled" and p.get("type") in ("error", "warning"):
                    events.append(p["type"] + ": " + " ".join(str(a.get("value", a.get("description", ""))) for a in p.get("args", []))[:300])
                elif m == "Log.entryAdded" and p["entry"].get("level") == "error":
                    events.append("log: " + p["entry"].get("text", "")[:300])

        async def js(expr, wait=False):
            r = await call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=wait)
            if "exceptionDetails" in r:
                d = r["exceptionDetails"]
                raise RuntimeError((d.get("exception", {}).get("description") or d.get("text", ""))[:400])
            return r["result"].get("value")

        await call("Emulation.setDeviceMetricsOverride", width=W, height=H, deviceScaleFactor=1, mobile=False)
        await call("Runtime.enable")
        await call("Log.enable")
        await call("Page.enable")
        await call("Page.navigate", url=page.as_uri() + "?capture&t=%d#1" % time.time())
        ready = False
        for _ in range(60):
            await asyncio.sleep(0.5)
            if await js("!!(window.PRES3D && window.goSlide && PRES3D.S.scene)"):
                ready = True
                break
        if not ready:
            print("the page did not start:")
            for e in events:
                print("   ", e)
            return 1
        await js("PRES3D.tick(3); 1")
        info = json.loads(await js("(() => { const gl = PRES3D.R.gl, d = gl.getExtension('WEBGL_debug_renderer_info'); return JSON.stringify(Object.assign(PRES3D.info(), { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?', canvas: PRES3D.R.canvas.width + 'x' + PRES3D.R.canvas.height, shadows: PRES3D.R.shOk, slides: document.querySelectorAll('.slide').length })); })()"))
        print(f"page      {page}  ({page.stat().st_size:,} bytes)")
        print(f"renderer  {info['renderer']}")
        print(f"canvas    {info['canvas']}  shadows={'yes' if info['shadows'] else 'NO'}  slides={info['slides']}  scenes={info['scenes']}  cameras={len(info['cams'])}  labels={len(info['labels'])}")
        if "SwiftShader" in info["renderer"] or "llvmpipe" in info["renderer"]:
            print("          (software renderer: the ms/frame figures below say nothing about a real screen)")
        chk = json.loads(await js("JSON.stringify(PRES3D.check())"))
        print(f"clash     {chk['pipes']} pipes, {chk['solids']} solids, {chk['pairs']} pairs -> {len(chk['hits'])} hits")
        for h in chk["hits"]:
            print("    HIT", h)
            problems.append("interference: " + h)
        if not chk["solids"]:
            print("          (nothing is registered: give the big parts a name in B.box / B.cyl, or the check proves nothing)")
        print()
        print(" n  scene  ms/frame  box%  words  text and callouts")
        for i in range(info["slides"]):
            if ONLY and i + 1 not in ONLY:
                continue
            before = len(events)
            await js(f"PRES3D.setT(0.3); goSlide({i}); PRES3D.tick(8); 1")
            m = json.loads(await js(MEASURE))
            ms = await js("PRES3D.bench(30)")
            await js("PRES3D.tick(1); 1")
            shot = await call("Page.captureScreenshot", format="jpeg", quality=86)
            (shots / f"{i + 1:02d}.jpg").write_bytes(base64.b64decode(shot["data"]))
            for t in AT:                                      # loop mode makes every motion a function of time, so a moment can be asked for
                await js("PRES3D.loop(PRES3D.S.period); PRES3D.renderAt(%.4f, %.6f); 1" % (t, 1 / 30))
                shot = await call("Page.captureScreenshot", format="jpeg", quality=86)
                (shots / f"{i + 1:02d}-at-{t:05.2f}.jpg").write_bytes(base64.b64decode(shot["data"]))
            if AT:
                await js("PRES3D.loop(0); PRES3D.tick(1); 1")
            notes = list(m["clipped"])
            hidden = [f"{k} ({v})" for k, v in m["labels"].items() if v != "shown"]
            if hidden:
                notes.append("callouts not shown: " + ", ".join(hidden))
            notes += events[before:]
            if m["words"] > 75:
                notes.append(f"{m['words']} words on the slide (kicker, heading and text): it is read in a glance, keep it under 75")
            for t in notes:
                problems.append(f"slide {i + 1}: {t}")
            shown = sum(1 for v in m["labels"].values() if v == "shown")
            print(f"{i + 1:2d}  {m['scene']:<6} {ms:7.1f}  {m['panel'] or 0:4d}  {m['words']:5d}  {m['title']}" + (f"  [{shown} callouts]" if m["labels"] else ""))
            for t in notes:
                print("      !", t)
        if LIVE:
            # the deck as an audience sees it: no ?capture, so camera flights, eased values and text transitions really run
            print()
            print("live pass (flights and transitions on): pictures live-NN.jpg, taken 1.2 s into each flight and after it")
            await call("Page.navigate", url=page.as_uri() + "?t=%d#1" % time.time())
            for _ in range(60):
                await asyncio.sleep(0.5)
                if await js("!!(window.PRES3D && window.goSlide && PRES3D.S.scene)"):
                    break
            for i in range(info["slides"]):
                if ONLY and i + 1 not in ONLY:
                    continue
                before = len(events)
                await js(f"goSlide({i}); PRES3D.tick(72); 1")
                mid = await call("Page.captureScreenshot", format="jpeg", quality=80)
                (shots / f"live-{i + 1:02d}-flight.jpg").write_bytes(base64.b64decode(mid["data"]))
                await js("PRES3D.tick(110); 1")
                await asyncio.sleep(3.2)                      # the text of a slide arrives in steps, the last after about 3 s
                await js("PRES3D.tick(2); 1")
                end = await call("Page.captureScreenshot", format="jpeg", quality=86)
                (shots / f"live-{i + 1:02d}.jpg").write_bytes(base64.b64decode(end["data"]))
                st = json.loads(await js("JSON.stringify({ l: PRES3D.labels(), a: [...document.querySelectorAll('.slide.on .a')].filter((e) => +getComputedStyle(e).opacity < 0.95).length, t: PRES3D.S.camT })"))
                notes = [f"{k} ({v})" for k, v in st["l"].items() if v != "shown"]
                notes = (["callouts not shown: " + ", ".join(notes)] if notes else []) + ([f"{st['a']} text blocks have not finished arriving"] if st["a"] else []) + ([] if st["t"] >= 1 else ["the camera has not arrived"]) + events[before:]
                print(f"{i + 1:2d}  live  " + ("ok" if not notes else "; ".join(notes)))
                for t in notes:
                    problems.append(f"slide {i + 1} (live): {t}")
        early = [e for e in events if not any(e in p for p in problems)]
        for e in early:
            problems.append(e)
        print()
        if problems:
            print(f"{len(problems)} problem(s):")
            for p in problems:
                print("  -", p)
        else:
            print("no problems found")
        print(f"pictures  {shots}")
        return 1 if problems else 0


profile = pathlib.Path(tempfile.mkdtemp(prefix="deck-check-"))
port = free_port()
proc = subprocess.Popen([opt.get("chrome", CHROME), "--headless=new", f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
                         "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                         "--allow-file-access-from-files", f"--window-size={W},{H}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    code = asyncio.run(main(port))
finally:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        pass
    shutil.rmtree(profile, ignore_errors=True)
sys.exit(code)
