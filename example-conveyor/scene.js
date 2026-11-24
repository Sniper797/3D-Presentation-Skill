/* scene.js: a bench-top conveyor that sorts cans by colour.
   Feed hood -> belt (DC gear motor on the drive roller) -> colour sensor on a bridge -> servo arm that sweeps the red
   cans into a side bin -> the rest ride on into the bin at the end of the belt.
   One unit is 2 cm. One scene, in studio light. Every moving thing is a function of one phase (c.cycle), so it repeats.
   The pattern for solid parts that travel: each can's place is computed from the phase, never stepped frame by frame,
   and a can that has finished is hidden until its next turn. This deck was written from the skill's text alone, as its test. */
(function () {
  "use strict";
  const { M, G, Geo, T3, TAU, PI, MAT, alongZ, part, add, pipe, flow, glow, label, cam, onFrame, sBox, sCyl, plastic } = STAGE;
  const W = {};                                          // the parts that move

  // ---------------------------------------------------------------- the deck's own materials
  MAT.wood = { color: [0.62, 0.5, 0.33], rough: 0.85, grain: [0.22, 2.5] };
  MAT.cable = { color: [0.08, 0.08, 0.09], rough: 0.7 };
  MAT.beltMark = { color: [0.17, 0.17, 0.18], rough: 0.9, cast: false };
  MAT.frame = { color: [0.6, 0.62, 0.65], metal: 0.25, rough: 0.5, grain: [0.05, 2] };   // brushed aluminium; a full metal goes black in the studio
  MAT.canEnd = { color: [0.74, 0.75, 0.77], metal: 0.3, rough: 0.45 };
  MAT.canRed = { color: [0.74, 0.1, 0.07], metal: 0.55, rough: 0.34 };
  MAT.canBlue = { color: [0.1, 0.27, 0.6], metal: 0.55, rough: 0.34 };
  MAT.canGreen = { color: [0.12, 0.46, 0.22], metal: 0.55, rough: 0.34 };
  MAT.canGold = { color: [0.78, 0.6, 0.2], metal: 0.7, rough: 0.34 };
  MAT.bin = plastic([0.62, 0.64, 0.66], 0.06);
  MAT.armPrint = plastic([0.88, 0.62, 0.1], 0.05);
  MAT.tagRed = { color: [0.78, 0.1, 0.07], rough: 0.5 };
  MAT.tagGrey = { color: [0.2, 0.22, 0.26], rough: 0.5 };

  // ================================================================ constants (units; 1 unit = 2 cm)
  const Y0 = 1.5;                                        // top of the base board
  const CYC = 9, NC = 6, VB = 4;                         // one cycle: 6 cans in 9 s; belt speed 4 units/s = 8 cm/s
  const BW = 4.4, XR = 11.5;                             // belt width, roller axes at x = -XR and +XR
  const RB = VB * CYC / (TAU * 7), BT = 0.1, RR = RB - BT; // belt radius on the rollers: exactly 7 roller turns a cycle
  const YB = 5.2, YA = YB - RB;                          // top of the belt, roller axis
  const ZP = BW / 2 + 0.25, ZE = BW / 2 + 0.4;           // side plates (0.3 thick), their outer face
  const CR = 1.05, CH = 2.5, HH = CH / 2, YC = YB + HH;  // can radius, height; centre height of a can on the belt
  const HX0 = -12.8, HX1 = -8, XS0 = -11.2;              // feed hood back and mouth; where a can starts, deep inside it
  const XS = -3;                                         // colour sensor
  const PX = 1.4, PZ = -2.75, PY = 7.05, LA = 6.4;       // servo shaft, height of the horn, arm length
  const D0 = 1.6, THMAX = 1.2, TS = 0.55, TD = 0.1, TR = 0.45; // the swing starts when the can is D0 past the shaft
  const RH = CR + 0.15;                                  // can radius + half the arm thickness
  const CX = -5.5, CZ = 6.2;                             // controller board, in front of the conveyor
  const YF = Y0 + 0.15, GRAV = 490;                      // floor of the bins; gravity, 9.8 m/s2 in these units
  const HIDE = null;                                     // a can waiting for its next turn is not drawn
  const SBX = [2.6, 9.0], SBZ = [ZE + 0.25, 8.0];        // side bin, inside
  const EBX = [12.6, 17.6], EBZ = 2.8;                   // end bin, inside

  // ================================================================ how a can leaves the belt
  const sm = (u) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u);
  // It leans over an edge (a pivot), lets go, falls, lands on its side and slides to rest.
  // Returns at(t) -> [distance from the pivot, height of the centre, lean angle]; tTop: when it reaches the can below.
  function tipFall(L, v0, acc, beta1, yPivot, slide) {
    const dt = 1 / 480, tab = [], ext = (b) => HH * Math.abs(Math.cos(b)) + CR * Math.abs(Math.sin(b));
    let beta = 0, w = v0 / L, tTop = -1;
    while (beta < beta1) { tab.push([L * Math.sin(beta), yPivot + L * Math.cos(beta), beta]); w += acc * dt; beta += w * dt; }
    let s = L * Math.sin(beta), y = yPivot + L * Math.cos(beta), vy = -L * w * Math.sin(beta); const vs = L * w * Math.cos(beta);
    while (y - ext(beta) > YF) { if (tTop < 0 && y - ext(beta) < YF + 2 * CR + 0.05) tTop = tab.length * dt;
      tab.push([s, y, beta]); vy -= GRAV * dt; s += vs * dt; y += vy * dt; beta = Math.min(PI / 2, beta + w * dt); }
    const tLand = tab.length * dt, n = Math.round(0.12 / dt), b0 = beta, y0 = y;
    for (let k = 1; k <= n; k++) { const u = k / n, e = u * (2 - u); tab.push([s + slide * e, y0 + (YF + CR - y0) * e, b0 + (PI / 2 - b0) * e]); }
    const last = tab.length - 1;
    return { tTop, tLand, rest: tab[last], at: (t) => { const k = Math.min(last, Math.max(0, t / dt)), i = Math.floor(k), f = k - i, a = tab[i], b = tab[Math.min(last, i + 1)];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; } };
  }
  // the arm: angle against time since the swing began, and where it holds the can it touches (never inside it)
  const armAt = (t) => t <= 0 ? 0 : t < TS ? THMAX * sm(t / TS) : t < TS + TD ? THMAX : THMAX * (1 - sm((t - TS - TD) / TR));
  const pushZ = (t) => { const th = armAt(t), d = D0 + VB * t; return Math.max(0, PZ + (RH + d * Math.sin(th)) / Math.cos(th)); };
  let T_EDGE = 0; while (pushZ(T_EDGE) < ZE) T_EDGE += 1 / 480;                      // the can's centre passes the edge of the frame
  const V_EDGE = (pushZ(T_EDGE) - pushZ(T_EDGE - 1 / 480)) * 480, X_EDGE = PX + D0 + VB * T_EDGE;
  const END = tipFall(RB + HH, VB, 12, 0.6, YA, 0.8);                                // over the end roller
  const SIDE = tipFall(HH, V_EDGE, 12, 0.6, YB, 0.5);                                // over the side of the frame
  const T_SENSE = (XS - XS0) / VB, T_PUSH = (PX + D0 - XS0) / VB, T_END = (XR - XS0) / VB;
  const GAP = CYC * 2 / NC;                                                          // the next can for the same bin comes 3 s later
  const REST_END = Math.min(GAP + END.tTop, CYC - T_END), REST_SIDE = GAP + SIDE.tTop;

  // ================================================================ the scene
  const sc = STAGE.scene("bench", { env: STAGE.ENV.studio, period: CYC, shadow: () => ({ c: [2, 3, 0.5], r: 26 }) }), B = sc.B;
  B.g("floor", G.cyl(90, 90, 0.4, 72), T3(0, -0.2, 0));
  B.box("plinth", 2, 0.6, 0.75, 42, 1.2, 24, "table"); B.box("trim", 2, 1.04, 0.75, 42.1, 0.1, 24.1);
  B.box("wood", 2, Y0 - 0.15, 0.75, 34, 0.3, 17.5, "base");

  // ---------------------------------------------------------------- frame: two side plates on four legs
  for (const s of [-1, 1]) {
    B.box("frame", -0.2, (YA - 0.9 + YB) / 2, s * ZP, 25.2, YB - YA + 0.9, 0.3, s > 0 ? "plateN" : "plateF");
    for (const x of [-10, 10]) { B.box("frame", x, (Y0 + YA - 0.9) / 2, s * ZP, 0.5, YA - 0.9 - Y0, 0.5, "leg" + x + s); B.box("dark", x, Y0 + 0.05, s * ZP, 1.0, 0.1, 1.0); }
    for (const x of [-XR, XR]) B.box("cast", x, YA, s * (ZE + 0.125), 1.0, 1.0, 0.25);                      // bearing blocks
  }
  for (const x of [-10, 10]) B.box("frame", x, 2.5, 0, 0.3, 0.3, 2 * ZP - 0.5);                               // ties between the legs
  B.box("steel", 0, YA, 0, 2 * XR - 2 * RB - 0.3, 0.2, BW - 0.2);                                           // slider bed under the top run

  // ---------------------------------------------------------------- belt: two runs and the wraps round the rollers
  B.box("rubber", 0, YB - BT / 2, 0, 2 * XR, BT, BW); B.box("rubber", 0, YA - RB + BT / 2, 0, 2 * XR, BT, BW);
  for (const x of [-XR, XR]) B.g("rubber", alongZ(G.tubeRing(RB, RR, BW, 28)), T3(x, YA, 0));
  { const g = new Geo(); for (let k = 0; k < 8; k++) g.merge(G.box(0.12, 0.012, BW - 0.3), T3(XR - 24 + 3 * k, YB + 0.008, 0)); W.marks = part("beltMark", g, {}); } // marks printed on the belt, every 3 units
  const roller = (drive) => { const g = new Geo().merge(alongZ(G.cyl(RR - 0.02, RR - 0.02, BW - 0.1, 24)));
    const z0 = -(ZE + 0.5), z1 = drive ? ZE + 1.15 : ZE + 0.5; g.merge(alongZ(G.cyl(0.16, 0.16, z1 - z0, 14)), T3(0, 0, (z0 + z1) / 2));
    g.merge(alongZ(G.cyl(0.3, 0.3, 0.25, 16)), T3(0, 0, z0 + 0.1)); g.merge(G.box(0.12, 0.14, 0.12), T3(0, 0.33, z0 + 0.1));           // collar and its set screw
    if (drive) { g.merge(alongZ(G.cyl(0.36, 0.36, 0.8, 18)), T3(0, 0, ZE + 0.75)); g.merge(G.box(0.14, 0.16, 0.5), T3(0, 0.38, ZE + 0.75)); } // coupling to the gearbox
    else { g.merge(alongZ(G.cyl(0.3, 0.3, 0.25, 16)), T3(0, 0, z1 - 0.1)); g.merge(G.box(0.12, 0.14, 0.12), T3(0, 0.33, z1 - 0.1)); }
    return g; };
  W.idler = part("chrome", roller(false), { pos: [-XR, YA, 0] }); W.drive = part("chrome", roller(true), { pos: [XR, YA, 0] });

  // ---------------------------------------------------------------- guide rails; the near one is open where the red cans leave
  const railRun = (x0, x1, z) => { B.box("frame", (x0 + x1) / 2, YB + 0.3, z, x1 - x0, 0.3, 0.2); for (let x = x0 + 0.4; x < x1; x += 3.4) B.box("frame", x, YB + 0.08, z, 0.2, 0.16, 0.2); };
  railRun(HX1, XR - 0.3, -(BW / 2 + 0.15)); railRun(HX1, PX + 0.6, BW / 2 + 0.15); railRun(SBX[1] + 0.3, XR - 0.3, BW / 2 + 0.15);

  // ---------------------------------------------------------------- DC gear motor on the drive roller, held off the plate by four standoffs
  for (const dx of [-0.62, 0.62]) for (const dy of [-0.62, 0.62]) B.cyl("chrome", 2, XR + dx, YA + dy, ZE + 0.575, 0.09, 0.09, 1.15, 10);
  B.box("cast", XR, YA, ZE + 1.7, 1.5, 1.5, 1.1); B.cyl("motor", 2, XR, YA, ZE + 3.4, 0.62, 0.62, 2.3, 28); B.cyl("dark", 2, XR, YA, ZE + 4.6, 0.5, 0.5, 0.1, 20);
  sCyl("motor", 2, [XR, YA, ZE + 2.9], 0.75, 3.5);

  // ---------------------------------------------------------------- feed hood: the cans come out of its mouth
  { const hy = (YB + 8.6) / 2, hh = 8.6 - YB, mw = CR + 0.25, mh = CH + 0.35;
    for (const s of [-1, 1]) { B.box("shell", (HX0 + HX1) / 2, hy, s * ZP, HX1 - HX0, hh, 0.3); B.box("shell", HX1 - 0.075, hy, s * (mw + ZP + 0.15) / 2, 0.15, hh, ZP + 0.15 - mw); }
    B.box("shell", (HX0 + HX1) / 2, 8.675, 0, HX1 - HX0, 0.15, 2 * ZP + 0.3); B.box("shell", HX0 + 0.075, hy, 0, 0.15, hh, 2 * ZP - 0.3);
    B.box("shell", HX1 - 0.075, (YB + mh + 8.6) / 2, 0, 0.15, 8.6 - YB - mh, 2 * mw); B.box("yellow", HX1 + 0.01, YB + mh + 0.12, 0, 0.02, 0.24, 2 * mw);   // lintel with a warning stripe
    sBox("hood", [HX0, YB, -ZE], [HX1, 8.75, ZE]); }

  // ---------------------------------------------------------------- colour sensor on a bridge over the belt
  for (const s of [-1, 1]) B.box("frame", XS, (YB + 9) / 2, s * ZP, 0.3, 9 - YB, 0.3);
  B.box("frame", XS, 9.15, 0, 0.4, 0.3, 2 * ZP + 0.3); sBox("bridge", [XS - 0.2, YB, -(ZP + 0.15)], [XS + 0.2, 9.3, ZP + 0.15]);
  for (const s of [-1, 1]) B.cyl("brass", 1, XS, 8.9, s * 0.45, 0.07, 0.07, 0.2, 8);
  B.box("pcb", XS, 8.75, 0, 1.5, 0.1, 1.3); B.box("dark", XS, 8.65, 0, 0.42, 0.1, 0.42);                    // the board, face down, and the sensor chip
  for (const s of [-1, 1]) B.box("lampOn", XS + s * 0.45, 8.66, 0, 0.16, 0.08, 0.16);                        // two white LEDs light the can
  glow([XS, 8.5, 0], [1, 0.97, 0.9], 1.0);
  const st = { seen: 0, act: 0 };                                                                             // set every frame, read by the lights and the signal
  glow([XS, 8.45, 0], [1, 0.12, 0.08], 2.6, () => st.seen);                                                   // lights up while a red can is under the sensor

  // ---------------------------------------------------------------- servo, hung over the far rail, and its arm
  B.box("frame", PX - 0.5, (Y0 + 9.1) / 2, -3.8, 0.5, 9.1 - Y0, 0.5, "servoPost"); B.box("frame", PX - 0.02, Y0 + 0.2, -3.8, 0.45, 0.4, 0.5);
  B.box("frame", PX - 0.5, 9.2, -3.125, 2.4, 0.2, 1.85);                                                        // bracket plate over the servo
  B.box("dark", PX - 0.5, 8.15, PZ, 2.0, 1.9, 1.0); B.box("dark", PX - 0.5, 8.6, PZ, 2.7, 0.12, 1.0); sBox("servo", [PX - 1.5, 7.2, PZ - 0.5], [PX + 0.5, 9.1, PZ + 0.5]);
  B.cyl("chrome", 1, PX, 7.15, PZ, 0.3, 0.3, 0.1, 16);
  { const g = new Geo().merge(G.cyl(0.42, 0.42, 0.3, 20), T3(0, -0.05, 0)).merge(G.box(LA + 0.5, 1.2, 0.3), T3(LA / 2 - 0.25, -0.7, 0)).merge(G.box(LA - 1, 0.12, 0.5), T3(LA / 2, -0.16, 0));
    W.arm = part("armPrint", g, { pos: [PX, PY, PZ] }); }

  // ---------------------------------------------------------------- controller board on standoffs
  B.box("pcb", CX, Y0 + 0.45, CZ, 3.6, 0.1, 2.6); sBox("ctrl", [CX - 1.8, Y0, CZ - 1.3], [CX + 1.8, Y0 + 0.9, CZ + 1.3]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl("brass", 1, CX + sx * 1.6, Y0 + 0.2, CZ + sz * 1.1, 0.09, 0.09, 0.4, 8);
  B.box("dark", CX - 0.2, Y0 + 0.6, CZ, 1.5, 0.2, 0.45); B.box("chrome", CX - 1.6, Y0 + 0.66, CZ + 0.5, 0.6, 0.32, 0.5);                // processor, USB socket
  for (const sz of [-1, 1]) B.box("dark", CX, Y0 + 0.62, CZ + sz * 1.12, 2.6, 0.24, 0.12);                                               // pin headers
  B.box("alu", CX + 1.1, Y0 + 0.72, CZ - 0.45, 0.7, 0.45, 0.7);                                                                        // heat sink of the motor driver
  B.box("dark", CX + 1.72, Y0 + 0.35, CZ + 0.2, 0.3, 0.7, 2.0);                                                                       // terminal strip
  W.led = part({ color: [0.05, 0.2, 0.08], emis: [0.2, 1.6, 0.5], rough: 0.3, cast: false }, G.box(0.14, 0.08, 0.14), { pos: [CX + 0.9, Y0 + 0.54, CZ + 0.6] });

  // ---------------------------------------------------------------- the two bins, printed, each with a low wall on the conveyor side
  const lying = (mat, x, z, alongZaxis) => { const m = M.trs([x, YF + CR, z], alongZaxis ? [PI / 2, 0, 0] : [0, 0, PI / 2], 1); B.g(mat, CAN.sleeve, m); B.g("canEnd", CAN.ends, m); };
  const CAN = { sleeve: G.cyl(CR, CR, CH - 0.4, 28, false), ends: new Geo().merge(G.cyl(CR - 0.03, CR - 0.03, CH - 0.06, 28)).merge(G.tubeRing(CR, CR - 0.12, 0.1, 28), T3(0, HH - 0.05, 0)).merge(G.tubeRing(CR, CR - 0.12, 0.1, 28), T3(0, -HH + 0.05, 0)) };
  { const [x0, x1] = SBX, [z0, z1] = SBZ, t = 0.15, top = 4.4, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;       // side bin, for the red cans
    B.box("bin", cx, Y0 + t / 2, cz, x1 - x0 + 2 * t, t, z1 - z0 + 2 * t); B.box("bin", cx, (Y0 + 3.3) / 2, z0 - t / 2, x1 - x0 + 2 * t, 3.3 - Y0, t);
    B.box("bin", cx, (Y0 + top) / 2, z1 + t / 2, x1 - x0 + 2 * t, top - Y0, t); for (const x of [x0 - t / 2, x1 + t / 2]) B.box("bin", x, (Y0 + top) / 2, cz, t, top - Y0, z1 - z0);
    B.box("tagRed", cx, 3.2, z1 + t + 0.01, 2.4, 1.1, 0.02); sBox("binSide", [x0 - t, Y0, z0 - t], [x1 + t, top, z1 + t]);
    lying("canRed", 7.55, 4.3, true); lying("canRed", 7.65, 6.85, false); }
  { const [x0, x1] = EBX, zz = EBZ, t = 0.15, top = 4.4, cx = (x0 + x1) / 2;                                   // end bin, for the rest
    B.box("bin", cx, Y0 + t / 2, 0, x1 - x0 + 2 * t, t, 2 * zz + 2 * t); B.box("bin", x0 - t / 2, Y0 + 0.3, 0, t, 0.6, 2 * zz + 2 * t);
    B.box("bin", x1 + t / 2, (Y0 + top) / 2, 0, t, top - Y0, 2 * zz + 2 * t); for (const s of [-1, 1]) B.box("bin", cx, (Y0 + top) / 2, s * (zz + t / 2), x1 - x0, top - Y0, t);
    B.box("tagGrey", cx, 3.2, zz + t + 0.01, 2.4, 1.1, 0.02); sBox("binEnd", [x0 - t, Y0, -zz - t], [x1 + t, top, zz + t]);
    lying("canBlue", 16.5, -1.45, true);
    B.g("canGreen", CAN.sleeve, T3(16.45, YF + HH, 1.6)); B.g("canEnd", CAN.ends, T3(16.45, YF + HH, 1.6)); }

  // ---------------------------------------------------------------- the cans on the belt: red, blue, red, green, red, gold
  W.cans = ["canRed", "canBlue", "canRed", "canGreen", "canRed", "canGold"].map((m) => {
    const n = add(sc.root, { visible: false }); part(m, CAN.sleeve, { parent: n }); part("canEnd", CAN.ends, { parent: n }); return { n, red: m === "canRed" }; });

  // ---------------------------------------------------------------- cables: sensor -> controller -> servo, controller -> motor
  const cab = { bend: 0.35, f0: false, f1: false, collars: 0 }, yc = Y0 + 0.1, P_ = {};
  P_.sig = pipe("sig", [[XS, 9.39, 0.9], [XS, 9.39, ZP + 0.24], [XS, yc, ZP + 0.24], [XS, yc, CZ - 0.5], [CX + 1.7, yc, CZ - 0.5]], 0.09, "cable", Object.assign({ a0: ["bridge"], a1: ["ctrl"] }, cab));
  P_.srv = pipe("srv", [[CX + 1.7, yc, CZ + 0.2], [PX - 0.87, yc, CZ + 0.2], [PX - 0.87, yc, -3.8], [PX - 0.87, 8.3, -3.8], [PX - 0.87, 8.3, PZ - 0.5]], 0.09, "cable", Object.assign({ a0: ["ctrl"], a1: ["servo"] }, cab));
  P_.pwr = pipe("pwr", [[CX + 1.7, yc, CZ + 0.9], [-2, yc, CZ + 0.9], [-2, yc, 8.8], [XR, yc, 8.8], [XR, yc, ZE + 5.2], [XR, YA, ZE + 5.2], [XR, YA, ZE + 4.6]], 0.09, "cable", Object.assign({ a0: ["ctrl"], a1: ["motor"] }, cab));
  flow("sig", P_.sig, [0.45, 0.85, 1.0], 6, 0.3, 0.9, { size: 0.18 });
  flow("srv", P_.srv, [1.0, 0.45, 0.25], 6, 0.3, 0.9, { size: 0.18, on: () => st.act });   // only between "red seen" and the end of the swing
  flow("pwr", P_.pwr, [1.0, 0.85, 0.35], 6, 0.3, 0.9, { size: 0.18 });

  // ---------------------------------------------------------------- one clock for everything that moves
  onFrame((c) => {
    const ph = c.cycle("cycle", CYC), run = ph * CYC * VB;                                 // ph: 0..1 once per cycle; run: belt travel since the cycle began
    let arm = 0, seen = 0, act = 0;
    W.cans.forEach((cn, i) => {
      const t = ((ph + i / NC) % 1) * CYC, x = XS0 + VB * t; let p = [x, YC, 0], r = [0, 0, 0];
      if (cn.red) { const tp = t - T_PUSH, tf = tp - T_EDGE;
        if (tf >= REST_SIDE) p = HIDE;
        else if (tf >= 0) { const f = SIDE.at(tf); p = [X_EDGE + VB * Math.min(tf, SIDE.tLand), f[1], ZE + f[0]]; r = [f[2], 0, 0]; }
        else if (tp > 0) p = [x, YC, pushZ(tp)];
        if (tp > 0 && tp < TS + TD + TR) arm = armAt(tp);
        seen = Math.max(seen, sm(1 - Math.abs(x - XS) / 1.4)); if (t > T_SENSE && tp < TS) act = 1;
      } else { const te = t - T_END;
        if (te >= REST_END) p = HIDE;
        else if (te >= 0) { const f = END.at(te); p = [XR + f[0], f[1], 0]; r = [0, 0, -f[2]]; } }
      cn.n.visible = p !== HIDE; if (p !== HIDE) { cn.n.pos = p; cn.n.rot = r; }
    });
    W.arm.rot = [0, -arm, 0];
    W.marks.pos = [run % 3, 0, 0];
    W.idler.rot = W.drive.rot = [0, 0, -run / RB];
    st.seen = seen; st.act = act;
    const b = 0.65 + 0.35 * c.osc(2.6); W.led.emis = [0.2 * b, 1.6 * b, 0.5 * b];
  });

  // ---------------------------------------------------------------- callouts and cameras, all on the near side.
  // A can first appears 3.2 units inside the hood: keep every camera less than about 45 degrees downstream of its mouth, so nobody sees that.
  label("Feed hood", [(HX0 + HX1) / 2, 9.0, 0]); label("Colour sensor", [XS, 9.6, 0]); label("Controller", [CX, Y0 + 1.2, CZ]);
  label("Servo arm", [PX - 0.5, 9.6, PZ]); label("DC gear motor", [XR, YA + 0.9, ZE + 3.4]); label("Red bin", [(SBX[0] + SBX[1]) / 2, 4.6, SBZ[1]]); label("End bin", [(EBX[0] + EBX[1]) / 2, 4.6, EBZ]);
  cam("whole", { eye: [3, 15, 36], target: [2.5, 1.5, 1], fov: 40 });
  cam("cover", { eye: [29, 13.5, 37], target: [3, 4.2, 0], fov: 40 });
  cam("sensor", { eye: [-12.5, 12.5, 18], target: [-4.5, 5.2, 1.5], fov: 40 });
  cam("arm", { eye: [PX + 9, 14, 21], target: [PX + 3, 5.4, 1], fov: 38 });
  cam("end", { eye: [XR + 7, 9, 15], target: [XR + 2.5, 4, 0], fov: 38 });
})();
