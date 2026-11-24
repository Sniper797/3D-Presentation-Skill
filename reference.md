# Reference: the stage, the slides and the engine

Everything here is what `engine/stage.js`, `engine/ctrl.js`, `engine/deck.css` and `engine/mini3d.js` do today.
`example/` (a site with pipes, and a part in the studio) and `example-conveyor/` (a bench-top device with solid
parts that travel) use almost all of it between them.

`scene.js` takes what it needs from one object: `const { G, M, T3, part, pipe, flow, label, cam, onFrame, … } = STAGE;`
It holds: `V M G Geo Path node smoothPath` (engine) · `TAU PI FLY T3 rs rnd alongX alongZ strut flangeGeo collarGeo` ·
`MAT plastic ENV` · `scene studio add part stl mesh Batch` · `sBox sCyl allow check` · `pipe rail flow journey emitter glow` ·
`label cam onFrame` · `PF PS PH` · `CAM LABELS SCENES S R`.

## scene.js: building the world (`window.STAGE`)

Coordinates: X to the right, Y up, Z toward the viewer; the ground is y = 0; angles in radians.

### Scenes

| Call | What it does |
|---|---|
| `scene(name, opt)` | Creates the scene or returns to it; everything added afterwards belongs to it. The first scene created is the default for slides. Returns `{ root, B }`. |
| `opt.env` | `ENV.dusk` (default: low warm sun, stars, fog) or `ENV.studio` (soft boxes, dark room). Change a copy: `Object.assign({}, ENV.dusk, { fogF: 300 })`. |
| `opt.period` | Seconds of the scene's looping video (default 9). Take 12 for slow things such as an exploded view. |
| `opt.shadow` | `(target, distance) => ({ c: [x, y, z], r })`: the region that receives shadows. Default: around the camera target, sized to the distance. |
| `opt.near`, `opt.far` | Camera planes (0.3, 1600). |
| `studio(name, opt)` | A ready room for a part shown alone: floor, a plinth edged in lit brass, a spotlight cone, shadows. Returns the scene; the plinth top is y = 1.2. `opt.r`: radius of a round plinth (2.9). `opt.long`: half-length of a long one with rounded ends, `opt.width` its half-width (1.8). `opt.plinth: false`: the floor alone, for your own table. `opt.reach`: radius that receives shadows (13). `opt.period` (12). |

### Static parts: the batch (`const B = scene(...).B`)

Everything of one material becomes a single mesh, so thousands of small boxes cost a handful of draw calls.

| Call | Notes |
|---|---|
| `B.box(mat, cx, cy, cz, w, h, d, sol, skip)` | Box by its centre. `sol`: a name registers it as a solid for `check()`. `skip`: faces to leave open, any of `f b l r t d`. |
| `B.cyl(mat, ax, cx, cy, cz, r1, r2, len, seg, sol, caps)` | Cylinder or cone. `ax`: 0 along X, 1 along Y, 2 along Z. `caps: false` leaves it open. |
| `B.g(mat, geo, matrix)` | Any geometry, placed by a matrix (`T3(x, y, z)`, `M.trs(pos, rot, scale)`, `M.align(point, direction)`). |

`mat` is a name in `MAT`. An unknown name throws at once.

### Moving parts

| Call | Notes |
|---|---|
| `part(mat, geo, { pos, rot, scl, parent })` | Its own node; `mat` is a `MAT` name or a material object. Returns the node. |
| node fields | Set them in `onFrame`: `pos`, `rot` (see Conventions), `scl` (a number or `[x, y, z]`), `visible` (`false` hides the node and its children), `dim` (0..1 darkens it and its children: 0.035 for the neighbour that is not on stage), `emis`, `par`. |
| `add(parent, {...})` | A bare node, for example an empty group to carry several parts (`{ pos }`), which is then passed as `parent`. |
| `stl(key, { fit, scale, zup })` | Geometry of a real part from `models.js` (packed by `stl2models.py`). `fit: 5` scales it to 5 units on its longest side, centred and standing on y = 0. CAD is Z-up and is turned to Y-up unless `zup: false`. |

### Geometry (`G`, from the engine)

