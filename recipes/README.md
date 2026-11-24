# Recipes: the steam power plant scene

`steam-plant-scene.js` is the complete scene of the deck this skill grew out of (26 slides, 98 solids and 14 pipes
with 0 clashes, about 6 ms a frame at 2160×1215). **Copy parts from it; do not copy its structure.** It is one file
that holds its own batch, registry, cameras and frame loop, all of which now live in `engine/stage.js`, and it does
not run beside `stage.js`.

**If `steam-plant-scene.js` is not beside this file,** your copy came from the public repository. The scene is a
student team's own presentation and is not published. Use the two examples as the parts library instead: the pump,
the tank on its braced stand, the PV tables and the palms in `example/scene.js`; the belt, rollers, servo arm and
bins in `example-conveyor/scene.js`.

To reuse a part: copy its block, replace the plant's coordinates by your own constants, and change
`add(plant, {...})` to `part(...)`, `GLOW.push({ p, c, s })` to `glow(p, c, s)`, and `flow(name, pts, col, v, bias)`
stays as it is. `B`, `MAT`, `G`, `M`, `sBox`, `sCyl`, `allow`, `pipe`, `rail`, `strut`, `alongX` mean the same.
Materials the stage does not carry (`tubeHot`, `genGreen`, `xfGrey`, `ceramic`, `dome`, …) are in its `MAT` table
at line 59: copy the ones you use into `STAGE.MAT`.

| Line | Part | Worth copying for |
|---|---|---|
| 21 | `bladeRow` | A ring of cambered, tapered, twisted blades around a shaft: turbines, fans, compressors. |
| 41 | `turbineStage` | A rotor drum with blade rows and shrouds, and the fixed nozzle rings between them. |
| 169 | ground, river, paving, roads, far ridge | Water with banks, lane markings, the distant skyline. |
| 182 | river intake | A concrete structure with a bar screen. |
| 187 | feed pump | Motor with fins, coupling and guard, bearing frame, volute half in glass, impeller with curved vanes. |
| 209 | boiler | Tube walls, headers, a drum, cladding with one wall left open, a steel frame with bracing and handrails, serpentine tube banks that glow. |
| 257 | pipe rack | Portal frames carrying pipes. |
| 263 | turbine deck | Casings split on the centre line with bolted joints, bearing pedestals, a generator with cooling ribs, a transformer with radiators and bushings. |
| 338 | condenser, cooling tower | A shell with a glass front and a tube bundle; a hyperboloid tower from a lathe profile. |
| 359 | the process pipes | Routing with allowed ends, a tee, and `supports` (now `support:` in `pipe`). |
| 382 | transmission line | Lattice towers from struts, insulator strings, sagging conductors. |
| 406 | site lighting | Masts with lamps and glow sprites. |
| 410 | the town | Houses whose windows light up (`tex: 5`), a mosque with a dome and minarets, street lamps, date palms. |
| 450 | showroom | Real printed parts on plinths under a spotlight, stacked and pulled apart; `decodePart` (line 453) became `STAGE.stl`. |
| 493 | `layAxial` | Laying parts along their own shaft in assembly order, with a gap that breathes. |
| 572 | animation loop | How each motion was made to repeat exactly (now `c.spin`, `c.osc`, `emitter`). |
