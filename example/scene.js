/* scene.js of the example deck: a solar water-pumping station.
   Scene "site":  PV array -> controller -> pump at the well -> elevated tank -> drip line under date palms.
   Scene "show":  the pump unit alone on a plinth, pulled apart along its shaft.
   Read it as the pattern for a new deck: constants first, static parts through the batch, moving parts as nodes,
   every pipe and big solid registered, then flows, emitters, labels, cameras and one onFrame per scene. */
(function () {
  "use strict";
  const { V, M, G, Geo, T3, TAU, PI, MAT, alongX, strut, part, add, mesh, pipe, rail, flow, journey, emitter, glow, label, cam, onFrame, sBox, sCyl, rs, PF, PS } = STAGE;
  const W = {};                                         // the parts that move

  // the deck's own materials
  MAT.tank = { color: [0.8, 0.82, 0.84], metal: 0.3, rough: 0.42, grain: [0.06, 1.5] };
  MAT.busbar = { color: [0.78, 0.8, 0.84], metal: 1, rough: 0.35, cast: false };
  MAT.cable = { color: [0.08, 0.08, 0.09], rough: 0.7 };
  MAT.basin = { color: [0.3, 0.24, 0.17], rough: 0.97, grain: [0.4, 1.2] };

  // ================================================================ the pump unit, in its own frame: shaft along X through the origin
  function pumpParts() {
    const P = {}, vol = [[0.2, -0.55, 1], [1.05, -0.55, 1], [1.05, -0.55, 1], [1.42, -0.3], [1.42, 0.3], [1.05, 0.55, 1], [1.05, 0.55, 1], [0.2, 0.55, 1]];
    P.motor = new Geo().merge(alongX(G.cyl(1.12, 1.12, 3.2, 32)), T3(2.2, 0, 0)).merge(G.box(0.9, 0.5, 0.9), T3(2.2, 1.34, 0));       // body and terminal box
    for (let k = 0; k < 22; k++) { const a = TAU * k / 22; if (Math.cos(a) < -0.72) continue; P.motor.merge(G.box(3.0, 0.2, 0.08), M.trs([2.2, Math.cos(a) * 1.17, Math.sin(a) * 1.17], [a, 0, 0], 1)); } // cooling fins
    P.motorEnd = new Geo().merge(alongX(G.lathe([[0, -0.35, 1], [1.2, -0.35, 1], [1.2, -0.35, 1], [1.2, 0.14], [1.04, 0.3], [0, 0.36]], 32)), T3(4.15, 0, 0)) // fan cowl
      .merge(G.box(0.5, 0.54, 2.5), T3(1.1, -1.27, 0)).merge(G.box(0.5, 0.54, 2.5), T3(3.3, -1.27, 0));                                 // feet
    P.shaft = alongX(G.cyl(0.18, 0.18, 2.9, 16)); P.shaft = new Geo().merge(P.shaft, T3(-0.85, 0, 0));
    P.coupling = new Geo().merge(alongX(G.cyl(0.42, 0.42, 0.8, 20)), T3(0.05, 0, 0));
    P.guard = new Geo().merge(alongX(G.lathe([[0.64, -0.55, 1], [0.64, 0.55, 1]], 18, PI / 2, 1.5 * PI)), T3(0.05, 0, 0));
    P.frame = new Geo().merge(alongX(G.cyl(0.62, 0.62, 1.25, 24)), T3(-1.12, 0, 0)).merge(G.box(0.9, 0.92, 1.3), T3(-1.12, -1.08, 0));
    P.volute = new Geo().merge(alongX(G.lathe(vol, 22, PI, TAU)), T3(-2.45, 0, 0)).merge(G.box(0.8, 0.14, 1.5), T3(-2.45, -1.47, 0))      // back half and foot
      .merge(alongX(G.cyl(0.62, 0.62, 0.62, 20)), T3(-3.3, 0, 0)).merge(G.cyl(0.5, 0.5, 0.7, 20), T3(-2.45, 1.65, 0));                    // suction and discharge nozzles
    P.window = new Geo().merge(alongX(G.lathe(vol, 22, 0, PI)), T3(-2.45, 0, 0));                                                         // front half in glass: the impeller shows
    const im = new Geo(); im.merge(alongX(G.cyl(0.3, 0.3, 0.9, 16))); im.merge(alongX(G.cyl(1.15, 1.15, 0.06, 36)), T3(0.27, 0, 0)); im.merge(alongX(G.tubeRing(1.15, 0.48, 0.06, 36)), T3(-0.27, 0, 0));
    for (let k = 0; k < 7; k++) { const a0 = TAU * k / 7; let prev = null;                                                               // seven backward-curved vanes
      for (let s = 0; s <= 6; s++) { const rr = 0.42 + 0.7 * s / 6, an = a0 - 0.95 * Math.pow(s / 6, 1.15), y = Math.cos(an) * rr, z = Math.sin(an) * rr;
        if (prev) im.quad([-0.24, prev[0], prev[1]], [0.24, prev[0], prev[1]], [0.24, y, z], [-0.24, y, z]); prev = [y, z]; } }
    P.impeller = im;
    return P;
  }
  const PUMP = pumpParts();
  const PUMP_MAT = { motor: "motor", motorEnd: "dark", shaft: "chrome", coupling: "dark", guard: "yellow", frame: "cast", volute: "cast", window: "glass" };

  // ================================================================ scene "site"
  const site = STAGE.scene("site", { period: 9 }), B = site.B;
  const AX = [-30, -22, -14], AZ = -4, TILT = 25 * PI / 180;     // PV tables
  const CX = -5, CZ = -7;                                          // controller cabinet
  const WX = -4;                                                   // well
  const PX = 6, PY = 2.3, PZ = 2, VX = PX - 2.45;                  // pump: shaft axis, volute
  const TX = 22, TZ = -5, TY = 12;                                 // tank: centre, deck height
  const PALMS = [35, 40.2, 45.4, 50.6, 55.8], GZ = 7.6, DZ = 6;    // palm row, drip main

  // ---------------------------------------------------------------- ground, paving, far dunes
  B.box("sand", 0, -1, 0, 900, 2, 900);
  B.box("apron", 10, 0.03, -2, 44, 0.06, 22);
  { const g = new Geo(), N = 160, hgt = (i) => { const a = i / N * TAU; return 5 + 9 * (0.5 + 0.5 * Math.sin(a * 3 + 1)) + 8 * Math.abs(Math.sin(a * 7.3 + 2)) + 4 * Math.abs(Math.sin(a * 17.1)); };
    for (let i = 0; i < N; i++) { const a0 = i / N * TAU, a1 = (i + 1) / N * TAU, r = 330; g.quad([Math.cos(a0) * r, -2, Math.sin(a0) * r], [Math.cos(a1) * r, -2, Math.sin(a1) * r], [Math.cos(a1) * r, hgt(i + 1), Math.sin(a1) * r], [Math.cos(a0) * r, hgt(i), Math.sin(a0) * r]); }
    add(site.root, { mesh: mesh(g), color: [0.05, 0.05, 0.075], rough: 1, cast: false }); }

  // ---------------------------------------------------------------- PV array: three tilted tables of six modules on steel posts
  const YC = 1.93, tilt = (x, y, z) => [x, YC + y * Math.cos(TILT) - z * Math.sin(TILT), AZ + y * Math.sin(TILT) + z * Math.cos(TILT)]; // table frame -> world (x added by the caller)
  AX.forEach((x0, i) => {
    const m = M.trs([x0, YC, AZ], [TILT, 0, 0], 1), at = (x, y, z) => M.mul(m, T3(x, y, z));
    for (const cx of [-2.3, 0, 2.3]) for (const cz of [-1.1, 1.1]) {
      B.g("alu", G.box(2.2, 0.07, 2.1), at(cx, 0, cz)); B.g("cell", G.box(2.08, 0.02, 1.98), at(cx, 0.04, cz));
      for (let k = 1; k < 6; k++) B.g("busbar", G.box(0.012, 0.004, 1.98), at(cx - 1.04 + 2.08 * k / 6, 0.052, cz));              // cell strings
      for (let k = 1; k < 4; k++) B.g("busbar", G.box(2.08, 0.004, 0.012), at(cx, 0.052, cz - 0.99 + 1.98 * k / 4)); }
    for (const z of [-1.2, 1.2]) B.g("alu", G.box(7.0, 0.12, 0.12), at(0, -0.1, z));                                               // purlins
    for (const x of [-3, 0, 3]) { B.g("steel", G.box(0.12, 0.14, 4.3), at(x, -0.23, 0));                                           // rafters, posts, braces, footings
      const f = tilt(0, -0.3, 1.6), r = tilt(0, -0.3, -1.6);
      B.g("steel", strut([x0 + x, 0, f[2]], [x0 + x, f[1], f[2]], 0.14)); B.g("steel", strut([x0 + x, 0, r[2]], [x0 + x, r[1], r[2]], 0.14));
      B.g("steel", strut([x0 + x, 0.25, f[2]], [x0 + x, r[1] - 0.15, r[2]], 0.08));
      B.box("concrete", x0 + x, 0.12, f[2], 0.6, 0.24, 0.6); B.box("concrete", x0 + x, 0.12, r[2], 0.6, 0.24, 0.6); }
    sBox("pv" + i, [x0 - 3.5, 0.9, AZ - 2.1], [x0 + 3.5, 3.0, AZ + 2.1]);
  });
  B.box("steel", -9.6, 0.6, AZ, 0.12, 1.2, 0.12); B.box("shell", -9.6, 1.55, AZ, 0.8, 1.0, 0.35, "combiner");                      // combiner box beside the last table

  // ---------------------------------------------------------------- controller cabinet under a sun shade, and a yard light
  B.box("concrete", CX, 0.2, CZ, 2.4, 0.4, 1.6, "ctrlPlinth"); B.box("shell", CX, 1.7, CZ, 1.8, 2.6, 1.0, "cabinet");
  B.box("dark", CX, 1.75, CZ + 0.51, 1.5, 2.2, 0.02); B.box("chrome", CX + 0.6, 1.7, CZ + 0.54, 0.06, 0.3, 0.05);                  // door and handle
  B.box("steel", CX, 3.3, CZ + 0.15, 2.5, 0.07, 1.7); for (const sx of [-1, 1]) B.box("steel", CX + sx * 1.1, 3.14, CZ - 0.42, 0.07, 0.28, 0.07);
  W.led = part({ color: [0.05, 0.2, 0.08], emis: [0.2, 1.6, 0.5], rough: 0.3, cast: false }, G.box(0.5, 0.28, 0.02), { pos: [CX - 0.3, 2.45, CZ + 0.525] });
  B.g("steel", G.cyl(0.16, 0.1, 8, 12), T3(-9, 4, -10.5)); B.box("steel", -9, 8.05, -10.1, 0.2, 0.1, 1.0); B.box("lampOn", -9, 7.95, -9.75, 0.34, 0.14, 0.5); sCyl("mast", 1, [-9, 4, -10.5], 0.2, 8);
  glow([-9, 7.85, -9.75], [1, 0.78, 0.45], 5.5);

  // ---------------------------------------------------------------- well head with a gate valve on the suction line
  B.g("concrete", G.tubeRing(1.6, 1.2, 1.0, 36), T3(WX, 0.5, PZ)); B.g("steel", G.cyl(1.3, 1.3, 0.08, 36), T3(WX, 1.0, PZ)); sCyl("well", 1, [WX, 0.5, PZ], 1.6, 1.0);
  B.g("cast", G.cyl(0.5, 0.5, 1.0, 20), T3(-0.6, PY, PZ)); B.g("chrome", G.cyl(0.06, 0.06, 1.1, 10), T3(-0.6, PY + 1.0, PZ)); B.g("red", G.torus(0.48, 0.05, 28, 8), T3(-0.6, PY + 1.5, PZ));
  for (let k = 0; k < 4; k++) B.g("red", G.box(0.92, 0.05, 0.06), M.trs([-0.6, PY + 1.5, PZ], [0, PI * k / 4, 0], 1));

  // ---------------------------------------------------------------- the pump on its baseplate
  B.box("concrete", PX, 0.31, PZ, 9.6, 0.5, 4.0, "pumpPlinth"); B.box("dark", PX, 0.66, PZ, 9.0, 0.2, 3.2);
  for (const k in PUMP_MAT) B.g(PUMP_MAT[k], PUMP[k], T3(PX, PY, PZ));
  sCyl("motor", 0, [PX + 2.2, PY, PZ], 1.12, 3.2); sCyl("pumpFrame", 0, [PX - 1.12, PY, PZ], 0.62, 1.25); sCyl("volute", 0, [VX, PY, PZ], 1.42, 1.1);
  W.impeller = part("brass", PUMP.impeller, { pos: [VX, PY, PZ] });

  // ---------------------------------------------------------------- elevated tank on a braced steel stand
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { B.box("steel", TX + sx * 3, 5.95, TZ + sz * 3, 0.4, 11.9, 0.4, "leg" + sx + sz); B.box("concrete", TX + sx * 3, 0.2, TZ + sz * 3, 1.1, 0.4, 1.1); }
  for (const y of [7.0, 11.6]) for (const s of [-1, 1]) { B.box("steel", TX, y, TZ + s * 3, 6, 0.3, 0.3); B.box("steel", TX + s * 3, y, TZ, 0.3, 0.3, 6); }
  for (const [y0, y1] of [[0.4, 7.0], [7.0, 11.6]]) for (const s of [-1, 1]) {
    B.g("steel", strut([TX - 3, y0, TZ + s * 3], [TX + 3, y1, TZ + s * 3], 0.12)); B.g("steel", strut([TX + 3, y0, TZ + s * 3], [TX - 3, y1, TZ + s * 3], 0.12));
    B.g("steel", strut([TX + s * 3, y0, TZ - 3], [TX + s * 3, y1, TZ + 3], 0.12)); B.g("steel", strut([TX + s * 3, y0, TZ + 3], [TX + s * 3, y1, TZ - 3], 0.12)); }
  B.box("steel", TX, TY, TZ, 9.0, 0.2, 9.0, "deck");
  B.g("tank", G.lathe([[0, 0, 1], [4, 0, 1], [4, 0, 1], [4, 5.6], [3.88, 6.0], [3.2, 6.7], [1.8, 7.15], [0, 7.3]], 48), T3(TX, TY + 0.1, TZ)); sCyl("tank", 1, [TX, TY + 3.75, TZ], 4, 7.3);
  for (const y of [0.5, 2.9, 5.3]) B.g("flange", G.tubeRing(4.07, 3.97, 0.18, 48), T3(TX, TY + 0.1 + y, TZ));
  rail([[TX - 4.4, TZ - 4.4], [TX + 4.4, TZ - 4.4], [TX + 4.4, TZ + 4.4], [TX - 4.4, TZ + 4.4], [TX - 4.4, TZ - 4.4]], TY + 0.1);
  for (const dx of [-0.35, 0.35]) B.g("yellow", strut([TX - 2 + dx, 0, TZ + 4.75], [TX - 2 + dx, TY + 1.2, TZ + 4.75], 0.07));        // ladder
  for (let y = 0.4; y < TY + 0.2; y += 0.4) B.box("yellow", TX - 2, y, TZ + 4.75, 0.7, 0.05, 0.05);

  // ---------------------------------------------------------------- date palms in watering basins
  { const trunk = new Geo(), frond = new Geo();
    const palm = (x, z, h, ph) => { const tp = []; for (let i = 0; i <= 6; i++) { const t = i / 6; tp.push([x + Math.sin(ph) * 0.5 * t * t, h * t, z + Math.cos(ph) * 0.5 * t * t]); } trunk.merge(G.tube(tp, (i) => 0.3 - 0.1 * i / 6, 8)); const top = tp[6];
      for (let k = 0; k < 11; k++) { const a = TAU * k / 11 + ph, L = 2.6 + 0.6 * Math.sin(k * 2.3 + ph), d = [Math.cos(a), Math.sin(a)], lift = 0.45 - 0.25 * (k % 3); let prev = null;
        for (let s = 0; s <= 7; s++) { const t = s / 7, c = [top[0] + d[0] * L * t, top[1] + L * (lift * t - 0.85 * t * t), top[2] + d[1] * L * t], w = 0.42 * Math.sin(PI * (0.12 + 0.88 * t)), l = [c[0] - d[1] * w, c[1] - 0.1, c[2] + d[0] * w], r = [c[0] + d[1] * w, c[1] - 0.1, c[2] - d[0] * w];
          if (prev) { frond.quad(prev.l, prev.c, c, l); frond.quad(prev.c, prev.r, r, c); } prev = { c, l, r }; } } };
    PALMS.forEach((x, i) => { const h = 5.2 + rs() * 1.5; palm(x, GZ, h, rs() * 6); sCyl("palm" + i, 1, [x, h / 2, GZ], 0.32, h);
      B.g("basin", G.tubeRing(1.5, 1.25, 0.22, 32), T3(x, 0.11, GZ)); B.g("cable", G.tube([[x, 0.6, DZ], [x, 0.42, GZ - 0.75]], 0.07, 8, true)); });
    B.g("trunk", trunk); B.g("frond", frond); }

  // ---------------------------------------------------------------- pipes and cables: every one registered, then checked against every solid
  const P_ = {};
  P_.suction = pipe("suction", [[WX, 0.9, PZ], [WX, PY, PZ], [PX - 3.68, PY, PZ]], 0.45, "pWater", { a0: ["well"], bend: 0.8 });
  P_.discharge = pipe("discharge", [[VX, PY + 2.0, PZ], [VX, 5.6, PZ], [VX, 5.6, TZ], [TX, 5.6, TZ], [TX, TY + 0.4, TZ]], 0.45, "pWater", { a0: ["volute"], a1: ["tank", "deck"], support: 6 });
  P_.drip = pipe("drip", [[TX + 2, TY + 0.3, TZ], [TX + 2, 0.6, TZ], [30, 0.6, TZ], [30, 0.6, DZ], [57.4, 0.6, DZ]], 0.3, "pCool", { a0: ["tank", "deck"], f1: false, bend: 1.0, support: 7 });
  P_.dc = pipe("dc", [[-9.6, 1.05, AZ], [-9.6, 0.2, AZ], [-9.6, 0.2, CZ], [-6.5, 0.2, CZ], [-6.5, 1.2, CZ], [CX - 0.9, 1.2, CZ]], 0.12, "cable", { a0: ["combiner"], a1: ["cabinet"], bend: 0.35, f0: false, f1: false, collars: 0 });
  P_.ac = pipe("ac", [[CX + 0.9, 1.2, CZ], [-3.2, 1.2, CZ], [-3.2, 0.2, CZ], [-3.2, 0.2, PZ - 2.6], [PX + 2.2, 0.2, PZ - 2.6], [PX + 2.2, PY + 1.34, PZ - 2.6], [PX + 2.2, PY + 1.34, PZ - 0.45]], 0.12, "cable", { a0: ["cabinet"], bend: 0.35, f0: false, f1: false, collars: 0 });
  B.g("pCool", G.cyl(0.36, 0.36, 0.12, 16), M.align([57.4, 0.6, DZ], [1, 0, 0]));                                                  // end cap of the drip main

  // ---------------------------------------------------------------- what moves on the site
  flow("dc", P_.dc, [1.0, 0.85, 0.35], 9, 0.3, 0.9, { size: 0.42, hero: [1, 0.92, 0.5] });
  flow("ac", P_.ac, [1.0, 0.7, 0.3], 9, 0.3, 0.9, { size: 0.42, hero: [1, 0.92, 0.5] });
  flow("suction", P_.suction, [0.35, 0.75, 1.0], 4, 0.75); flow("discharge", P_.discharge, [0.3, 0.65, 1.0], 5, 0.75); flow("drip", P_.drip, [0.3, 0.9, 0.85], 3, 0.6);
  journey("power", [["dc", 0, 1], ["ac", 0, 1]]);
  journey("lift", [["suction", 0, 1], ["discharge", 0, 0.45]]);
  journey("store", [["discharge", 0.35, 1]]);
  journey("water", [["drip", 0, 1]]);
  journey("all", [["suction", 0, 1], ["discharge", 0, 1], ["drip", 0, 1]], { speed: 0.07 });
  // drops falling from the emitters into the basins: short lives, so several whole lives fit one loop
  emitter(60, 0.9, (t, q) => { const x = PALMS[Math.floor(q[0] * PALMS.length)]; PF.add([x + (q[1] - 0.5) * 0.3, 0.42 - 0.3 * t * t, GZ - 0.75 + (q[2] - 0.5) * 0.3], [0.55, 0.85, 1.0, 0.75 * (1 - t)], 0.2, 0.2); });
  // dust drifting in the evening light: a life much longer than the loop, so the stage chains several sprites on one track
  emitter(90, 24, (t, q) => PS.add([-34 + q[0] * 90 + t * 9, 1 + q[1] * 9 + Math.sin(t * 6 + q[3] * 6) * 0.6, -14 + q[2] * 30], [0.95, 0.72, 0.5, 0.05 * Math.sin(PI * t)], 1.4 + q[3] * 1.6));
  onFrame((c) => {
    const rpm = c.ease("rpm", c.num("rpm", 0.6));                  // data-rpm on the slide: 0..1
    W.impeller.rot = [c.spin("impeller", 3 + 11 * rpm), 0, 0];
    const b = 0.65 + 0.35 * c.osc(2.6); W.led.emis = [0.2 * b, 1.6 * b, 0.5 * b];
  });

  label("Solar array", [-22, 3.4, AZ]); label("Controller", [CX, 3.5, CZ]); label("Well", [WX, 1.2, PZ]); label("Pump", [PX - 0.6, PY + 1.6, PZ]);
  label("Motor", [PX + 2.2, PY + 1.7, PZ]); label("Impeller", [VX, PY + 0.2, PZ + 0.7]); label("Tank", [TX, TY + 7.6, TZ]); label("Drip line", [44, 0.95, DZ]); label("Date palms", [45.4, 6.9, GZ]);
  label("1", [-1.9, PY, PZ + 0.5]); label("2", [VX, 5.6, -1.5]); label("3", [TX + 2, 5, TZ + 0.4]);

  cam("site", { eye: [15, 28, 78], target: [15, -3, -2], fov: 40 });
  cam("cover", { eye: [-40, 8.5, 25], target: [-4, 5, -4], fov: 40 });
  cam("array", { eye: [-33, 6.5, 13], target: [-20, 2, -4], fov: 40 });
  cam("controller", { eye: [-11.5, 4.6, 5], target: [-4.6, 2, -6], fov: 40 });
  cam("pump", { eye: [PX - 10, 8.5, PZ + 15], target: [PX - 1, 2.4, PZ], fov: 40 });
  cam("tank", { eye: [5, 9.5, 25], target: [20, 9.5, -4], fov: 44 });
  cam("palms", { eye: [30, 5.5, 25], target: [45, 3, 7], fov: 42 });

  // ================================================================ scene "show": the pump on a plinth, in studio light
  const show = STAGE.studio("show", { long: 5.2, period: 12 });   // floor, a long plinth edged in brass, a spotlight cone, shadows
  W.rig = add(show.root, { pos: [0.4, 1.2 + 1.54, 0] });            // feet stand on the plinth
  // [geometry, material, order along the shaft]: the order decides how far a part travels when the unit is pulled apart
  W.show = [["volute", -2], ["window", -2], ["impeller", -1], ["frame", 0], ["shaft", 0], ["coupling", 1], ["guard", 1], ["motor", 2], ["motorEnd", 2]].map(([k, order]) => {
    const n = part(k === "impeller" ? { color: [0.86, 0.66, 0.32], metal: 0.55, rough: 0.34 } : PUMP_MAT[k], PUMP[k], { parent: W.rig, pos: [k === "impeller" ? -2.45 : 0, 0, 0] }); n.x0 = n.pos[0]; n.order = order; n.key = k; return n; });
  onFrame((c) => {
    const ex = (0.5 + 0.5 * c.osc(0.7)) * c.num("explode", 0);       // breathes between assembled and pulled apart
    W.show.forEach((n) => { n.pos = [n.x0 + n.order * ex * 0.95, 0, 0]; if (n.key === "impeller" || n.key === "shaft" || n.key === "coupling") n.rot = [c.spin("show", 2.4), 0, 0]; });
    W.rig.rot = [0, -0.35 + 0.28 * c.osc(0.22), 0];
  });
  emitter(120, 30, (t, q) => PS.add([(q[0] - 0.5) * 30, 0.5 + q[1] * 20, (q[2] - 0.5) * 22 - 5], [0.9, 0.8, 0.6, 0.05 * Math.sin(PI * t)], 0.5 + 0.3 * q[3])); // dust in the spotlight
  cam("bench", (d) => { const z = +d.camz || 1; return { eye: [0, 8.2 * z, 17 * z], target: [0, 3.3, 0], fov: 40 }; });
})();
