---
name: building-3d-html-presentations
description: Use when the user asks for a presentation, slides or a project deck as an HTML file with a 3D scene or 3D animation — «عرض HTML», «عرض ثلاثي الأبعاد», «عروض مع أنميشن 3D», «عرض تفاعليّ للمشروع», «زي عرض المحطّة», «نبغاه أيقوني» — for a student project, machine, plant, device or process; when an existing 3D HTML deck has parts passing through each other, looks cartoonish, or its text covers the model; or when such a deck must also become a .pptx.
---

# Building 3D HTML presentations

## Overview

The deck is **one offline HTML file. One 3D world stands behind every slide; a slide is a camera on that world plus
a text panel, and "next" is a 2.4 s flight to the next part.** A hero drop travels the route the slide talks about.
This is the format of the steam power plant deck that was asked to become «أيقوني».

**Core principle:** build the world once, as one model, and measure it. Nothing is accepted by eye alone: clashes
between the registered, static bodies by `check()`, text and callouts by `check.py`, repeatability by the seam of a
recorded loop. What moves is outside `check()`: derive it from geometry and look at it with `check.py --at`.

It fits a journey through something (water, energy, a signal, a product moving through a plant, a machine, a device,
a site) and a part shown alone in studio light and pulled apart. It is not an assembly manual
(`building-3d-assembly-guides`), not an interactive what-if (`simulating-a-device-idea-in-html`), and not a PowerPoint
that needs a few moving shapes (`animating-pptx-decks`).

Two worked examples run as they are (`docs/preview.jpg` shows the first): `example/`, a site with pipes plus a part
pulled apart in the studio, and `example-conveyor/`, a bench-top device whose solid parts travel. Start a deck by
copying the nearer one's `scene.js` and `slides.html` into `<project>/<deck>/` and rewriting them.

## Pipeline

| File | Job |
|---|---|
| `<deck>/scene.js` | The world, built through `STAGE`: constants, static parts, moving parts, pipes, flows, callouts, cameras. |
| `<deck>/slides.html` | The slides. `data-` attributes tell the stage what each one shows. |
| `<deck>/assets.js` | Optional pictures: `window.ASSETS = { img: { key: "data:…" } }`, used as `<img data-asset="key">`. |
| `python stl2models.py <deck> part.stl …` | Real parts (print files, Fusion exports) into `<deck>/models.js`; `STAGE.stl(key, { fit })` reads them. |
| `python build.py <deck> [--name File.html] [--desktop]` | One file, `<deck>/out/index.html` (and a named copy). Stops on a missing picture or a `</script` inside a script. |
| `python check.py <deck> [--at 2.0,3.9] [--only 4] [--live]` | Opens every slide in headless Chrome on the real GPU: pictures in `<deck>/shots/`, and a list of problems. `--at` photographs chosen seconds of the motion. |
| `engine/` | `mini3d.js` renderer, `stage.js`, `ctrl.js`, `deck.css`. Shared by every deck: fix a bug here, never in a copy. |
| `reference.md` | Every `STAGE` call, slide attribute, layout class, material, texture and light setting. |
| `recipes/` | The plant deck's whole scene as a library of realistic parts, with a line index in its README. |
| `to-powerpoint.md`, `pptx/` | The same deck as an editable .pptx, still or with the scene moving behind the text. |

## Order of work

1. **Story before geometry.** What travels (the hero), which 5 to 9 stations it passes, one sentence per station.
   Slides: cover, the whole thing, the stations, numbers on a dimmed scene, the key part in the studio, end.
2. **Constants first** in `scene.js`: every position and size by name. Ground is y = 0. Make a slide's subject 5 to 40
   units across; flange thickness and clash tolerance are absolute.
3. **Static parts through the batch** (`B.box`, `B.cyl`, `B.g`); give every big body a name, which registers it as a
   solid. **Moving parts** are their own nodes (`part`).
4. **Pipes and cables with `pipe()`**, naming the solids their ends may enter. Then `check()` must return 0 hits.
   Fix the route or the part. `allow(a, b)` is only for two registered bodies that are one object.
5. **Motion:** `flow`, `journey`, `emitter`, `glow`, and one `onFrame` per scene that uses only `c.spin`, `c.cycle`,
   `c.osc`, `c.ease`, `c.num`. Those repeat exactly in loop mode; `Math.random()`, `Date.now()` and `T * speed` do not.
   A solid thing that travels is a `part` placed from `c.cycle` every frame (reference: "Solid parts that travel").
