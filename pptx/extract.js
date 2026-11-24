// extract.js — runs inside the page (headless Chrome) and returns the slide that is on screen as a list of
// drawable items in CSS pixels: text blocks with their runs, boxes, lines, curves, pictures and 3D callouts.
// The PowerPoint builder turns each item into a native, editable shape on top of the captured 3D scene.
(() => {
  const items = [];
  const ROOT = getComputedStyle(document.documentElement), hex = (v, d) => (ROOT.getPropertyValue(v).trim().replace("#", "") || d).toUpperCase();
  const GOLD = hex("--gold", "D9B061"), GOLD2 = hex("--gold2", "B8892B"), COVER = hex("--cover-a", "24457F");
  const probe = (family) => { const d = document.createElement("span"); d.style.cssText = "position:absolute;visibility:hidden;font-size:100px;line-height:normal;font-family:" + family; d.textContent = "Hg"; document.body.appendChild(d);
    const out = { family: getComputedStyle(d).fontFamily, natural: d.getBoundingClientRect().height / 100 }; d.remove(); return out; };
  const SERIF = probe("var(--serif)"), SANS = probe("var(--sans)");
  const rgb = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ""); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    return { c: p.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase(), a: p.length > 3 ? p[3] : 1 }; };
  const box = (r) => ({ x: +r.left.toFixed(2), y: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) });
  const gone = (cs) => cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05;
  const sty = (el, cs, svg, k) => { cs = cs || getComputedStyle(el); const col = rgb(svg ? cs.fill : cs.color) || { c: "FFFFFF", a: 1 };
    return { color: col.c, bold: parseInt(cs.fontWeight) >= 600, italic: cs.fontStyle === "italic", serif: cs.fontFamily === SERIF.family, fs: parseFloat(cs.fontSize) * (k || 1),
      ls: cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing), upper: cs.textTransform === "uppercase" }; };
  const isBlock = (n) => n.nodeType === 1 && n.tagName !== "BR" && ["block", "flex", "grid", "table", "list-item"].includes(getComputedStyle(n).display);
  const hasText = (n) => n.nodeType === 3 ? /\S/.test(n.nodeValue) : /\S/.test(n.textContent);

  // inline nodes -> runs (text + style); <br> -> line break
  function runsOf(nodes, st, svg, k) { const runs = [];
    const walk = (list, s0) => { for (const c of list) {
      if (c.nodeType === 3) { let t = c.nodeValue.replace(/\s+/g, " "); if (s0.nb) t = t.replace(/ /g, " "); if (t) runs.push(Object.assign({ text: s0.upper ? t.toUpperCase() : t }, s0)); }
      else if (c.nodeType === 1) {
        if (c.tagName === "BR") { runs.push({ br: true }); continue; }
        const cs = getComputedStyle(c); if (cs.display === "none" || cs.visibility === "hidden") continue;
        const s = sty(c, cs, svg, k); if (c.tagName === "SUB") { s.sub = true; s.fs = s0.fs; } s.nb = !!s0.nb || (cs.whiteSpace === "nowrap" && cs.display.startsWith("inline"));
        if (parseFloat(cs.marginLeft) > 2) runs.push(Object.assign({ text: " " }, s0));
        walk(c.childNodes, s);
        if (cs.display === "inline-block" && parseFloat(cs.minWidth) > 0) runs.push(Object.assign({ text: "  " }, s0));
        else if (parseFloat(cs.marginRight) > 2) runs.push(Object.assign({ text: " " }, s0));
      } } };
    walk(nodes, st);
    // trim the white space at both ends of every line, merge nothing else
    const lines = [[]]; runs.forEach((r) => { if (r.br) lines.push([]); else lines[lines.length - 1].push(r); });
    const out = [];
    lines.forEach((ln) => { while (ln.length && !ln[0].text.trim()) ln.shift(); while (ln.length && !ln[ln.length - 1].text.trim()) ln.pop();
      if (ln.length) { ln[0].text = ln[0].text.replace(/^\s+/, ""); ln[ln.length - 1].text = ln[ln.length - 1].text.replace(/\s+$/, ""); }
      if (out.length) out.push({ br: true }); ln.forEach((r) => out.push(r)); });
    while (out.length && out[out.length - 1].br) out.pop(); while (out.length && out[0].br) out.shift();
    return out; }

  function boxOf(el, cs, r) { // background and border of an element, as shapes
    if (el.matches(".slide, .panel")) return false;
    const bg = rgb(cs.backgroundColor), grad = cs.backgroundImage !== "none";
    const bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat);
    if (!((bg && bg.a > 0.02) || grad || bw.some((v) => v > 0.3))) return false;
    if (el.classList.contains("bar-side")) { // the two-colour bar of the report cover
      items.push({ t: "rect", x: r.left, y: r.top, w: r.width, h: r.height * 0.74, fill: { c: COVER, a: 1 } });
      items.push({ t: "rect", x: r.left, y: r.top + r.height * 0.74, w: r.width, h: r.height * 0.26, fill: { c: GOLD2, a: 1 } }); return true; }
    let fill = bg && bg.a > 0.02 ? bg : null; if (grad && !fill) fill = { c: GOLD, a: 1 };
    const rad = cs.borderTopLeftRadius, it = Object.assign({ t: "rect" }, box(r), { fill, radius: rad.endsWith("%") ? 0 : parseFloat(rad), ellipse: rad.endsWith("%") && parseFloat(rad) >= 50 });
    const side = bw[1] > 0.3 ? rgb(cs.borderRightColor) : null; if (side) it.line = { c: side.c, a: side.a, w: bw[1] };
    items.push(it);
    if (bw[0] > bw[1] + 1) { const tc = rgb(cs.borderTopColor); items.push({ t: "rect", x: r.left, y: r.top, w: r.width, h: bw[0], fill: tc, radius: 0 }); }
    return true; }

  function textItem(el, cs, nodes, rr, boxed) { // one flow of inline content
    const st = sty(el, cs), runs = runsOf(nodes, st); if (!runs.length) return;
    const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat), bw = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat);
    const er = el.getBoundingClientRect(), lh = cs.lineHeight === "normal" ? st.fs * 1.2 : parseFloat(cs.lineHeight);
    const flex = cs.display === "flex" || cs.display === "inline-flex";
    let align = { start: "left", left: "left", right: "right", end: "right", center: "center" }[cs.textAlign] || "left", valign = "top";
    let x = er.left + bw[3] + pad[3], w = er.width - bw[1] - bw[3] - pad[1] - pad[3], y = rr.top, h = rr.height;
    if (boxed || flex) { y = er.top; h = er.height; valign = "middle"; if (flex ? cs.justifyContent === "center" : true) { align = "center"; x = er.left; w = er.width; } }
    const lines = Math.max(1, Math.round(rr.height / lh));
    items.push({ t: "text", x: +x.toFixed(2), y: +y.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2), align, valign, lh: +lh.toFixed(2), fs: st.fs, lines, nowrap: lines === 1 || cs.whiteSpace === "nowrap", runs,
      role: /^H[12]$/.test(el.tagName) ? "title" : el.id === "chap" ? "chapter" : "" }); }

  function walk(el) {
    if (el.nodeType !== 1) return; const cs = getComputedStyle(el); if (gone(cs)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "svg") return svgOf(el);
    if (tag === "img") return imgOf(el, cs);
    const r = el.getBoundingClientRect(); const boxed = boxOf(el, cs, r);
    const kids = [...el.childNodes];
    if (!kids.some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue))) { for (const c of el.children) walk(c); return; }
    if (!kids.some(isBlock)) { const rg = document.createRange(); rg.selectNodeContents(el); return textItem(el, cs, kids, rg.getBoundingClientRect(), boxed); }
    let seg = []; const flush = () => { if (seg.some(hasText)) { const rg = document.createRange(); rg.setStartBefore(seg[0]); rg.setEndAfter(seg[seg.length - 1]); textItem(el, cs, seg, rg.getBoundingClientRect(), false); } seg = []; };
    kids.forEach((n) => { if (isBlock(n)) { flush(); walk(n); } else seg.push(n); }); flush();
  }

  function imgOf(el, cs) { const key = el.dataset.asset; if (!key) return; const r = el.getBoundingClientRect(), p = parseFloat(cs.paddingLeft) || 0;
    const round = cs.borderTopLeftRadius.endsWith("%");
    if (round) items.push(Object.assign({ t: "rect" }, box(r), { fill: { c: "FFFFFF", a: 1 }, ellipse: true }));
    items.push({ t: "img", key, x: r.left + p, y: r.top + p, w: r.width - 2 * p, h: r.height - 2 * p, nw: el.naturalWidth, nh: el.naturalHeight, fit: cs.objectFit, round }); }

  function svgOf(svg) { const m = svg.getScreenCTM(), k = m.a, P = (x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
    const each = (g) => { for (const c of g.children) { const cs = getComputedStyle(c); if (gone(cs)) continue; const tag = c.tagName.toLowerCase();
      if (tag === "defs") continue;
      if (tag === "g") { each(c); continue; }
      const fill = cs.fill === "none" ? null : rgb(cs.fill), stroke = cs.stroke === "none" ? null : (rgb(cs.stroke) || { c: GOLD, a: 1 }), sw = parseFloat(cs.strokeWidth) * k;
      if (fill) fill.a *= parseFloat(cs.fillOpacity || 1);
      if (tag === "line") { const a = P(+c.getAttribute("x1"), +c.getAttribute("y1")), b = P(+c.getAttribute("x2"), +c.getAttribute("y2")); items.push({ t: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1], line: { c: stroke.c, a: stroke.a, w: sw } }); }
      else if (tag === "circle") { if (c.querySelector("animateMotion")) continue; items.push(Object.assign({ t: "rect" }, box(c.getBoundingClientRect()), { fill, ellipse: true })); }
      else if (tag === "path") { const tk = c.getAttribute("d").match(/[MLCZ]|-?\d*\.?\d+/gi), pts = []; let i = 0, cmd = "";
        while (i < tk.length) { if (/[MLCZ]/i.test(tk[i])) cmd = tk[i++].toUpperCase(); if (cmd === "Z") { pts.push({ close: true }); cmd = ""; continue; } if (!cmd) { i++; continue; }
          if (cmd === "C") { const a = P(+tk[i], +tk[i + 1]), b = P(+tk[i + 2], +tk[i + 3]), e = P(+tk[i + 4], +tk[i + 5]); i += 6; pts.push({ x: e[0], y: e[1], c1: a, c2: b }); }
          else { const e = P(+tk[i], +tk[i + 1]); i += 2; pts.push({ x: e[0], y: e[1], move: cmd === "M" }); if (cmd === "M") cmd = "L"; } }
        items.push({ t: "path", pts, fill, line: stroke ? { c: stroke.c, a: stroke.a, w: sw } : null }); }
      else if (tag === "text") { const r = c.getBoundingClientRect(), st = sty(c, cs, true, k), runs = runsOf(c.childNodes, st, true, k); if (!runs.length) continue;
        const an = cs.textAnchor; items.push(Object.assign({ t: "text" }, box(r), { align: an === "middle" ? "center" : an === "end" ? "right" : "left", valign: "middle", lh: st.fs * 1.2, fs: st.fs, lines: 1, nowrap: true, runs, role: "" })); }
    } };
    each(svg); }

  // 3D callouts that are showing now
  for (const l of document.querySelectorAll("#labels .lbl")) { if (l.style.opacity !== "1") continue; const from = items.length;
    const line = l.querySelector("i");
    if (line) { const r = line.getBoundingClientRect(), x = r.left + r.width / 2, d = innerWidth * 0.0044;
      items.push({ t: "line", x1: x, y1: r.top, x2: x, y2: r.bottom, line: { c: GOLD, a: 0.85, w: 1.2 } });
      items.push({ t: "rect", x: x - d / 2, y: r.bottom - d / 2, w: d, h: d, fill: { c: GOLD, a: 1 }, ellipse: true }); }
    walk(l.firstChild); for (let k = from; k < items.length; k++) items[k].callout = true; }
  const slide = document.querySelector(".slide.on"); for (const c of slide.children) walk(c);
  const prog = document.getElementById("prog"); items.push(Object.assign({ t: "rect" }, box(prog.getBoundingClientRect()), { fill: { c: GOLD, a: 1 }, name: "Progress" }));

  // the frame that repeats on every slide (measured once by the caller on a content slide)
  const chrome = {}; for (const id of ["chap", "count"]) { const e = document.getElementById(id), cs = getComputedStyle(e); chrome[id] = Object.assign(box(e.getBoundingClientRect()), sty(e, cs)); }
  { const e = document.querySelector("#logo div"), im = document.querySelector("#logo img");                     // the corner mark is optional
    if (e) { const cs = getComputedStyle(e); chrome.logoText = Object.assign(box(e.getBoundingClientRect()), sty(e, cs), { lh: parseFloat(cs.lineHeight), runs: runsOf(e.childNodes, sty(e, cs)) }); }
    if (im && im.dataset.asset) chrome.logoImg = Object.assign(box(im.getBoundingClientRect()), { key: im.dataset.asset }); }
  const first = (f) => f.split(",")[0].trim().replace(/^"|"$/g, ""), meta = document.querySelector('meta[name="author"]');
  const theme = { title: document.title, author: meta ? meta.content : "", lang: document.documentElement.lang, rtl: document.documentElement.dir === "rtl",
    head: first(SERIF.family), body: first(SANS.family), natSerif: +SERIF.natural.toFixed(3), natSans: +SANS.natural.toFixed(3),
    colors: { bg: hex("--bg", "03060C"), ink: hex("--ink", "F2F4F7"), navy: hex("--navy", "0B1A30"), ink2: hex("--ink2", "C3CCD9"), gold: GOLD, gold2: GOLD2, blue: hex("--blue", "2A78D6"), orange: hex("--orange", "EB6834"), muted: hex("--muted", "8D99AC") } };
  return JSON.stringify({ w: innerWidth, h: innerHeight, cls: slide.className, chapter: document.getElementById("chap").textContent, notes: slide.dataset.notes || "", scene: PRES3D.S.scene, theme,
    panel: slide.querySelector(".panel") ? slide.querySelector(".panel").className : slide.querySelector(".full") ? "full" : slide.querySelector(".titlecard") ? "titlecard" : slide.querySelector(".cv") ? "cover" : "prolog", items, chrome });
})()
