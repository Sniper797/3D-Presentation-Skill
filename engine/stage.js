/* stage.js: the reusable half of a 3D deck.
   One world stands behind every slide, and a slide is a camera on it. What touches is measured (check), and every
   motion can be made to repeat exactly (loop mode), so that a slide can be recorded as a looping video.
   A deck's scene.js builds its world through window.STAGE; ctrl.js drives it through window.PRES3D.
   Units: the ground is y = 0; make the subject of a slide 5 to 40 units across (near plane 0.3, shadows from 16 units). */
(function () {
  "use strict";
  const { V, M, G, Geo, Renderer, Particles, Path, node, easeIO, smoothPath } = M3D;
  const canvas = document.getElementById("gl");
  const R = new Renderer(canvas, { preserve: true });
  const TAU = Math.PI * 2, PI = Math.PI, FLY = 2.4;                 // FLY: seconds of a camera flight between two slides
  const mesh = (g) => R.mesh(g);
  const T3 = (x, y, z) => M.trs([x, y, z], [0, 0, 0], 1);
  let seed = 11; const rs = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; // repeatable: the same layout on every load
  const rnd = (a, b) => a + rs() * (b - a);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ======================================================== geometry helpers
  function alongX(g) { return G.xform(g, M.trs([0, 0, 0], [0, 0, -PI / 2], 1)); } // lathe axis Y -> X
  function alongZ(g) { return G.xform(g, M.trs([0, 0, 0], [PI / 2, 0, 0], 1)); }  // lathe axis Y -> Z
  function strut(a, b, w) { return G.xform(G.box(w, V.len(V.sub(b, a)), w), M.align(V.mul(V.add(a, b), 0.5), V.sub(b, a))); }
  function flangeGeo(r) { const g = G.cyl(r * 1.5, r * 1.5, 0.16, 24); for (let k = 0; k < 8; k++) { const a = TAU * k / 8; g.merge(G.cyl(r * 0.12, r * 0.12, 0.3, 6), T3(Math.cos(a) * r * 1.26, 0, Math.sin(a) * r * 1.26)); } return g; }
  function collarGeo(r) { return G.cyl(r * 1.1, r * 1.1, 0.16, 20, false); }

  // ======================================================== materials (add your own: STAGE.MAT.name = {...})
  // colour is perceptual (squared in the shader). metal 0..1, rough 0.04..1. tex: 1 concrete, 2 water, 3 ribbed cladding,
  // 4 3D-print layer lines, 5 wall with lit windows, 6 gravel, 7 jointed paving. grain: [strength, frequency] of surface noise.
  const MAT = {
    ground: { color: [0.15, 0.14, 0.13], rough: 0.96, tex: 6 },
    sand: { color: [0.34, 0.285, 0.21], rough: 0.97, grain: [0.28, 0.4] },
    apron: { color: [0.31, 0.31, 0.31], rough: 0.9, tex: 7, par: [9, 0, 0, 0] },
    asphalt: { color: [0.13, 0.13, 0.14], rough: 0.86, tex: 6 },
    paint: { color: [0.82, 0.82, 0.76], rough: 0.7 },
    water: { color: [0.02, 0.06, 0.1], rough: 0.09, tex: 2, par: [0.1, 0, 0, 0], cast: false },
    rock: { color: [0.27, 0.25, 0.23], rough: 0.96, grain: [0.5, 0.55] },
    concrete: { color: [0.5, 0.49, 0.47], rough: 0.92, tex: 1, grain: [0.16, 0.5], par: [3.0, 0, 0, 0] },
    steel: { color: [0.52, 0.54, 0.57], metal: 0.9, rough: 0.42, grain: [0.1, 1.4] },
    flange: { color: [0.66, 0.67, 0.69], metal: 0.95, rough: 0.3 },
    dark: { color: [0.17, 0.18, 0.2], metal: 0.6, rough: 0.48 },
    cast: { color: [0.2, 0.28, 0.38], metal: 0.3, rough: 0.46, grain: [0.07, 2.6] },
    shell: { color: [0.36, 0.42, 0.47], metal: 0.4, rough: 0.5, grain: [0.08, 1.2] },
    chrome: { color: [0.82, 0.84, 0.87], metal: 1, rough: 0.16 },
    brass: { color: [0.82, 0.62, 0.3], metal: 1, rough: 0.3 },
    copper: { color: [0.78, 0.47, 0.3], metal: 1, rough: 0.34 },
    alu: { color: [0.76, 0.78, 0.81], metal: 1, rough: 0.3 },
    glass: { color: [0.62, 0.74, 0.86], alpha: 0.12, rough: 0.05, cast: false },
    cladding: { color: [0.5, 0.56, 0.62], metal: 0.5, rough: 0.5, tex: 3, par: [9, 3.3, 0, 0] },
    motor: { color: [0.14, 0.26, 0.42], metal: 0.25, rough: 0.42 },
    pWater: { color: [0.17, 0.29, 0.44], metal: 0.25, rough: 0.4 },
    pHot: { color: [0.5, 0.17, 0.13], metal: 0.25, rough: 0.4 },
    pWarm: { color: [0.6, 0.33, 0.15], metal: 0.25, rough: 0.4 },
    pCool: { color: [0.17, 0.35, 0.32], metal: 0.25, rough: 0.4 },
    yellow: { color: [0.86, 0.66, 0.1], rough: 0.5 },
    red: { color: [0.72, 0.13, 0.1], rough: 0.6 },
    white: { color: [0.87, 0.87, 0.85], rough: 0.7 },
    rubber: { color: [0.05, 0.05, 0.055], rough: 0.85 },
    pcb: { color: [0.05, 0.27, 0.16], rough: 0.4 },
    cell: { color: [0.03, 0.05, 0.13], metal: 0.6, rough: 0.14 },
    lampOn: { color: [0.9, 0.85, 0.7], emis: [3.2, 2.5, 1.5], cast: false },
    wire: { color: [0.3, 0.3, 0.32], metal: 0.9, rough: 0.4, cast: false },
    trunk: { color: [0.34, 0.26, 0.18], rough: 0.96, grain: [0.35, 2.2] },
    frond: { color: [0.14, 0.27, 0.13], rough: 0.6 },
    floor: { color: [0.05, 0.055, 0.07], metal: 0.5, rough: 0.3 },
    plinth: { color: [0.12, 0.13, 0.16], metal: 0.6, rough: 0.34 },
    trim: { color: [0.7, 0.55, 0.25], metal: 1, rough: 0.3, emis: [0.4, 0.28, 0.09], cast: false },
  };
  const plastic = (c, layer) => ({ color: c, rough: 0.46, tex: 4, par: [TAU / (layer || 0.62), 0, 0, 0] }); // a 3D-printed part: layer lines across Y

  // ======================================================== environments (a scene picks one, or a changed copy)
  const ENV = {
    dusk: { light: V.norm([-0.42, 0.6, 0.62]), lightC: [1.75, 1.42, 1.05], light2: V.norm([0.6, 0.35, -0.55]), light2C: [0.12, 0.19, 0.36], sky: [0.07, 0.1, 0.18], gnd: [0.03, 0.027, 0.025],
      zen: [0.01, 0.018, 0.055], hor: [0.085, 0.115, 0.21], glow: [0.8, 0.32, 0.11], glowDir: [0.85, 0, -0.5], gndC: [0.12, 0.1, 0.085], fogC: [0.07, 0.09, 0.155], fogN: 110, fogF: 560, studio: 0, stars: 1, expo: 1.0 },
    studio: { light: V.norm([0.3, 0.9, 0.5]), lightC: [2.5, 2.35, 2.1], light2: V.norm([-0.7, 0.3, -0.4]), light2C: [0.3, 0.4, 0.62], sky: [0.16, 0.17, 0.21], gnd: [0.05, 0.05, 0.06],
      zen: [0.012, 0.014, 0.022], hor: [0.02, 0.024, 0.036], glow: [0, 0, 0], glowDir: [1, 0, 0], gndC: [0.01, 0.01, 0.014], fogC: [0.012, 0.014, 0.022], fogN: 40, fogF: 150, studio: 1, stars: 0, expo: 1.0 },
  };

  // ======================================================== interference registry (measure, do not eyeball)
  const SOL = [], PIPES = [], ALLOW = new Set();
  let cur = null, firstScene = null;                                // cur: the scene that is being built
  const sBox = (name, mn, mx) => SOL.push({ name, t: 0, mn, mx, sc: cur });
  const sCyl = (name, ax, c, r, h) => SOL.push({ name, t: 1, ax, c, r, h, sc: cur });
  const allow = (a, b) => { ALLOW.add(a + "|" + b); ALLOW.add(b + "|" + a); };
  function sdf(s, p) {
    if (s.t === 0) { const q = [0, 1, 2].map((k) => Math.abs(p[k] - (s.mn[k] + s.mx[k]) / 2) - (s.mx[k] - s.mn[k]) / 2);
      return Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(q[0], q[1], q[2]), 0); }
    const a = s.ax, d = [p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]], ax = Math.abs(d[a]) - s.h / 2, rad = Math.hypot(d[(a + 1) % 3], d[(a + 2) % 3]) - s.r;
    return Math.min(Math.max(ax, rad), 0) + Math.hypot(Math.max(ax, 0), Math.max(rad, 0));
  }
  function segDist(p, a, b) { const ab = V.sub(b, a), t = Math.max(0, Math.min(1, V.dot(V.sub(p, a), ab) / (V.dot(ab, ab) || 1))); return V.len(V.sub(p, V.add(a, V.mul(ab, t)))); }
  function samplesOf(s) { // points inside a solid, pulled in by 0.06 so that touching faces do not count
    const out = [], e = 0.06;
    if (s.t === 0) { for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) for (let k = 0; k <= 6; k++) out.push([s.mn[0] + e + (s.mx[0] - s.mn[0] - 2 * e) * i / 6, s.mn[1] + e + (s.mx[1] - s.mn[1] - 2 * e) * j / 6, s.mn[2] + e + (s.mx[2] - s.mn[2] - 2 * e) * k / 6]); }
    else { for (let i = 0; i <= 8; i++) for (let j = 0; j < 16; j++) for (let k = 0; k <= 3; k++) { const p = [0, 0, 0], an = TAU * j / 16, rr = (s.r - e) * k / 3;
      p[s.ax] = s.c[s.ax] - s.h / 2 + e + (s.h - 2 * e) * i / 8; p[(s.ax + 1) % 3] = s.c[(s.ax + 1) % 3] + Math.cos(an) * rr; p[(s.ax + 2) % 3] = s.c[(s.ax + 2) % 3] + Math.sin(an) * rr; out.push(p); } }
    return out;
  }
  // every pipe against every solid and every other pipe, every solid against every other solid, inside one scene
  function check() {
    const hits = [], eps = 0.05; let pairs = 0;
    PIPES.forEach((P) => { const path = new Path(P.pts), n = Math.ceil(path.len / 0.2);
      pairs += SOL.filter((s) => s.sc === P.sc).length + PIPES.filter((Q) => Q.sc === P.sc && Q.name > P.name).length;
      for (let i = 0; i <= n; i++) { const d = path.len * i / n, p = path.at(Math.min(0.99999, i / n));
        for (const s of SOL) { if (s.sc !== P.sc) continue; const pen = P.r - sdf(s, p); if (pen < eps) continue;
          if ((P.a0.includes(s.name) && d < P.end) || (P.a1.includes(s.name) && path.len - d < P.end) || P.thru.includes(s.name)) continue;
          hits.push(`pipe ${P.name} x ${s.name} @ ${p.map((v) => v.toFixed(1))} depth ${pen.toFixed(2)}`); break; }
        for (const Q of PIPES) { if (Q === P || Q.sc !== P.sc || Q.name < P.name) continue; let dm = 1e9; for (let k = 1; k < Q.pts.length; k++) dm = Math.min(dm, segDist(p, Q.pts[k - 1], Q.pts[k]));
          if (P.r + Q.r - dm < eps) continue; if (P.join.includes(Q.name) || Q.join.includes(P.name)) continue;
          hits.push(`pipe ${P.name} x pipe ${Q.name} @ ${p.map((v) => v.toFixed(1))} depth ${(P.r + Q.r - dm).toFixed(2)}`); break; } } });
    for (let i = 0; i < SOL.length; i++) for (let j = i + 1; j < SOL.length; j++) { const a = SOL[i], b = SOL[j]; if (a.sc !== b.sc) continue; pairs++; if (ALLOW.has(a.name + "|" + b.name)) continue;
      let worst = 0, at = null; for (const p of samplesOf(a)) { const d = -sdf(b, p); if (d > worst) { worst = d; at = p; } } for (const p of samplesOf(b)) { const d = -sdf(a, p); if (d > worst) { worst = d; at = p; } }
      if (worst > eps) hits.push(`solid ${a.name} x ${b.name} @ ${at.map((v) => v.toFixed(1))} depth ${worst.toFixed(2)}`); }
    return { pipes: PIPES.length, solids: SOL.length, pairs, hits: [...new Set(hits)] };
  }

  // ======================================================== scenes and builders
  function add(parent, o) { const n = node(o); parent.children.push(n); return n; }
  function Batch(parent) { // merges everything of one material into a single mesh: thousands of boxes, a handful of draw calls
    let geos = {}; const b = {
      g(mat, geo, m) { if (!MAT[mat]) throw new Error("no material '" + mat + "'"); (geos[mat] || (geos[mat] = new Geo())).merge(geo, m); return b; },
      // sol: a name registers the box / cylinder as a solid for check(). ax: 0 = along X, 1 = along Y, 2 = along Z
      box(mat, cx, cy, cz, w, h, d, sol, skip) { b.g(mat, G.box(w, h, d, skip), T3(cx, cy, cz)); if (sol) sBox(sol, [cx - w / 2, cy - h / 2, cz - d / 2], [cx + w / 2, cy + h / 2, cz + d / 2]); return b; },
      cyl(mat, ax, cx, cy, cz, r1, r2, len, seg, sol, caps) { let g = G.cyl(r1, r2, len, seg || 24, caps); if (ax === 0) g = alongX(g); else if (ax === 2) g = alongZ(g);
        b.g(mat, g, T3(cx, cy, cz)); if (sol) sCyl(sol, ax, [cx, cy, cz], Math.max(r1, r2), len); return b; },
      flush() { for (const k in geos) add(parent, Object.assign({ mesh: mesh(geos[k]) }, MAT[k])); geos = {}; },
    }; return b;
  }
  const SCENES = {}, CAM = {}, LABELS = {};
  // scene(name, {env, period, shadow, near, far}) creates the scene or returns to it; what is added next belongs to it.
  // period: seconds of its looping video. shadow: (target, distance) => ({c, r}), the region that receives shadows.
  function scene(name, opt) {
    let s = SCENES[name];
    if (!s) { s = SCENES[name] = { name, root: node(), env: ENV.dusk, period: 9, shadow: null, near: 0.3, far: 1600, flows: {}, journeys: {}, emitters: [], glows: [], frame: [], want: [], cam0: null }; s.B = Batch(s.root); if (!firstScene) firstScene = name; }
    Object.assign(s, opt || {}); cur = s; return s;
  }
  // studio(name, opt): a dark room for a part shown alone: floor, a plinth edged in lit brass, a spotlight cone, shadows. Returns the scene;
  // the plinth top is y = 1.2 (scene.top). opt.r: radius of a round plinth (2.9); opt.long: half-length of a long one with rounded ends, opt.width: its
  // half-width (1.8); opt.plinth: false for the floor alone; opt.reach: radius that receives shadows (13); opt.period: seconds of its loop (12)
  function studio(name, o) {
    o = o || {}; const H = 1.2, s = scene(name, { env: ENV.studio, period: o.period || 12, shadow: () => ({ c: [0, 3, 0], r: o.reach || 13 }), top: o.plinth === false ? 0 : H }), B = s.B;
    B.g("floor", G.cyl(80, 80, 0.4, 72), T3(0, -0.2, 0)); let cone = 6;
    if (o.plinth === false) cone = o.reach ? o.reach * 0.6 : 6;
    else if (o.long) { const L = o.long, w = o.width || 1.8, pl = new Geo(), ring = new Geo(); cone = L + 1;
      pl.merge(G.box(2 * L, H, 2 * w), T3(0, H / 2, 0)); for (const z of [-1, 1]) ring.merge(G.box(2 * L, 0.08, 0.1), T3(0, H + 0.02, z * (w - 0.08)));
      for (const e of [-1, 1]) { const a0 = e > 0 ? -PI / 2 : PI / 2, a1 = e > 0 ? PI / 2 : 1.5 * PI;
        pl.merge(G.lathe([[0, 0, 1], [w, 0, 1], [w, 0, 1], [w, H, 1], [w, H, 1], [0, H, 1]], 24, a0, a1), T3(e * L, 0, 0)); ring.merge(G.tubeRing(w - 0.03, w - 0.13, 0.08, 24, a0, a1), T3(e * L, H + 0.02, 0)); }
      B.g("plinth", pl); B.g("trim", ring); }
    else { const r = o.r || 2.9; cone = r + 1.6; B.g("plinth", G.cyl(r - 0.3, r, H, 64), T3(0, H / 2, 0)); B.g("trim", G.tubeRing(r - 0.28, r - 0.4, 0.08, 64), T3(0, H + 0.02, 0)); }
    part({ color: [1.0, 0.9, 0.7], alpha: 0.045, rough: 1, emis: [0.3, 0.26, 0.19], cast: false }, G.cyl(cone, 0.8, 14, 48, false), { pos: [0, 8.5, 0] });
    return s;
  }
  const need = () => { if (!cur) throw new Error("call STAGE.scene(name) before building"); return cur; };
  // a part that moves: its own node (everything static goes through the scene's batch instead)
  function part(mat, geo, o) { const m = typeof mat === "string" ? MAT[mat] : mat; if (!m) throw new Error("no material '" + mat + "'"); return add((o && o.parent) || need().root, Object.assign({ mesh: mesh(geo) }, m, o, { parent: undefined })); }
  // real geometry: a model packed by stl2models.py into <deck>/models.js. CAD is Z-up, the stage is Y-up.
  // o.fit: scale so that the largest side is this long, centred on x and z, standing on y = 0. o.scale: plain factor. o.zup: false = keep axes
  function stl(key, o) {
    o = o || {}; const p = (window.MODELS3D || {})[key]; if (!p) throw new Error("no model '" + key + "' in models.js (run stl2models.py)");
    const bin = atob(p.d), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const q = new Int16Array(u8.buffer), g = new Geo(), n = q.length / 9, c = p.c, h = p.h, zup = o.zup !== false;
    g.p = new Array(q.length); g.n = new Array(q.length);
    for (let t = 0; t < n; t++) { const P = [];
      for (let k = 0; k < 3; k++) { const i = t * 9 + k * 3, x = c[0] + q[i] / 32767 * h[0], y = c[1] + q[i + 1] / 32767 * h[1], z = c[2] + q[i + 2] / 32767 * h[2]; P.push(zup ? [x, z, -y] : [x, y, z]); }
      const nn = V.norm(V.cross(V.sub(P[1], P[0]), V.sub(P[2], P[0])));
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) { g.p[t * 9 + k * 3 + j] = P[k][j]; g.n[t * 9 + k * 3 + j] = nn[j]; } }
    if (!o.fit && !o.scale) return g;
    const b = G.bounds(g), s = o.fit ? o.fit / Math.max(b.size[0], b.size[1], b.size[2]) : o.scale;
    return o.fit ? G.xform(g, M.mul(M.trs([0, 0, 0], [0, 0, 0], s), T3(-b.c[0], -b.mn[1], -b.c[2]))) : G.xform(g, M.trs([0, 0, 0], [0, 0, 0], s));
  }
  function cam(name, c) { CAM[name] = c; if (!need().cam0) cur.cam0 = name; return c; } // c: {eye, target, fov} or (slide data) => {eye, target, fov}
  function label(key, p) { LABELS[key] = { p, sc: need() }; }                             // a one-character key is drawn as a numbered marker
  function onFrame(fn) { need().frame.push(fn); }

  // a pipe along a polyline with rounded bends, flanged ends and collars; registered for check().
  // o: bend, f0 / f1: false = no flange at that end, a0 / a1: solids the ends may enter, thru: solids it may pass through,
  //    join: pipes it may touch, support: spacing of automatic supports under its horizontal runs, collars: spacing (0 = none)
  function pipe(name, pts, r, mat, o) {
    o = o || {}; const B = need().B, sp = smoothPath(pts, o.bend == null ? 1.5 : o.bend, 8), N = pts.length;
    B.g(mat, G.tube(sp, r, 14));
    const fl = flangeGeo(r);
    if (o.f0 !== false) B.g("flange", fl, M.align(pts[0], V.sub(pts[1], pts[0])));
    if (o.f1 !== false) B.g("flange", fl, M.align(pts[N - 1], V.sub(pts[N - 2], pts[N - 1])));
    const every = o.collars == null ? 9 : o.collars;
    if (every) for (let i = 0; i < N - 1; i++) { const a = pts[i], b = pts[i + 1], L = V.len(V.sub(b, a)), n = Math.floor(L / every); for (let k = 1; k <= n; k++) B.g("flange", collarGeo(r), M.align(V.lerp(a, b, k / (n + 1)), V.sub(b, a))); }
    const P = { name, pts: sp, raw: pts, r, a0: o.a0 || [], a1: o.a1 || [], thru: o.thru || [], join: o.join || [], end: o.end || 2.2, sc: cur };
    PIPES.push(P); if (o.support) cur.want.push([P, o.support]);
    return sp;
  }
  function supports(P, every) { // posts under the horizontal runs, only where nothing else stands
    const raw = P.raw, B = P.sc.B;
    for (let i = 0; i < raw.length - 1; i++) { const a = raw[i], b = raw[i + 1]; if (Math.abs(a[1] - b[1]) > 0.01) continue; const L = V.len(V.sub(b, a)), n = Math.floor(L / every);
      for (let k = 0; k < n; k++) { const p = V.lerp(a, b, (k + 0.5) / n), top = p[1] - P.r - 0.1; let free = top > 0.2;
        for (let y = 0.3; y < top && free; y += 0.3) { for (const s of SOL) if (s.sc === P.sc && sdf(s, [p[0], y, p[2]]) < 0.35) { free = false; break; }
          for (const Q of PIPES) { if (Q === P || Q.sc !== P.sc || !free) continue; for (let j = 1; j < Q.pts.length; j++) if (segDist([p[0], y, p[2]], Q.pts[j - 1], Q.pts[j]) < Q.r + 0.3) { free = false; break; } } }
        if (!free) continue;
        if (top < 0.9) B.box("concrete", p[0], (top + 0.06) / 2, p[2], 0.6, top - 0.06, 0.6);
        else { B.box("steel", p[0], (top + 0.06) / 2, p[2], 0.26, top - 0.06, 0.26); B.box("steel", p[0], 0.1, p[2], 0.7, 0.08, 0.7); B.box("steel", p[0], top + 0.05, p[2], P.r * 1.6, 0.1, P.r * 1.6); } } }
  }
  function rail(pts, y, mat) { // handrail along a polyline [x, z] on a floor at height y
    const B = need().B; mat = mat || "yellow";
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 1.7));
      for (let k = 0; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n; B.box(mat, x, y + 0.55, z, 0.08, 1.1, 0.08); }
      for (const h of [1.08, 0.58]) B.g(mat, strut([a[0], y + h, a[1]], [b[0], y + h, b[1]], 0.07)); }
  }

  // ======================================================== what moves
  // flow: glowing pulses that travel along a path (give it the points that pipe() returned). v: units per second,
  // bias: how far the sprites are pulled toward the eye so that they show in front of the pipe wall, dens: pulses per unit.
  // o: size, alpha, on: (c) => 0..1 strength, hero: colour of the hero drop on this path
  function flow(name, pts, col, v, bias, dens, o) {
    const path = new Path(pts), f = Object.assign({ path, col, v, bias: bias == null ? 0.7 : bias, n: Math.max(3, Math.round(path.len * (dens || 0.4))), p0: rs(), size: 0.62, alpha: 0.7 }, o || {});
    f.phase = f.p0; need().flows[name] = f; return f;
  }
  // journey: the route of the hero drop on a slide (data-hero="key"): [[flow name, from 0..1, to 0..1], ...]
  function journey(key, segs, o) { need().journeys[key] = Object.assign({ segs, speed: 0.11, size: 1 }, o || {}); } // size: 1 suits pipes of radius 0.3 to 0.6; take 0.3 on a bench-top device
  // emitter: n sprites that each live `life` seconds and are then born again (smoke, flames, bubbles, sparks, rain).
  // draw(t, q, c): t = age 0..1, q = four random numbers that stay fixed during one life; it adds the sprite itself (STAGE.PF / PS).
  function emitter(n, life, draw) {
    const e = { n, life, draw, q: [] };
    for (let i = 0; i < n; i++) { const t0 = rs(); e.q.push({ t0, t: t0, c: 0, rows: Array.from({ length: 16 }, () => [rs(), rs(), rs(), rs()]) }); }
    need().emitters.push(e); return e;
  }
  // glow: a soft light sprite at a point. on: (c) => 0..1
  function glow(p, col, size, on) { need().glows.push({ p, c: col, s: size, on }); }

  const PF = new Particles(R, 9000, { additive: true, soft: 1 });   // light: flows, flames, lamps
  const PS = new Particles(R, 2600, { additive: false, soft: 1 });  // matter: smoke, steam, dust
  const PH = new Particles(R, 60, { additive: true, soft: 1 });     // the hero drop

  // ======================================================== state driven by the slides
  const S = { scene: null, cam: null, camFrom: null, camT: 1, shift: 0, shiftFrom: 0, dim: 0, orbit: 0, hero: null, heroT: 0, labels: [], d: {}, cut: false, period: 9, t0: 0 };
  let curCam = null, curShift = 0, started = false;
  const labelEls = {}, LSTATE = {};
  const camOf = (name, d) => { const c = CAM[name]; return typeof c === "function" ? c(d || {}) : c; };
  function setSlide(cfg) {
    const name = cfg.scene || firstScene, sc = SCENES[name];
    if (!sc) throw new Error("slide asks for scene '" + name + "'; scene.js defines: " + Object.keys(SCENES).join(", "));
    const cname = cfg.cam || sc.cam0;
    if (!CAM[cname]) throw new Error("slide asks for camera '" + cname + "'; scene.js defines: " + Object.keys(CAM).join(", "));
    const to = camOf(cname, cfg.d), changed = S.scene !== name;
    S.scene = name; S.cam = to; S.period = sc.period; S.d = cfg.d || {};
    // a new scene has no meaningful "previous view": arrive with a short push-in instead of a flight across nothing
    S.camFrom = !curCam || changed ? { eye: V.add(to.target, V.mul(V.sub(to.eye, to.target), 1.3)), target: to.target, fov: to.fov } : clone(curCam);
    S.camT = curCam ? 0 : 1; S.shiftFrom = changed ? (cfg.shift || 0) : curShift;
    S.hero = cfg.hero || null; S.heroT = cfg.cut ? 0.35 : 0; S.dim = cfg.dim || 0; S.shift = cfg.shift || 0; S.orbit = cfg.orbit || 0;
    S.cut = !!cfg.cut; S.labels = cfg.labels || []; S.t0 = performance.now() / 1000;
    S.labels.forEach((k) => { if (!LABELS[k]) console.error("slide asks for label '" + k + "' that scene.js does not define"); });
    if (S.hero && !sc.journeys[S.hero]) console.error("slide asks for hero '" + S.hero + "' that scene '" + name + "' does not define");
    if (cfg.cut) { S.camT = 1; S.camFrom = S.cam; S.shiftFrom = S.shift; }
    if (!curCam || cfg.cut) { curCam = clone(S.cam); curShift = S.shift; }
  }

  // ======================================================== animation loop
  let last = performance.now(), T = 0, slow = 0;
  let LOOP = 0, paused = false; // loop mode (video capture): period in seconds; every motion then repeats exactly after one period
  const ANG = {}, EASED = {}, STEP = {}; let FRAME = 0;
  function frame(now, manual) {
    if (paused && !manual) return;
    const sc = SCENES[S.scene]; if (!sc) { if (!manual) requestAnimationFrame(frame); return; }
    const raw = (now - last) / 1000, dt = Math.min(0.05, raw); last = now; T += dt; R.time = T; FRAME++;
    const LP = LOOP, fr = (x) => x - Math.floor(x);
    // Wq: an angular speed with a whole number of turns per loop (min: at least one turn, for slow turntables)
    const Wq = (w, min) => { if (!LP) return w; let k = Math.round(w * LP / TAU); if (min && k === 0) k = w < 0 ? -1 : 1; return TAU * k / LP; };
    R.wave = LP ? [Wq(1.1) * T, Wq(1.6) * T, Wq(2.2) * T, 0] : [T * 1.1, T * 1.6, T * 2.2, T * 0.5]; R.twk = Wq(1.3) * T;
    // keep the frame rate on weak graphics: lower the internal resolution, never the scene
    if (!S.cut && !LP && raw > 0.04 && raw < 0.5) { if (++slow > 45 && R.scale > 0.55) { R.scale *= 0.85; slow = 0; } } else slow = Math.max(0, slow - 1);
    R.resize();
    // camera: flight from the previous view, then a slow drift
    if (S.camT < 1) S.camT = Math.min(1, S.camT + dt / FLY);
    const k = easeIO(S.camT), a = S.camFrom || S.cam, b = S.cam;
    let eye = V.lerp(a.eye, b.eye, k); const tgt = V.lerp(a.target, b.target, k);
    const sway = LP ? 0.03 * Math.sin(TAU * T / LP) : Math.sin(T * 0.12) * 0.04 + (S.orbit ? Math.min(60, now / 1000 - S.t0) * S.orbit : 0);
    const off = V.sub(eye, tgt), c = Math.cos(sway), s = Math.sin(sway);
    eye = V.add(tgt, [off[0] * c - off[2] * s, off[1], off[0] * s + off[2] * c]);
    curCam = { eye: V.lerp(a.eye, b.eye, k), target: tgt, fov: a.fov + (b.fov - a.fov) * k }; curShift = S.shiftFrom + (S.shift - S.shiftFrom) * k;
    R.cam = { eye, target: tgt, fov: curCam.fov, near: sc.near, far: sc.far, shift: curShift };
    const dist = V.len(V.sub(eye, tgt));
    Object.assign(R.env, sc.env);
    R.env.shadow = sc.shadow ? sc.shadow(tgt, dist) : { c: tgt, r: Math.pow(1.3, Math.round(Math.log(Math.max(16, Math.min(150, dist * 0.8))) / Math.log(1.3))) };
    // the scene's own motion
    const ctx = { T, dt, LP, S, d: S.d, Wq, fr, TAU,
      num(key, def) { const v = S.d[key]; return v == null || v === "" ? def : +v; },                                    // a number from the slide: data-key="..."
      // an angle that keeps turning at w rad/s (it grows without bound; the speed may change between slides). One key is one clock, however often it is read in a frame
      spin(key, w, min) { if (LP) return Wq(w, min) * T; if (STEP[key] !== FRAME) { STEP[key] = FRAME; ANG[key] = (ANG[key] || 0) + dt * w; } return ANG[key]; },
      cycle(key, seconds) { return fr(ctx.spin(key, TAU / seconds, true) / TAU); },                                       // 0..1 once every `seconds`: the phase of a conveyor, a stroke, a sequence
      osc(w, ph) { return Math.sin(Wq(w, true) * T + (ph || 0)); },                                                      // -1..1
      ease(key, target, rate) { const v = EASED[key] == null || S.cut ? target : EASED[key] + (target - EASED[key]) * Math.min(1, dt * (LP ? 4 : rate || 1.2)); return (EASED[key] = v); } }; // a value that follows the slide smoothly
    PF.clear(); PS.clear(); PH.clear();
    sc.frame.forEach((fn) => fn(ctx));
    for (const key in sc.flows) { const f = sc.flows[key], on = f.on ? f.on(ctx) : 1, r = f.v / f.path.len;
      if (LP) f.phase = f.p0 + T * Math.round(r * LP * f.n) / (LP * f.n); else f.phase += dt * r;
      if (on > 0.02) for (let i = 0; i < f.n; i++) PF.add(f.path.at(fr(i / f.n + f.phase)), [f.col[0], f.col[1], f.col[2], f.alpha * on], f.size, f.bias); }
    for (const e of sc.emitters) {
      if (LP) { // a life longer than the loop: m sprites share one track, 1/m of a life apart; shorter: K whole lives per loop
        const m = e.life > 1.5 * LP ? Math.round(e.life / LP) : 1, K = m > 1 ? 1 : Math.max(1, Math.round(LP / e.life)), groups = Math.floor(e.n / m);
        for (let g = 0; g < groups; g++) { const base = e.q[g * m];
          for (let j = 0; j < m; j++) { const u = base.t0 + j / m + T * K / (m * LP), row = m > 1 ? 0 : ((Math.floor(u) % K) + K) % K; e.draw(fr(u), base.rows[row % 16], ctx); } }
      } else for (const q of e.q) { q.t += dt / e.life; if (q.t >= 1) { q.t -= Math.floor(q.t); q.c++; } e.draw(q.t, q.rows[q.c % 16], ctx); }
    }
    sc.glows.forEach((g) => { const kk = g.on ? g.on(ctx) : 1; if (kk > 0.02) PF.add(g.p, [g.c[0], g.c[1], g.c[2], 0.5 * kk], g.s, 0.3); });
    const J = S.hero && sc.journeys[S.hero];
    if (J) { S.heroT = LP ? fr(T / LP + 0.35) : (S.heroT + dt * J.speed) % 1; const segs = J.segs;
      const L = segs.map((sg) => sc.flows[sg[0]].path.len * (sg[2] - sg[1])), tot = L.reduce((x, y) => x + y, 0); let d = S.heroT * tot, i = 0;
      while (i < segs.length - 1 && d > L[i]) { d -= L[i]; i++; }
      const sg = segs[i], f = sc.flows[sg[0]], t = sg[1] + (sg[2] - sg[1]) * (d / L[i]), p = f.path.at(Math.min(0.9999, t));
      const col = f.hero || [0.5 + 0.5 * f.col[0], 0.5 + 0.5 * f.col[1], 0.5 + 0.5 * f.col[2]], bs = f.bias + 0.25;
      const z = J.size; PH.add(p, [col[0], col[1], col[2], 1], 2.6 * z, bs); PH.add(p, [1, 1, 1, 0.95], 1.0 * z, bs);
      for (let q = 1; q < 10; q++) { const tt = Math.max(sg[1], t - q * 0.9 * z / f.path.len); PH.add(f.path.at(Math.min(0.9999, tt)), [col[0], col[1], col[2], 0.5 * (1 - q / 10)], 1.7 * z * (1 - q / 12), bs); } }
    R.render(sc.root, [PS, PF, PH]);
    // labels: callouts on a leader, hidden when they would sit on the text panel, pushed apart when they would touch
    const VP = R.VP, cw = canvas.clientWidth, ch = canvas.clientHeight, vis = [];
    const pan = document.querySelector(".slide.on .panel"), pr = pan ? pan.getBoundingClientRect() : null, soft = document.documentElement.dir === "rtl" ? 0.08 : 0.2; // the faded edge of a side panel may carry a callout
    for (const key in labelEls) {
      const el = labelEls[key], L = LABELS[key], want = L.sc === sc && S.labels.includes(key);
      if (!want) { el.style.opacity = 0; delete LSTATE[key]; continue; }
      if (S.camT <= 0.7) { el.style.opacity = 0; LSTATE[key] = "flying"; continue; }
      const p = L.p, x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13], w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
      if (w <= 0) { el.style.opacity = 0; LSTATE[key] = "behind the camera"; continue; }
      const sx = ((x / w) * 0.5 + 0.5) * cw, sy = (1 - ((y / w) * 0.5 + 0.5)) * ch, num = key.length === 1, hw = num ? ch * 0.022 : el.firstChild.offsetWidth / 2;
      if (pr && sx + hw > pr.left + pr.width * (pan.classList.contains("right") ? soft : 0) && sx - hw < pr.right - pr.width * (pan.classList.contains("left") ? soft : 0) && sy > pr.top - ch * 0.02 && sy - ch * 0.07 < pr.bottom) { el.style.opacity = 0; LSTATE[key] = "under the text panel"; continue; }
      if (sx < hw + 4 || sx > cw - hw - 4 || sy < ch * 0.1 || sy > ch * 0.97) { el.style.opacity = 0; LSTATE[key] = "off the screen"; continue; }
      LSTATE[key] = "shown"; vis.push({ el, sx, sy, hw, num, lift: num ? 0 : ch * 0.05 });
    }
    vis.sort((p, q) => q.sy - p.sy);
    for (let i = 0; i < vis.length; i++) for (let j = 0; j < i; j++) { const p = vis[i], q = vis[j]; if (p.num || q.num) continue;
      if (Math.abs(p.sx - q.sx) < p.hw + q.hw + 6 && Math.abs((p.sy - p.lift) - (q.sy - q.lift)) < ch * 0.038) p.lift = Math.max(p.lift, q.lift + (p.sy - q.sy) + ch * 0.04); }
    vis.forEach((p) => { p.el.style.opacity = 1; p.el.style.setProperty("--lift", p.lift + "px"); p.el.style.transform = `translate(${p.sx}px, ${p.sy}px)`; });
    const dimEl = document.getElementById("dim"); if (dimEl) dimEl.style.opacity = S.dim;
    if (!manual) requestAnimationFrame(frame);
  }
  function start() {
    if (started) return; started = true;
    for (const k in SCENES) { const s = SCENES[k]; cur = s; s.want.forEach(([P, every]) => supports(P, every)); s.B.flush(); } // supports last, when every solid and pipe is known
    const root = document.getElementById("labels");
    Object.keys(LABELS).forEach((k) => { const d = document.createElement("div"), num = k.length === 1; d.className = "lbl" + (num ? " num" : ""); d.innerHTML = num ? "<b></b>" : "<span></span><i></i>"; d.firstChild.textContent = k; root.appendChild(d); labelEls[k] = d; });
    requestAnimationFrame(frame);
  }
  function tick(n, step) { for (let i = 0; i < n; i++) frame(last + (step || 16.7), true); } // advance the show by hand (tests, hidden tabs)
  function bench(n) { const gl = R.gl, px = new Uint8Array(4), sc = SCENES[S.scene], t0 = performance.now(); for (let i = 0; i < n; i++) { R.render(sc.root, [PS, PF, PH]); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return (performance.now() - t0) / n; }

  window.STAGE = { V, M, G, Geo, Path, node, smoothPath, R, mesh, TAU, PI, T3, rs, rnd, alongX, alongZ, strut, flangeGeo, collarGeo, MAT, plastic, ENV, FLY,
    scene, studio, add, part, stl, Batch, sBox, sCyl, allow, check, pipe, rail, flow, journey, emitter, glow, label, cam, onFrame, PF, PS, PH, CAM, LABELS, SCENES, S, start };
  window.PRES3D = { setSlide, CAM, S, check, bench, tick, R, setT: (t) => { T = t; },
    labels: () => Object.assign({}, LSTATE),                                                                            // why each requested label is or is not on screen
    info: () => ({ scenes: Object.keys(SCENES), cams: Object.keys(CAM), labels: Object.keys(LABELS), drawn: R.drawn }),
    loop: (p) => { LOOP = p || 0; const was = paused; paused = !!p; if (was && !paused) requestAnimationFrame(frame); }, // loop mode also stops the free-running clock
    renderAt: (t, dt) => { T = t - dt; frame(last + dt * 1000, true); } };                                              // draw the frame of time t, one step dt after the previous one
})();