`G.box(w, h, d, skip)`, `G.cyl(r1, r2, h, seg, caps)`, `G.sphere(r, seg)`, `G.torus(R, r, s1, s2)`,
`G.tubeRing(R, r, h, seg, a0, a1)` (a washer or a ring wall, optionally an arc),
`G.lathe(profile, seg, a0, a1)` (profile `[[radius, y], ...]` turned around Y; `[r, y, 1]` marks a hard edge; `a0..a1` an arc: half a casing),
`G.tube(path, r, seg, caps)` (a pipe along points; `r` may be a function of the point index: a tapering trunk),
`G.bounds(geo)` → `{ mn, mx, c, size }`, `G.xform(geo, matrix)`.
A `Geo` also takes hand-made faces: `geo.quad(a, b, c, d)`, `geo.tri(a, b, c)`, `geo.merge(other, matrix)` (returns itself).
Helpers: `alongX(geo)` / `alongZ(geo)` turn a Y-axis shape, `strut(a, b, width)` is a square bar between two points,
`flangeGeo(r)` a bolted flange, `collarGeo(r)` a pipe collar, `smoothPath(points, radius, samples)` rounds corners.

### Measured interference

| Call | Notes |
|---|---|
| `sBox(name, min, max)`, `sCyl(name, ax, centre, r, len)` | Register a solid by hand (a tilted table as its bounding box, a lathed tank as a cylinder). |
| `allow(a, b)` | These two registered solids may overlap: they are one object (wall and wall, shell and basin). Not a way to silence a real clash. |
| `check()` | `{ pipes, solids, pairs, hits }`. Every pipe against every solid and pipe, every solid against every solid, inside one scene. Points are pulled in by 0.06, so touching faces pass. |

### Pipes, cables, rails

`pipe(name, points, r, mat, opt)` draws a tube with rounded bends, bolted flanges at both ends and collars, registers
it for `check()`, and returns the smoothed points (give them to `flow`).

| `opt` | Meaning |
|---|---|
| `bend` | Bend radius (1.5). Use 0.35 for a cable. |
| `f0`, `f1` | `false`: no flange at the first / last point. |
| `collars` | Spacing of collars (9); `0` for none (cables). |
| `a0`, `a1` | Solids the first / last end may enter, within `end` (2.2) of that end: `a1: ["tank", "deck"]`. |
| `thru` | Solids it may pass through anywhere. |
| `join` | Pipes it may touch (a tee). |
| `support` | Spacing of automatic supports under its horizontal runs. They are placed when the deck starts, only where nothing else stands. |

`rail([[x, z], ...], y, mat)` puts a handrail along a line on a floor at height `y`.

### What moves

| Call | Notes |
|---|---|
| `flow(name, points, colour, v, bias, dens, opt)` | Glowing pulses along a path. `v` units per second, `bias` pulls the sprites toward the eye so they show in front of the pipe wall (0.7; 0.3 for thin cables), `dens` pulses per unit (0.4). `opt`: `size`, `alpha`, `on: (c) => 0..1`, `hero: [r, g, b]`. |
| `journey(key, [[flow, from, to], ...], { speed, size })` | The route of the hero drop on slides with `data-hero="key"`. `from`/`to` are 0..1 along each flow. `size: 1` suits pipes of radius 0.3 to 0.6 (the drop is drawn about 2.6 units across); take about 0.3 on a bench-top device. |
| `emitter(n, life, draw)` | `n` sprites that live `life` seconds and are born again. `draw(t, q, c)`: `t` is the age 0..1, `q` four random numbers fixed for one life. It adds the sprite itself: `PF.add(...)` for light, `PS.add(...)` for smoke, steam, dust. |
| `glow(point, colour, size, on)` | A soft light sprite; `on: (c) => 0..1` to blink or follow a slide value. |
| `PF.add(point, [r, g, b, a], size, bias)` | Additive sprites (light). `PS`: the same, alpha-blended (matter). |
| `onFrame((c) => {...})` | Runs every frame while this scene is shown. |

The frame context `c`. Use these, not your own clock: they are what makes a recorded loop repeat exactly.

| Member | Meaning |
|---|---|
| `c.num(key, default)` | A number from the slide: `data-rpm="0.8"` → `c.num("rpm", 0.6)`. `c.d` is the slide's whole dataset. |
| `c.ease(key, target, rate)` | A value that follows `target` smoothly from slide to slide. |
| `c.spin(key, w, min)` | An angle that keeps turning at `w` rad/s and grows without bound; the speed may change between slides without a jump. One key is one clock, however often it is read. In a recorded loop it makes a whole number of turns; `min: true` guarantees at least one (turntables). |
| `c.cycle(key, seconds)` | 0..1, once every `seconds`: the phase of a conveyor, a stroke, a sequence. In a recorded loop a whole number of cycles fit; make `seconds` the scene's `period` for exactly one. |
| `c.osc(w, phase)` | −1..1 at `w` rad/s. |
| `c.T`, `c.dt`, `c.LP`, `c.S` | Time, frame step, loop period (0 when not recording), the stage state. |

Random numbers: `rs()` (0..1) and `rnd(a, b)` are seeded, so every load looks the same. `build.py` warns about `Math.random()`.