6. **Cameras and callouts**, then the slides. Put the panel on the side away from the subject; `data-shift` slides
   the picture sideways so the subject sits in the free area, without changing the perspective.
7. `build.py`, `check.py`, **look at every picture**, fix, repeat; `--live` once at the end.

## What makes it read as real, not cartoon

- **Materials, not colours:** `metal`, `rough`, `grain`. A handful of muted hues; saturated colour only for safety
  items (yellow rail, red handwheel) and the flow pulses.
- **Nothing floats, nothing sinks:** plinth, baseplate, feet, footings, pipe supports (automatic with `support:`).
- **True small parts at the right size:** flanges with bolts, collars, handrails, a ladder, cables, a valve.
- **Show the working part:** half a casing in glass (the pump volute), a wall left open (the plant's boiler).
- **Light:** one warm key that casts shadows, a cool fill, the sky as the reflection. `ENV.dusk` outdoors,
  `ENV.studio` for a part on a plinth.
- **Physical motion:** shafts turn, pulses run downstream, speed follows the slide (`data-rpm`). Nothing bounces.
- **Real geometry when it exists:** the project's own STL files through `stl2models.py`, not a redrawn look-alike.
  Measure proportions on the files; do not guess them.

## Slide text

- Heading of at most 8 words with one `<em>`; then two short paragraphs of complete sentences, 25 to 60 words of
  body text. `check.py` counts everything on the slide, kicker and heading included, and objects above 75.
- Every number with its unit, checked by calculation or a source; formulas inside `<b class="nb">`.
- At most 5 callouts on a slide. One-character callouts ("1", "2") are numbered state points.
- Arabic: first line `<!-- deck: lang=ar dir=rtl -->`. Measured in HTML: letters stay joined, counter and formulas keep
  their direction. Wrap every number with a unit or a percent in `<span class="nb">`. System fonts only.

## Checks before delivering

| Check | Pass |
|---|---|
| `check.py` clash line | `-> 0 hits`, with the big bodies registered (0 solids proves nothing) |
| `check.py` slide table | no "off the screen", "wider than its box", "under #logo"; ms/frame under 16 |
| Callouts | each asked one is "shown", or you removed it on purpose ("under the text panel", "off the screen") |
| The pictures | subject clear of the panel, nothing floating or cut by the frame edge, text readable on its scrim |
| `--live` | every slide "ok": the camera arrives and the text finishes arriving |
| `--at` on slides where something happens | the pictures show the moment: the part pushed, the valve open, nothing passing through anything |

Then deliver: `build.py <deck> --name <Name>.html --desktop`. Never overwrite a file the user gave you: an improved
version of their deck goes beside it as `<Name>_v2.html`.
Say what was measured and what nobody watched: a live run on the presentation computer, other browsers.

## Common mistakes

- **Judging from the Browser pane while it is hidden.** A hidden page gets about one frame a second: stale or blank
  pictures. Use `check.py`, which advances frames by hand (`PRES3D.tick`). Headless `--screenshot` is blank for WebGL.
- **A rebuilt page that looks unchanged:** the browser cached it. Add `?v=N`.
- **`PRES3D.bench` before the first frame:** the canvas is still 300×150 and the number means nothing.
- **Moving the camera to make room for text.** Use `data-shift`.
- **Pulses hidden inside their pipe:** raise the flow's `bias` (it pulls the sprite toward the eye).
- **Callouts on parts that move or turn.** A callout is a fixed point.
- **One node per small part:** every node is a draw call. Batch what does not move.
- **Full metal in the studio:** it mirrors the dark room and goes black. `metal` 0.25 to 0.55 there.
- **A strip lying exactly in the face under it** flickers. Lift it 0.01.
- **Pipe-sized details on a bench-top device:** flanges, collars, pulses and the hero drop do not scale with your
  units (reference: "Conventions and sizes that do not scale").
- **Printing Arabic from a script on Windows:** the cp1252 console crashes on it. The bundled scripts reconfigure
  stdout to UTF-8; do the same in any new one.
- **Trusting numbers in a deck you were asked to improve.** Recalculate them; the plant deck's rejected heat was wrong.
