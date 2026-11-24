/* mini3d.js — a small self-contained WebGL 1 engine (no external libraries, works offline).
   Meshes (primitives + binary STL), a scene graph, metal/roughness shading with one shadow-mapped key light,
   a fill light, a procedural sky that is also the reflection environment, procedural surface detail
   (concrete, water, cladding, print layers, lit windows), fog, transparent meshes and soft particles. */
(function (root) {
  "use strict";
  // ------------------------------------------------------------------ math
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  };
  const M = {
    ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    mul(a, b) { // column-major a*b
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
      }
      return o;
    },
    persp(fovDeg, asp, n, f) {
      const t = 1 / Math.tan(fovDeg * Math.PI / 360), o = new Float32Array(16);
      o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
    },
    ortho(l, r, b, t, n, f) {
      const o = new Float32Array(16);
      o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o;
    },
    lookAt(e, c, up) {
      const z = V.norm(V.sub(e, c)), x = V.norm(V.cross(up, z)), y = V.cross(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -V.dot(x, e), -V.dot(y, e), -V.dot(z, e), 1]);
    },
    trs(p, r, s) { // translate * Ry * Rx * Rz * scale (Euler radians)
      const [cx, sx, cy, sy, cz, sz] = [Math.cos(r[0]), Math.sin(r[0]), Math.cos(r[1]), Math.sin(r[1]), Math.cos(r[2]), Math.sin(r[2])];
      // R = Ry * Rx * Rz
      const m00 = cy * cz + sy * sx * sz, m01 = -cy * sz + sy * sx * cz, m02 = sy * cx;
      const m10 = cx * sz, m11 = cx * cz, m12 = -sx;
      const m20 = -sy * cz + cy * sx * sz, m21 = sy * sz + cy * sx * cz, m22 = cy * cx;
      const S = Array.isArray(s) ? s : [s, s, s];
      return new Float32Array([m00 * S[0], m10 * S[0], m20 * S[0], 0, m01 * S[1], m11 * S[1], m21 * S[1], 0,
        m02 * S[2], m12 * S[2], m22 * S[2], 0, p[0], p[1], p[2], 1]);
    },
    align(p, dir) { // rotation that takes +Y onto dir, then translation to p
      const d = V.norm(dir), ax = V.cross([0, 1, 0], d), s = V.len(ax), c = d[1];
      if (s < 1e-6) { const f = c < 0 ? -1 : 1; return new Float32Array([1, 0, 0, 0, 0, f, 0, 0, 0, 0, f, 0, p[0], p[1], p[2], 1]); }
      const q = [ax[0] / s, ax[1] / s, ax[2] / s], C = 1 - c;
      return new Float32Array([c + q[0] * q[0] * C, q[1] * q[0] * C + q[2] * s, q[2] * q[0] * C - q[1] * s, 0,
        q[0] * q[1] * C - q[2] * s, c + q[1] * q[1] * C, q[2] * q[1] * C + q[0] * s, 0,
        q[0] * q[2] * C + q[1] * s, q[1] * q[2] * C - q[0] * s, c + q[2] * q[2] * C, 0, p[0], p[1], p[2], 1]);
    },
    xf(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; },
  };
  const ease = (t) => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
  const easeIO = (t) => t < 0 ? 0 : t > 1 ? 1 : (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // ------------------------------------------------------------------ geometry builders (non-indexed triangles)
  function Geo() { this.p = []; this.n = []; }
  Geo.prototype.tri = function (a, b, c, na, nb, nc) {
    if (!na) { const n = V.norm(V.cross(V.sub(b, a), V.sub(c, a))); na = nb = nc = n; }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
  };
  Geo.prototype.quad = function (a, b, c, d, na, nb, nc, nd) { this.tri(a, b, c, na, nb, nc); this.tri(a, c, d, na, nc, nd); };
  Geo.prototype.merge = function (g, m) {
    const P = g.p, N = g.n, p = this.p, n = this.n;
    if (!m) { for (let i = 0; i < P.length; i++) { p.push(P[i]); n.push(N[i]); } return this; }
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2], a = N[i], b = N[i + 1], c = N[i + 2];
      p.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
      const nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c, l = Math.hypot(nx, ny, nz) || 1;
      n.push(nx / l, ny / l, nz / l);
    }
    return this;
  };
  const G = {
    box(w, h, d, skip) { // skip: any of f(+z) b(-z) l(-x) r(+x) t(+y) d(-y) to leave a face open
      const g = new Geo(), x = w / 2, y = h / 2, z = d / 2; skip = skip || "";
      const P = [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z]];
      if (skip.indexOf("f") < 0) g.quad(P[0], P[1], P[2], P[3]);
      if (skip.indexOf("b") < 0) g.quad(P[5], P[4], P[7], P[6]);
      if (skip.indexOf("l") < 0) g.quad(P[4], P[0], P[3], P[7]);
      if (skip.indexOf("r") < 0) g.quad(P[1], P[5], P[6], P[2]);
      if (skip.indexOf("t") < 0) g.quad(P[3], P[2], P[6], P[7]);
      if (skip.indexOf("d") < 0) g.quad(P[4], P[5], P[1], P[0]);
      return g;
    },
    lathe(prof, seg, a0, a1) { // prof: [[r, y], ...] around Y; smooth normals along the profile ([r, y, 1] = hard edge)
      const g = new Geo(); seg = seg || 48; a0 = a0 || 0; a1 = a1 == null ? Math.PI * 2 : a1;
      const N = prof.length, pn = [];
      for (let i = 0; i < N; i++) { // profile normals (2D), averaged at interior points
        const a = prof[Math.max(0, i - 1)], b = prof[Math.min(N - 1, i + 1)];
        let dr = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dr, dy) || 1; pn.push([dy / l, -dr / l]);
      }
      for (let s = 0; s < seg; s++) {
        const t0 = a0 + (a1 - a0) * s / seg, t1 = a0 + (a1 - a0) * (s + 1) / seg;
        const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        for (let i = 0; i < N - 1; i++) {
          const [r0, y0] = prof[i], [r1, y1] = prof[i + 1];
          if (r0 === r1 && y0 === y1) continue;
          const sharp = prof[i].length > 2 || prof[i + 1].length > 2;
          let n0 = pn[i], n1 = pn[i + 1];
          if (sharp) { const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1; n0 = n1 = [dy / l, -dr / l]; }
          const A = [r0 * c0, y0, r0 * s0], B = [r0 * c1, y0, r0 * s1], C = [r1 * c1, y1, r1 * s1], D = [r1 * c0, y1, r1 * s0];
          const nA = [n0[0] * c0, n0[1], n0[0] * s0], nB = [n0[0] * c1, n0[1], n0[0] * s1], nC = [n1[0] * c1, n1[1], n1[0] * s1], nD = [n1[0] * c0, n1[1], n1[0] * s0];
          g.quad(A, D, C, B, nA, nD, nC, nB);
        }
      }
      return g;
    },
    cyl(r1, r2, h, seg, caps) {
      const y = h / 2;
      const prof = caps === false ? [[r1, -y, 1], [r2, y, 1]] : [[0, -y, 1], [r1, -y, 1], [r1, -y, 1], [r2, y, 1], [r2, y, 1], [0, y, 1]];
      return G.lathe(prof, seg || 40);
    },
    tubeRing(R, r, h, seg, a0, a1) { return G.lathe([[r, -h / 2, 1], [R, -h / 2, 1], [R, -h / 2, 1], [R, h / 2, 1], [R, h / 2, 1], [r, h / 2, 1], [r, h / 2, 1], [r, -h / 2, 1]], seg || 48, a0, a1); },
    sphere(r, seg) { const prof = []; const n = seg || 24; for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + Math.PI * i / n; prof.push([Math.cos(a) * r, Math.sin(a) * r]); } return G.lathe(prof, n * 2); },
    torus(R, r, s1, s2) { const prof = []; const n = s2 || 16; for (let i = 0; i <= n; i++) { const a = Math.PI * 2 * i / n; prof.push([R + Math.cos(a) * r, Math.sin(a) * r]); } return G.lathe(prof, s1 || 48); },
    tube(path, r, seg, caps) { // pipe along a polyline, parallel-transport frames; r may be a function of the point index
      const g = new Geo(); seg = seg || 12; const N = path.length; if (N < 2) return g;
      const rad = typeof r === "function" ? r : () => r;
      const T = []; for (let i = 0; i < N; i++) T.push(V.norm(V.sub(path[Math.min(N - 1, i + 1)], path[Math.max(0, i - 1)])));
      let up = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let nrm = V.norm(V.cross(T[0], up)); const rings = [];
      for (let i = 0; i < N; i++) {
        if (i > 0) { const b = V.cross(T[i - 1], T[i]); if (V.len(b) > 1e-6) { const ax = V.norm(b), ang = Math.acos(Math.max(-1, Math.min(1, V.dot(T[i - 1], T[i])))); nrm = rot(nrm, ax, ang); } }
        const bin = V.cross(T[i], nrm); const ring = [], rr = rad(i);
        for (let k = 0; k <= seg; k++) { const a = Math.PI * 2 * k / seg; const d = V.add(V.mul(nrm, Math.cos(a)), V.mul(bin, Math.sin(a))); ring.push([V.add(path[i], V.mul(d, rr)), d]); }
        rings.push(ring);
      }
      for (let i = 0; i < N - 1; i++) for (let k = 0; k < seg; k++) {
        const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k + 1], d = rings[i + 1][k];
        g.quad(a[0], b[0], c[0], d[0], a[1], b[1], c[1], d[1]);
      }
      if (caps) for (const e of [0, N - 1]) { const c = path[e], n = V.mul(T[e], e ? 1 : -1); for (let k = 0; k < seg; k++) g.tri(c, rings[e][k][0], rings[e][k + 1][0], n, n, n); }
      return g;
    },
    stl(bytes) { // binary STL ArrayBuffer -> Geo (flat normals recomputed)
      const dv = new DataView(bytes), n = dv.getUint32(80, true), g = new Geo();
      g.p = new Array(n * 9); g.n = new Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12; const P = [];
        for (let k = 0; k < 9; k++) P.push(dv.getFloat32(o + k * 4, true));
        const a = [P[0], P[1], P[2]], b = [P[3], P[4], P[5]], c = [P[6], P[7], P[8]];
        const nn = V.norm(V.cross(V.sub(b, a), V.sub(c, a)));
        for (let k = 0; k < 9; k++) { g.p[i * 9 + k] = P[k]; g.n[i * 9 + k] = nn[k % 3]; }
      }
      return g;
    },
    bounds(g) { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < g.p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.p[i + k]); mx[k] = Math.max(mx[k], g.p[i + k]); } return { mn, mx, c: V.mul(V.add(mn, mx), 0.5), size: V.sub(mx, mn) }; },
    xform(g, m) { return new Geo().merge(g, m); },
  };
  function rot(v, ax, a) { const c = Math.cos(a), s = Math.sin(a); return V.add(V.add(V.mul(v, c), V.mul(V.cross(ax, v), s)), V.mul(ax, V.dot(ax, v) * (1 - c))); }
  function b64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

  // ------------------------------------------------------------------ shaders
  const SKY = `
    uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGlow; uniform vec3 uGlowDir; uniform vec3 uGndC; uniform float uStudio;
    vec3 env(vec3 d){
      float h = d.y;
      vec3 c = mix(uHor, uZen, pow(clamp(h, 0.0, 1.0), 0.5));
      float az = max(dot(normalize(d.xz + vec2(1e-4)), uGlowDir.xz), 0.0);
      c += uGlow * exp(-abs(h) * 7.0) * (0.22 + 0.78 * az * az * az);
      if (h < 0.0) c = mix(c, uGndC, clamp(-h * 5.0, 0.0, 1.0));
      if (uStudio > 0.5) {
        float bx = smoothstep(0.5, 0.66, d.y) * (1.0 - smoothstep(0.3, 0.5, abs(d.x - 0.15))) * (1.0 - smoothstep(0.45, 0.7, abs(d.z)));
        c += vec3(1.7, 1.62, 1.5) * bx;
        float st = (1.0 - smoothstep(0.05, 0.14, abs(d.y - 0.22))) * step(0.0, -d.x) * (1.0 - smoothstep(0.5, 0.85, abs(d.z)));
        c += vec3(0.35, 0.45, 0.65) * st;
      }
      return c;
    }
    vec3 tone(vec3 c, float e){ c *= e; c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14); return pow(clamp(c, 0.0, 1.0), vec3(0.4545)); }`;
  const NOISE = `
    float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
    float fbm(vec3 p){ return 0.6 * vnoise(p) + 0.3 * vnoise(p * 2.13 + 7.1) + 0.1 * vnoise(p * 4.7 + 3.3); }`;
  const VS = `attribute vec3 aP; attribute vec3 aN; uniform mat4 uM; uniform mat4 uVP; varying vec3 vN; varying vec3 vW; varying vec3 vO;
    void main(){ vec4 w = uM * vec4(aP, 1.0); vW = w.xyz; vO = aP; vN = mat3(uM) * aN; gl_Position = uVP * w; }`;
  const FS = `precision highp float; varying vec3 vN; varying vec3 vW; varying vec3 vO;
    uniform vec3 uColor; uniform vec3 uEmis; uniform float uAlpha; uniform float uMetal; uniform float uRough; uniform float uTex; uniform float uDim;
    uniform vec2 uGrain; uniform vec4 uPar; uniform vec3 uCam; uniform vec4 uWave; uniform float uExpo;
    uniform vec3 uL; uniform vec3 uLc; uniform vec3 uL2; uniform vec3 uL2c; uniform vec3 uSky; uniform vec3 uGnd;
    uniform vec3 uFogC; uniform float uFogN; uniform float uFogF;
    uniform mat4 uLVP; uniform sampler2D uSh; uniform float uShOn; uniform float uShTexel; uniform float uShWorld;
    ${SKY} ${NOISE}
    float unpack(vec4 c){ return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
    float tap(vec2 uv, float z){ return step(z, unpack(texture2D(uSh, uv))); }
    float shadow(vec3 wp){
      vec4 s = uLVP * vec4(wp, 1.0); vec3 p = s.xyz * 0.5 + 0.5;
      float edge = max(abs(p.x - 0.5), abs(p.y - 0.5));
      if (edge > 0.5 || p.z > 1.0) return 1.0;
      float z = p.z - 0.0012; float t = uShTexel;
      float a = tap(p.xy, z) * 2.0 + tap(p.xy + vec2(t, t), z) + tap(p.xy + vec2(-t, t), z) + tap(p.xy + vec2(t, -t), z) + tap(p.xy + vec2(-t, -t), z)
              + tap(p.xy + vec2(1.8 * t, 0.0), z) + tap(p.xy + vec2(-1.8 * t, 0.0), z) + tap(p.xy + vec2(0.0, 1.8 * t), z) + tap(p.xy + vec2(0.0, -1.8 * t), z);
      return mix(a * 0.1, 1.0, smoothstep(0.42, 0.5, edge));
    }
    void main(){
      vec3 N = normalize(vN); vec3 Vd = normalize(uCam - vW);
      if (dot(N, Vd) < 0.0) N = -N;
      vec3 alb = uColor * uColor; float rough = uRough; float metal = uMetal; vec3 emis = uEmis; float al = uAlpha;
      if (uGrain.x > 0.0) { float g = fbm(vO * uGrain.y); alb *= 1.0 + (g - 0.5) * 2.0 * uGrain.x; rough = clamp(rough + (g - 0.5) * uGrain.x, 0.04, 1.0); }
      int t = int(uTex + 0.5);
      if (t == 1) { // cast concrete: pour lines and rain streaks
        float ln = smoothstep(0.46, 0.5, abs(fract(vW.y / uPar.x) - 0.5)); alb *= 1.0 - 0.16 * ln;
        float st = vnoise(vec3(vW.x * 1.7, vW.y * 0.12, vW.z * 1.7)); alb *= 0.8 + 0.34 * st;
      } else if (t == 2) { // water
        vec2 p = vW.xz; vec2 gr = vec2(0.0);
        gr += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 0.9 + uWave.x) * 0.5;
        gr += vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 2.1 + uWave.y) * 0.32;
        gr += vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 4.3 - uWave.z) * 0.2;
        gr += (vec2(vnoise(vec3(p * 1.4, uWave.w)), vnoise(vec3(p * 1.4 + 9.0, uWave.w))) - 0.5) * 0.9;
        N = normalize(vec3(-gr.x * uPar.x, 1.0, -gr.y * uPar.x));
      } else if (t == 3) { // ribbed sheet cladding
        if (abs(N.y) < 0.5) { bool ax = abs(N.x) > abs(N.z); float ph = (ax ? vW.z : vW.x) * uPar.x;
          N = normalize(N + (ax ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)) * cos(ph) * 0.32); alb *= 0.93 + 0.07 * sin(ph);
          alb *= 1.0 - 0.22 * smoothstep(0.47, 0.5, abs(fract(vW.y / uPar.y) - 0.5)); }
      } else if (t == 4) { // fused-filament print: layer lines across the build direction (object Y)
        if (abs(N.y) < 0.94) { float ph = vO.y * uPar.x; N = normalize(N + vec3(0.0, cos(ph) * 0.13, 0.0)); alb *= 0.975 + 0.025 * sin(ph); }
      } else if (t == 5) { // building wall with a grid of windows; uPar = (cell width, floor height, top of the windows, lit fraction)
        if (abs(N.y) < 0.3 && vW.y < uPar.z) { bool ax = abs(N.x) > abs(N.z); float u = (ax ? vW.z : vW.x) / uPar.x; float v = vW.y / uPar.y;
          vec2 f = fract(vec2(u, v)); vec2 id = floor(vec2(u, v));
          float win = step(0.24, f.x) * step(f.x, 0.76) * step(0.32, f.y) * step(f.y, 0.78);
          if (win > 0.5) { float h = hash(vec3(id, ax ? 3.0 : 7.0)); float h2 = hash(vec3(id.yx, 11.0));
            alb = vec3(0.012, 0.014, 0.02); rough = 0.12;
            if (h < uPar.w) emis += mix(vec3(1.0, 0.72, 0.36), vec3(0.85, 0.9, 1.0), step(0.86, h2)) * (0.55 + 0.6 * h2); } }
      } else if (t == 6) { // gravel / asphalt
        alb *= 0.86 + 0.28 * hash(floor(vW * 7.0)); alb *= 0.8 + 0.4 * vnoise(vW * 0.07);
      } else if (t == 7) { // jointed concrete paving
        vec2 j = abs(fract(vW.xz / uPar.x) - 0.5); alb *= 1.0 - 0.3 * smoothstep(0.485, 0.5, max(j.x, j.y)); alb *= 0.84 + 0.3 * vnoise(vW * 0.35);
      }
      float NdV = max(dot(N, Vd), 0.001);
      vec3 F0 = mix(vec3(0.04), alb, metal); vec3 dif = alb * (1.0 - metal);
      float sh = uShOn > 0.5 ? shadow(vW + N * uShWorld * 1.6) : 1.0;
      vec3 c = vec3(0.0); float glint = 0.0;
      { float NdL = max(dot(N, uL), 0.0); vec3 H = normalize(uL + Vd); float NdH = max(dot(N, H), 0.0), VdH = max(dot(Vd, H), 0.0);
        float a = rough * rough, a2 = a * a; float d = NdH * NdH * (a2 - 1.0) + 1.0; float D = a2 / (3.14159 * d * d + 1e-5);
        float k = (rough + 1.0) * (rough + 1.0) / 8.0; float Gv = 1.0 / ((NdL * (1.0 - k) + k) * (NdV * (1.0 - k) + k));
        vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0); vec3 sp = min(D * F * Gv * 0.25, vec3(6.0));
        c += (dif + sp) * uLc * NdL * sh; glint = dot(sp, vec3(0.33)) * NdL * sh; }
      { float NdL = max(dot(N, uL2), 0.0); vec3 H = normalize(uL2 + Vd);
        c += dif * uL2c * NdL + F0 * uL2c * pow(max(dot(N, H), 0.0), mix(64.0, 6.0, rough)) * NdL * (1.0 - rough); }
      vec3 amb = mix(uGnd, uSky, 0.5 + 0.5 * N.y);
      c += dif * amb * mix(0.72, 1.0, sh);
      vec3 Rv = reflect(-Vd, N); vec3 e = mix(env(Rv), amb * 1.3, rough * rough);
      e += uLc * pow(max(dot(Rv, uL), 0.0), 9.0) * 0.2 * (1.0 - uStudio);
      vec3 Fe = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NdV, 5.0);
      c += e * Fe * mix(1.0, 0.45, rough) * mix(0.55, 1.0, sh);
      c += emis; c *= uDim;
      if (al < 1.0) al = clamp(al + dot(Fe, vec3(0.33)) * 0.5 + glint * 0.6, 0.0, 1.0);
      float f = clamp((length(uCam - vW) - uFogN) / (uFogF - uFogN), 0.0, 1.0); f = f * f * (3.0 - 2.0 * f);
      c = mix(c, uFogC, f);
      gl_FragColor = vec4(tone(c, uExpo), al);
    }`;
  const DVS = `attribute vec3 aP; uniform mat4 uM; uniform mat4 uLVP; void main(){ gl_Position = uLVP * uM * vec4(aP, 1.0); }`;
  const DFS = `precision highp float;
    void main(){ float d = gl_FragCoord.z; vec4 e = fract(d * vec4(1.0, 255.0, 65025.0, 16581375.0)); e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0); gl_FragColor = e; }`;
  const SVS = `attribute vec2 aQ; varying vec2 vQ; void main(){ vQ = aQ; gl_Position = vec4(aQ, 0.9999, 1.0); }`;
  const SFS = `precision highp float; varying vec2 vQ; uniform vec3 uF; uniform vec3 uR; uniform vec3 uU; uniform float uTwk; uniform float uStars; uniform float uExpo; uniform float uShift;
    ${SKY}
    float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    void main(){
      vec3 d = normalize(uF + uR * (vQ.x - uShift) + uU * vQ.y);
      vec3 c = env(d);
      if (uStars > 0.0 && d.y > 0.02) { vec3 q = d * 150.0; vec3 id = floor(q); float s = hash(id);
        float pt = smoothstep(0.42, 0.0, length(fract(q) - 0.5));
        c += vec3(0.85, 0.9, 1.0) * step(0.992, s) * pt * (0.55 + 0.45 * sin(uTwk + s * 900.0)) * smoothstep(0.02, 0.35, d.y) * uStars * (0.4 + 0.6 * fract(s * 57.0)); }
      gl_FragColor = vec4(tone(c, uExpo), 1.0);
    }`;
  const PVS = `attribute vec3 aP; attribute vec4 aC; attribute float aS; uniform mat4 uVP; uniform float uH; varying vec4 vC;
    void main(){ vec4 p = uVP * vec4(aP,1.0); gl_Position = p; gl_PointSize = aS * uH / max(p.w, 0.001); vC = aC; }`;
  const PFS = `precision mediump float; varying vec4 vC; uniform float uSoft;
    void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q,q); if (r > 1.0) discard; float a = mix(1.0 - smoothstep(0.6, 1.0, r), exp(-r * 2.5), uSoft); gl_FragColor = vec4(vC.rgb, vC.a * a); }`;

  // ------------------------------------------------------------------ renderer
  function Renderer(canvas, opts) {
    opts = opts || {};
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: !!opts.preserve, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL not available");
    this.gl = gl; this.canvas = canvas; this.scale = 1; this.time = 0; this.wave = [0, 0, 0, 0]; this.twk = 0; // phases of the water waves and of the star twinkle
    const sh = (src, t) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = (v, f) => { const p = gl.createProgram(); gl.attachShader(p, sh(v, gl.VERTEX_SHADER)); gl.attachShader(p, sh(f, gl.FRAGMENT_SHADER)); gl.bindAttribLocation(p, 0, "aP"); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; };
    const U = (p, names) => { const o = {}; names.forEach((n) => (o[n] = gl.getUniformLocation(p, n))); return o; };
    const skyU = ["uZen", "uHor", "uGlow", "uGlowDir", "uGndC", "uStudio", "uExpo"];
    this.P = prog(VS, FS); this.PD = prog(DVS, DFS); this.PS = prog(SVS, SFS); this.PP = prog(PVS, PFS);
    this.u = U(this.P, ["uM", "uVP", "uColor", "uEmis", "uAlpha", "uMetal", "uRough", "uTex", "uDim", "uGrain", "uPar", "uCam", "uWave", "uL", "uLc", "uL2", "uL2c", "uSky", "uGnd",
      "uFogC", "uFogN", "uFogF", "uLVP", "uSh", "uShOn", "uShTexel", "uShWorld"].concat(skyU));
    this.du = U(this.PD, ["uM", "uLVP"]);
    this.su = U(this.PS, ["uF", "uR", "uU", "uTwk", "uStars", "uShift"].concat(skyU));
    this.pu = U(this.PP, ["uVP", "uH", "uSoft"]);
    this.aP = gl.getAttribLocation(this.P, "aP"); this.aN = gl.getAttribLocation(this.P, "aN");
    this.paP = gl.getAttribLocation(this.PP, "aP"); this.paC = gl.getAttribLocation(this.PP, "aC"); this.paS = gl.getAttribLocation(this.PP, "aS");
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    // shadow map: depth packed into an RGBA texture (works on every WebGL 1 device)
    const size = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    this.shSize = size; this.shTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.shTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
    this.shFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.shTex, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    this.shOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.env = { light: V.norm([0.45, 0.8, 0.35]), lightC: [2.2, 2.0, 1.7], light2: V.norm([-0.6, 0.3, -0.5]), light2C: [0.2, 0.25, 0.35],
      sky: [0.1, 0.12, 0.18], gnd: [0.03, 0.03, 0.03], fogC: [0.02, 0.03, 0.06], fogN: 60, fogF: 400,
      zen: [0.01, 0.015, 0.04], hor: [0.05, 0.07, 0.12], glow: [0, 0, 0], glowDir: [1, 0, 0], gndC: [0.02, 0.02, 0.025], studio: 0, stars: 0, expo: 1,
      shadow: null /* {c: [x,y,z], r: radius} */ };
    this.cam = { eye: [10, 8, 12], target: [0, 0, 0], fov: 40, near: 0.1, far: 1000, shift: 0 };
  }
  Renderer.prototype.mesh = function (g) {
    const gl = this.gl, vb = gl.createBuffer(), nb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.p), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.n), gl.STATIC_DRAW);
    return { vb, nb, count: g.p.length / 3 };
  };
  Renderer.prototype.resize = function () {
    const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2) * this.scale;
    const w = Math.max(2, Math.round(c.clientWidth * dpr)), h = Math.max(2, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  };
  Renderer.prototype.vp = function () {
    const c = this.canvas, cam = this.cam, P = M.persp(cam.fov, c.width / c.height, cam.near, cam.far);
    P[8] = -(cam.shift || 0); // lens shift: moves the picture sideways without changing the perspective
    return M.mul(P, M.lookAt(cam.eye, cam.target, cam.up || [0, 1, 0]));
  };
  // node: {mesh, color, emis, alpha, metal, rough, tex, grain, par, dim, cast, pos, rot, scl, children, visible, matrix(optional fn)}
  function node(o) { return Object.assign({ pos: [0, 0, 0], rot: [0, 0, 0], scl: 1, color: [0.7, 0.7, 0.7], emis: [0, 0, 0], alpha: 1, metal: 0, rough: 0.6, tex: 0, grain: [0, 1], par: [1, 1, 0, 0], dim: 1, cast: true, children: [], visible: true }, o || {}); }
  Renderer.prototype.render = function (scene, particles) {
    const gl = this.gl, e = this.env, u = this.u, c = this.canvas, cam = this.cam;
    const opaque = [], trans = [];
    const walk = (n, pm, pd) => {
      if (!n.visible) return;
      const m = M.mul(pm, n.matrix ? n.matrix(n) : M.trs(n.pos, n.rot, n.scl)), d = pd * n.dim;
      if (n.mesh) (n.alpha < 1 ? trans : opaque).push([n, m, d]);
      for (const ch of n.children) walk(ch, m, d);
    };
    walk(scene, M.ident(), 1);
    // ---- pass 1: shadow depth from the key light
    let LVP = M.ident(), shOn = 0, shWorld = 0;
    if (this.shOk && e.shadow) {
      const r = e.shadow.r, S = this.shSize, L = e.light, texel = 2 * r / S;
      const view = M.lookAt(V.mul(L, 1), [0, 0, 0], Math.abs(L[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]);
      const cl = M.xf(view, e.shadow.c); const sx = Math.round(cl[0] / texel) * texel, sy = Math.round(cl[1] / texel) * texel; // snap to texels: no shimmer
      LVP = M.mul(M.ortho(sx - r, sx + r, sy - r, sy + r, -cl[2] - 2.6 * r, -cl[2] + 2.6 * r), view); shOn = 1; shWorld = texel;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shFbo); gl.viewport(0, 0, S, S); gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.useProgram(this.PD); gl.uniformMatrix4fv(this.du.uLVP, false, LVP); gl.enableVertexAttribArray(0);
      for (const [n, m] of opaque) { if (n.cast === false) continue; gl.uniformMatrix4fv(this.du.uM, false, m); gl.bindBuffer(gl.ARRAY_BUFFER, n.mesh.vb); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, n.mesh.count); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // ---- pass 2: sky, opaque, transparent
    gl.viewport(0, 0, c.width, c.height); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const VP = this.vp(); this.VP = VP;
    const sky = (uu) => { gl.uniform3fv(uu.uZen, e.zen); gl.uniform3fv(uu.uHor, e.hor); gl.uniform3fv(uu.uGlow, e.glow); gl.uniform3fv(uu.uGlowDir, V.norm([e.glowDir[0], 0, e.glowDir[2]])); gl.uniform3fv(uu.uGndC, e.gndC); gl.uniform1f(uu.uStudio, e.studio); gl.uniform1f(uu.uExpo, e.expo); };
    { const F = V.norm(V.sub(cam.target, cam.eye)), Rt = V.norm(V.cross(F, cam.up || [0, 1, 0])), Up = V.cross(Rt, F), th = Math.tan(cam.fov * Math.PI / 360);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false); gl.useProgram(this.PS); sky(this.su);
      gl.uniform3fv(this.su.uF, F); gl.uniform3fv(this.su.uR, V.mul(Rt, th * c.width / c.height)); gl.uniform3fv(this.su.uU, V.mul(Up, th));
      gl.uniform1f(this.su.uTwk, this.twk); gl.uniform1f(this.su.uStars, e.stars); gl.uniform1f(this.su.uShift, cam.shift || 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true); }
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.P); sky(u);
    gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniform3fv(u.uCam, cam.eye); gl.uniform4fv(u.uWave, this.wave);
    gl.uniform3fv(u.uL, e.light); gl.uniform3fv(u.uLc, e.lightC); gl.uniform3fv(u.uL2, e.light2); gl.uniform3fv(u.uL2c, e.light2C);
    gl.uniform3fv(u.uSky, e.sky); gl.uniform3fv(u.uGnd, e.gnd); gl.uniform3fv(u.uFogC, e.fogC); gl.uniform1f(u.uFogN, e.fogN); gl.uniform1f(u.uFogF, e.fogF);
    gl.uniformMatrix4fv(u.uLVP, false, LVP); gl.uniform1f(u.uShOn, shOn); gl.uniform1f(u.uShTexel, 1 / this.shSize); gl.uniform1f(u.uShWorld, shWorld);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shTex); gl.uniform1i(u.uSh, 0);
    gl.enableVertexAttribArray(this.aP); gl.enableVertexAttribArray(this.aN);
    const draw = ([n, m, d]) => {
      gl.uniformMatrix4fv(u.uM, false, m); gl.uniform3fv(u.uColor, n.color); gl.uniform3fv(u.uEmis, n.emis);
      gl.uniform1f(u.uAlpha, n.alpha); gl.uniform1f(u.uMetal, n.metal); gl.uniform1f(u.uRough, n.rough); gl.uniform1f(u.uTex, n.tex); gl.uniform1f(u.uDim, d);
      gl.uniform2fv(u.uGrain, n.grain); gl.uniform4fv(u.uPar, n.par);
      gl.bindBuffer(gl.ARRAY_BUFFER, n.mesh.vb); gl.vertexAttribPointer(this.aP, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, n.mesh.nb); gl.vertexAttribPointer(this.aN, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, n.mesh.count);
    };
    gl.disable(gl.BLEND); opaque.forEach(draw);
    if (trans.length) {
      const eye = cam.eye;
      trans.sort((a, b) => V.len(V.sub([b[1][12], b[1][13], b[1][14]], eye)) - V.len(V.sub([a[1][12], a[1][13], a[1][14]], eye)));
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      trans.forEach(draw); gl.depthMask(true);
    }
    gl.disableVertexAttribArray(this.aN);
    this.drawn = opaque.length + trans.length;
    if (particles) for (const ps of particles) this.drawParticles(ps);
  };
  // ------------------------------------------------------------------ particles
  function Particles(r, max, opt) {
    this.r = r; this.max = max; this.n = 0; this.opt = Object.assign({ additive: true, soft: 1 }, opt || {});
    this.P = new Float32Array(max * 3); this.C = new Float32Array(max * 4); this.S = new Float32Array(max);
    const gl = r.gl; this.bp = gl.createBuffer(); this.bc = gl.createBuffer(); this.bs = gl.createBuffer();
  }
  Particles.prototype.clear = function () { this.n = 0; };
  Particles.prototype.add = function (p, c, s, bias) { // bias: pull the sprite toward the eye (same place on screen, but in front of the pipe wall)
    if (this.n >= this.max) return; const i = this.n++;
    let x = p[0], y = p[1], z = p[2];
    if (bias) { const e = this.r.cam.eye, dx = e[0] - x, dy = e[1] - y, dz = e[2] - z, l = Math.hypot(dx, dy, dz) || 1, k = Math.min(bias, l * 0.5) / l; x += dx * k; y += dy * k; z += dz * k; }
    this.P[i * 3] = x; this.P[i * 3 + 1] = y; this.P[i * 3 + 2] = z;
    this.C[i * 4] = c[0]; this.C[i * 4 + 1] = c[1]; this.C[i * 4 + 2] = c[2]; this.C[i * 4 + 3] = c[3] == null ? 1 : c[3]; this.S[i] = s;
  };
  Renderer.prototype.drawParticles = function (ps) {
    if (!ps.n) return; const gl = this.gl;
    gl.useProgram(this.PP); gl.uniformMatrix4fv(this.pu.uVP, false, this.VP); gl.uniform1f(this.pu.uH, this.canvas.height * 0.5); gl.uniform1f(this.pu.uSoft, ps.opt.soft);
    const up = (b, arr, loc, k) => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, ps.n * k), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, k, gl.FLOAT, false, 0, 0); };
    up(ps.bp, ps.P, this.paP, 3); up(ps.bc, ps.C, this.paC, 4); up(ps.bs, ps.S, this.paS, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, ps.opt.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    gl.drawArrays(gl.POINTS, 0, ps.n);
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(this.paC); gl.disableVertexAttribArray(this.paS);
    gl.useProgram(this.P);
  };
  // polyline helpers for flows
  function Path(pts) { this.pts = pts; this.L = [0]; for (let i = 1; i < pts.length; i++) this.L.push(this.L[i - 1] + V.len(V.sub(pts[i], pts[i - 1]))); this.len = this.L[this.L.length - 1]; }
  Path.prototype.at = function (t) { // t in [0,1]
    const d = ((t % 1) + 1) % 1 * this.len; let i = 1; while (i < this.L.length - 1 && this.L[i] < d) i++;
    const a = this.pts[i - 1], b = this.pts[i], s = (d - this.L[i - 1]) / ((this.L[i] - this.L[i - 1]) || 1); return V.lerp(a, b, s);
  };
  function smoothPath(pts, r, k) { // round the corners of a polyline with radius r (k samples per corner)
    if (pts.length < 3) return pts; k = k || 6; const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const d1 = V.norm(V.sub(a, b)), d2 = V.norm(V.sub(c, b));
      const rr = Math.min(r, V.len(V.sub(a, b)) / 2, V.len(V.sub(c, b)) / 2);
      const p1 = V.add(b, V.mul(d1, rr)), p2 = V.add(b, V.mul(d2, rr));
      for (let j = 0; j <= k; j++) { const t = j / k; const q = V.add(V.add(V.mul(p1, (1 - t) * (1 - t)), V.mul(b, 2 * t * (1 - t))), V.mul(p2, t * t)); out.push(q); }
    }
    out.push(pts[pts.length - 1]); return out;
  }
  root.M3D = { V, M, G, Geo, Renderer, Particles, Path, node, ease, easeIO, b64, smoothPath, rot };
})(typeof window !== "undefined" ? window : this);