### Solid parts that travel (cans on a belt, a carriage on a rail, a ball through a mechanism)

`flow` and `emitter` draw sprites. A solid thing that travels is a `part` whose place you compute from a phase:

```js
const track = new Path([[-10, 5, 0], [10, 5, 0]]);                       // or the points pipe() returned
const cans = [0, 1, 2, 3].map(() => part("red", G.cyl(1, 1, 2.5, 28)));
onFrame((c) => {
  const ph = c.cycle("belt", 9);                                          // 0..1 once per 9 s
  cans.forEach((n, i) => { const u = (ph + i / cans.length) % 1;        // each can a quarter of a cycle behind the last
    n.visible = u < 0.8;                                                 // gone until its next turn
    if (n.visible) n.pos = track.at(u / 0.8 * 0.9999); });               // Path.at(0..1) wraps at 1: stay just below it
});
```

- Compute the place from the phase every frame. Do not step it (`pos += v * dt`): stepped motion cannot be recorded as a loop or photographed at a chosen moment.
- What one part pushes, derive from the pusher's geometry, so the two cannot overlap. `check()` covers only the
  registered, static bodies: it knows nothing about parts that move. Look at the moments that matter with
  `check.py --only 4 --at 3.80,3.93,4.20`.
- `example-conveyor/scene.js` is the full case: six cans, an arm that sweeps the red ones off, tipping over an edge, falling and coming to rest.

### Cameras and callouts

Framing, at `fov: 40` on a 16:9 screen: at distance d from the target the picture is 1.29 d wide and 0.73 d high.
Beside a side panel the free width is about 60 %, so start with d = subject width / 0.75, the eye 20° to 35° above
the horizon, then correct from the pictures (a round takes seconds). `data-shift` moves the whole picture sideways by
that fraction of half the screen: 0.3 puts the target 15 % of the width right of centre.

`cam(name, { eye, target, fov })`, or `cam(name, (d) => ({...}))` when the view depends on slide data (`d.camz`).
The first camera defined in a scene is that scene's default.
`label(text, [x, y, z])` pins a callout to a fixed point. A one-character text is drawn as a numbered marker.
Callouts hide themselves under the text panel and at the screen edge, and push apart when they would touch;
`check.py` reports each one that was asked for and is not shown, with the reason.

### Materials

`MAT.name = { color, metal, rough, emis, alpha, tex, par, grain, cast }`. `color` is as seen (squared in the shader);
`metal` 0..1; `rough` 0.04..1; `emis` light of its own; `alpha` below 1 is glass; `grain: [strength, frequency]` adds
surface noise; `cast: false` casts no shadow.

Ready: ground sand apron asphalt paint water rock concrete · steel flange dark cast shell chrome brass copper alu ·
glass cladding motor · pWater pHot pWarm pCool (painted pipe) · yellow red white rubber pcb cell · lampOn wire ·
trunk frond · floor plinth trim (studio). `plastic([r, g, b], layerHeight)` is a 3D-printed part with layer lines.

| `tex` | Surface | `par` |
|---|---|---|
| 1 | cast concrete: pour lines, streaks | `[lift height]` |
| 2 | water with moving waves | `[wave strength]` |
| 3 | ribbed sheet cladding (walls only) | `[rib frequency, sheet height]` |
| 4 | 3D-print layer lines across Y | `[2π / layer height]` |
| 5 | wall with a grid of windows | `[cell width, floor height, top of windows, lit fraction 0..1]` |
| 6 | gravel, asphalt | |
| 7 | jointed paving | `[joint spacing]` |

In `ENV.studio` the room is dark, and a metal shows what it reflects: `metal` above about 0.6 turns near-black except
where a soft box catches it. For frames, cans and fasteners in the studio use `metal` 0.25 to 0.55, and keep full
metal for small bright accents (a shaft, a trim line).

### Light (`ENV` fields)

`light`, `lightC`: direction to and colour of the key light, the one that casts shadows. `light2`, `light2C`: the
fill. `sky`, `gnd`: ambient from above and below. `zen`, `hor`, `gndC`: the sky picture, which is also what metal
reflects. `glow`, `glowDir`: the bright patch on the horizon. `fogC`, `fogN`, `fogF`: fog colour, start, end.
`studio: 1` adds soft boxes to the reflection; `stars: 1`; `expo`: exposure.

### Conventions and sizes that do not scale

- **Rotation:** `rot: [rx, ry, rz]` in radians, right-handed (positive `rx` turns +Y toward +Z, `ry` turns +Z toward +X,
  `rz` turns +X toward +Y). When more than one is set, `rz` is applied first, then `rx`, then `ry`. Prefer one axis per node and nest nodes.
- **Shapes are centred on the origin.** `G.cyl(r1, r2, h)` stands along Y with `r1` at the bottom; `G.box` by its centre.
  Arcs (`a0`, `a1` of `lathe` and `tubeRing`) start at +X and turn toward +Z.
- **Absolute sizes**, whatever your scale: flange thickness 0.16 and collar 0.16 on every `pipe`; clash tolerance 0.05, with solids
  sampled 0.06 inside their faces; a pipe end may enter its `a0`/`a1` solids for 2.2 (`end`); flow pulses are drawn at size 0.62 (`size`), in scene units;
  the hero drop at 2.6 (`size: 1` in `journey`); supports and handrails are sized for units near a metre or half a metre.
  On a bench-top device (1 unit = 1 to 2 cm) pass `collars: 0, f0: false, f1: false`, a small `bend`, and small `size` values.
- **Two faces in the same plane flicker.** Lift a strip, a label plate or a paint mark 0.01 off the face it lies on.

## slides.html

The file may start with `<!-- deck: lang=ar dir=rtl -->`, `<title>`, `<meta name="author" content="…">`, a `<style>`
that redefines palette variables (`--gold`, `--gold2`, `--accent-rgb`, `--bg`, `--scrim-rgb`, `--serif`, `--sans`, …
all listed at the top of `deck.css`), and `<div id="logo"><div>two lines of text</div><img data-asset="key"></div>`.

### Slide attributes

| Attribute | Meaning |
|---|---|
| `data-scene` | Scene name (default: the first). A change of scene arrives with a short push-in, not a flight. |
| `data-cam` | Camera name (default: the scene's first). |
| `data-shift` | Lens shift −1..1: where the subject sits sideways. Default 0.3 beside a left panel, −0.3 beside a right one, 0 otherwise. The cover uses 0.5. |
| `data-dim` | 0..1: darkens the scene behind text and charts. At 0.9 or more the slide is a still in the video export. |
| `data-orbit` | Slow orbit in rad/s (0.003 to 0.006) for slides that stay up. |
| `data-labels` | Comma-separated callouts. |
| `data-hero` | Journey of the hero drop. |
| `data-chapter` | The running head. `data-notes`: speaker notes (they go into the .pptx). |
| anything else | Yours: `data-rpm`, `data-explode`, … read with `c.num`. |

### Layouts and parts (all in `deck.css`)

| Block | Use |
|---|---|
| `<section class="slide cover">` with `.bar-side` and `.cv` (`.cv-uni`, `.cv-rule`, `h1`, `.cv-sub`, `.cv-chip`, `.cv-fill`, `.cv-line`, `.cv-team`, `.cv-place`) | Report-style cover: organisation, title, course chip, submitted to / by. |
| `.panel.left`, `.panel.right` | The station slide: text beside the subject. |
| `.panel.bottom` with `.kick`, `h2` and `<div class="body">` | The whole-site slide: a wide scene above, text below. |
| `.full` | Text and charts over a dimmed scene (`data-dim="1"`). |
| `.titlecard` (`.k`, `h1` with a `<span>`, `.sub`, `.course`) | Title and closing slides. |
| `.prolog` | A few centred lines that arrive one by one. |

Inside them: `.kick` (small spaced line above the heading), `.proc` (a badge such as `1 → 2`), `h2` with `<em>`,
`p`, `ul`, `.cap` (small grey note), `.nb` (never break; in Arabic also keeps left-to-right order),
`.stats > .stat > .v + .l` (big numbers), `.barrow > .n + div > .bar[style="--w:20%"] + .v` (bar chart),
`.cards > .card` (three boxes; `.pr` / `.so` for problem / solution), `.steps`, `.photos > img[data-asset]`.
Add `class="a"` and `d1`…`d6` to make blocks arrive in order. In an inline SVG, `class="draw"` draws a stroke and
`class="pop"` pops a group in.

## In the browser console and in tests (`window.PRES3D`)

`check.py` options: `--only 3,5` (those slides), `--at 2.0,3.9` (extra pictures at those seconds of the loop),
`--live` (a second pass with flights and transitions), `--size 1280x720`, `--shots <folder>`. Give the deck first.

`check()`, `tick(n)` (advance n frames by hand), `bench(n)` (ms per frame; only after a frame has run),
`labels()` (why each callout is or is not shown), `info()`, `goSlide(i)` (global), `loop(seconds)` and
`renderAt(t, dt)` (loop mode, for recording), `S` (state), `R` (the renderer; `R.scale` is the resolution factor
that drops by itself on a weak GPU). `?capture` in the address removes every transition.
