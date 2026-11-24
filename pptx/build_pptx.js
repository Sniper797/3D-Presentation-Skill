// build_pptx.js — turns <deck>/pptx/cap/layout.json + bg-NN.jpg (written by capture.py) into the PowerPoint deck.
//
//   set PPTX_SKILL=<folder of the pptx skill>    (its scripts/apply_theme.js writes the theme)
//   set NODE_PATH=<this folder>\node_modules     (so that apply_theme.js finds pptxgenjs too)
//   node build_pptx.js <deck folder> [out.pptx]
//
// Every slide: the captured 3D scene as the slide background, and on top of it native, editable shapes at the
// positions measured in the browser: text boxes, badges, cards, bars, the timeline, the T-s diagram, callouts.
const fs = require("fs"), path = require("path");
const pptxgen = require("pptxgenjs"), JSZip = require("jszip");
const SKILL = process.env.PPTX_SKILL;
const { applyTheme } = require(path.join(SKILL, "scripts", "apply_theme.js"));

if (!SKILL || !process.argv[2]) { console.error("usage: PPTX_SKILL=<pptx skill folder> node build_pptx.js <deck folder> [out.pptx]"); process.exit(1); }
const DECK = path.resolve(process.argv[2]), CAP = path.join(DECK, "pptx", "cap");
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(DECK, "pptx", path.basename(DECK) + ".pptx");
const L = JSON.parse(fs.readFileSync(path.join(CAP, "layout.json"), "utf8")), TH = L.slides[0].theme, K = TH.colors;
const SW = 13.333, SH = 7.5, IN = SW / L.w, PT = 72 * IN;          // inches and points per CSS pixel
const assets = fs.existsSync(path.join(DECK, "assets.js")) ? fs.readFileSync(path.join(DECK, "assets.js"), "utf8") : "";
const picture = (key) => { const m = new RegExp('"' + key + '": "data:(image/[a-z]+;base64,[^"]+)"').exec(assets); if (!m) throw new Error("no picture " + key); return m[1]; };

// the deck's own palette and fonts (read from its CSS variables by extract.js) become the PowerPoint theme
const THEME = { name: TH.title.split(/[\u00b7|\u2013-]/)[0].trim() || path.basename(DECK), headFontFace: TH.head, bodyFontFace: TH.body,
  colors: { dk1: K.bg, lt1: K.ink, dk2: K.navy, lt2: K.ink2, accent1: K.gold, accent2: K.gold2, accent3: K.blue, accent4: K.orange, accent5: K.muted, accent6: "8FD4A8", hlink: K.gold, folHlink: K.gold2 } };
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = TH.title; if (TH.author) pres.author = TH.author; if (TH.rtl) pres.rtlMode = true;
const C = pres.SchemeColor;
const SCHEME = { [K.bg]: C.text1, [K.ink]: C.background1, [K.navy]: C.text2, [K.ink2]: C.background2, [K.gold]: C.accent1, [K.gold2]: C.accent2, [K.blue]: C.accent3, [K.orange]: C.accent4, [K.muted]: C.accent5, "8FD4A8": C.accent6 };
const col = (hex) => SCHEME[hex] || hex;
const HEAD = "+mj-lt"; // the theme's heading font

// ---------------------------------------------------------------- layouts: the frame that repeats
const ch = (L.slides.find((s) => s.panel !== "cover" && s.chapter) || L.slides[L.slides.length - 1]).chrome;   // measured on a slide that shows the running head
// The corner mark (organisation text and logo) is drawn on every slide, not on the layout: a slide's own shapes always
// sit above the layout's, so a full-slide video (add_motion.ps1) would cover a mark that lived on the layout.
function addCorner(slide) {
  if (ch.logoText) slide.addText(ch.logoText.runs.filter((r) => !r.br).map((r) => r.text).join("\n"), { x: (ch.logoText.x - (TH.rtl ? 0 : 80)) * IN, y: ch.logoText.y * IN, w: (ch.logoText.w + 80) * IN, h: ch.logoText.h * IN, margin: 0, align: TH.rtl ? "left" : "right", valign: "middle",
    fontSize: +(ch.logoText.fs * PT).toFixed(1), color: col(ch.logoText.color), charSpacing: +(ch.logoText.ls * PT).toFixed(2), lineSpacingMultiple: +(ch.logoText.lh / ch.logoText.fs / TH.natSans).toFixed(2), objectName: "Organisation" });
  if (ch.logoImg) slide.addImage({ data: picture(ch.logoImg.key), x: ch.logoImg.x * IN, y: ch.logoImg.y * IN, w: ch.logoImg.w * IN, h: ch.logoImg.h * IN, rounding: true, objectName: "Logo", altText: "Logo" });
}
const chrome = [
  { placeholder: { options: { name: "chapter", type: "body", x: (TH.rtl ? (ch.chap.x + ch.chap.w) * IN - 7.5 : ch.chap.x * IN), y: (ch.chap.y - 4) * IN, w: 7.5, h: (ch.chap.h + 8) * IN, margin: 0, valign: "middle", align: TH.rtl ? "right" : "left", fontSize: +(ch.chap.fs * PT).toFixed(1), bold: true, color: col(K.gold), charSpacing: +(ch.chap.ls * PT).toFixed(2) }, text: "" } },
];
const titlePh = { placeholder: { options: { name: "title", type: "title", x: 0.75, y: 0.9, w: 8.5, h: 1.1, margin: 0, fontFace: HEAD, fontSize: 30, bold: true, color: "FFFFFF", valign: "top" }, text: "" } };
const slideNumber = { x: (ch.count.x + ch.count.w) * IN - 1.2, y: (ch.count.y - 4) * IN, w: 1.2, h: (ch.count.h + 8) * IN, align: "right", fontSize: +(ch.count.fs * PT).toFixed(1), color: col(K.muted) };
pres.defineSlideMaster({ title: "Scene", background: { color: THEME.colors.dk1 }, objects: [...chrome, titlePh], slideNumber });
pres.defineSlideMaster({ title: "Cover", background: { color: THEME.colors.dk1 }, objects: [titlePh] });

// ---------------------------------------------------------------- shapes
const fillOf = (f) => f ? { color: col(f.c), transparency: Math.round((1 - f.a) * 100) } : undefined;
const lineOf = (l) => l ? { color: col(l.c), width: Math.max(0.5, +(l.w * PT).toFixed(2)), transparency: Math.round((1 - (l.a == null ? 1 : l.a)) * 100) } : undefined;
function addRect(slide, it, name) {
  const o = { x: it.x * IN, y: it.y * IN, w: Math.max(it.w, 0.5) * IN, h: Math.max(it.h, 0.5) * IN, objectName: it.name || name };
  const f = fillOf(it.fill), l = lineOf(it.line); if (f) o.fill = f; if (l) o.line = l;
  if (it.ellipse) return slide.addShape(pres.shapes.OVAL, o);
  if (it.radius > 0.5) { o.rectRadius = Math.min(it.radius, it.w / 2, it.h / 2) * IN; return slide.addShape(pres.shapes.ROUNDED_RECTANGLE, o); }
  slide.addShape(pres.shapes.RECTANGLE, o);
}
function addLine(slide, it, name) { const dx = it.x2 - it.x1, dy = it.y2 - it.y1;
  slide.addShape(pres.shapes.LINE, { x: Math.min(it.x1, it.x2) * IN, y: Math.min(it.y1, it.y2) * IN, w: Math.abs(dx) * IN, h: Math.abs(dy) * IN, flipV: dx * dy < 0, line: lineOf(it.line), objectName: name }); }
function addPath(slide, it, name) {
  const real = it.pts.filter((p) => !p.close);
  if (real.length === 2 && !real[1].c1) return addLine(slide, { x1: real[0].x, y1: real[0].y, x2: real[1].x, y2: real[1].y, line: it.line }, name);
  const xs = [], ys = []; real.forEach((p) => { xs.push(p.x); ys.push(p.y); if (p.c1) { xs.push(p.c1[0], p.c2[0]); ys.push(p.c1[1], p.c2[1]); } });
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
  const points = it.pts.map((p) => p.close ? { close: true } : p.c1 ? { x: (p.x - x0) * IN, y: (p.y - y0) * IN, curve: { type: "cubic", x1: (p.c1[0] - x0) * IN, y1: (p.c1[1] - y0) * IN, x2: (p.c2[0] - x0) * IN, y2: (p.c2[1] - y0) * IN } }
    : { x: (p.x - x0) * IN, y: (p.y - y0) * IN, moveTo: !!p.move });
  const o = { x: x0 * IN, y: y0 * IN, w: w * IN, h: h * IN, points, objectName: name }; const f = fillOf(it.fill), l = lineOf(it.line); if (f) o.fill = f; if (l) o.line = l;
  slide.addShape(pres.shapes.CUSTOM_GEOMETRY, o);
}
function addPicture(slide, it, name) {
  const o = { data: picture(it.key), x: it.x * IN, y: it.y * IN, objectName: name, altText: name };
  if (it.round) { o.w = it.w * IN; o.h = it.h * IN; o.rounding = true; }
  else { const k = Math.max(it.w / it.nw, it.h / it.nh); o.w = it.nw * k * IN; o.h = it.nh * k * IN; o.sizing = { type: it.fit === "cover" ? "cover" : "contain", w: it.w * IN, h: it.h * IN }; }
  slide.addImage(o);
}
function addText(slide, it, name) {
  const base = it.runs.find((r) => !r.br && r.para == null), natural = base.serif ? TH.natSerif : TH.natSans;   // the font's own line height, measured in the page: PowerPoint's "single" spacing
  const runs = []; let brk = false;
  let para = null;
  it.runs.forEach((r) => { if (r.br) { brk = true; return; }
    if (r.para != null) { if (runs.length) runs[runs.length - 1].options.breakLine = true; para = Math.max(0, r.para); return; }
    const o = { fontSize: +(r.fs * PT).toFixed(1), color: col(r.color), bold: !!r.bold, italic: !!r.italic };
    if (r.serif) o.fontFace = HEAD; if (r.ls > 0.4) o.charSpacing = +(r.ls * PT).toFixed(2); if (r.sub) o.subscript = true;
    if (brk) { o.softBreakBefore = true; brk = false; }
    if (para != null) { o.paraSpaceBefore = +(para * PT).toFixed(1); para = null; }
    runs.push({ text: r.text, options: o }); });
  let x = it.x, w = it.w; const slack = it.nowrap ? 0 : it.w * 0.015;                     // room for PowerPoint's slightly different line breaking
  if (it.align === "right") { x -= slack; w += slack; } else if (it.align === "center") { x -= slack / 2; w += slack; } else w += slack;
  const o = { x: x * IN, y: it.y * IN, w: Math.max(w, 2) * IN, h: Math.max(it.h, 2) * IN, margin: 0, isTextBox: true, align: it.align, valign: it.valign, wrap: !it.nowrap, objectName: name };
  if (it.lines > 1) o.lineSpacingMultiple = +Math.max(0.7, Math.min(1.6, it.lh / it.fs / natural)).toFixed(3);
  slide.addText(runs, o);
}

// ---------------------------------------------------------------- slides
const sectionOf = (s) => s.panel === "cover" ? "Cover" : s.chapter.replace(/\s+/g, " ").trim();
let section = null; const stats = { text: 0, rect: 0, line: 0, path: 0, img: 0 };
L.slides.forEach((s) => {
  const sec = sectionOf(s); if (sec !== section) { pres.addSection({ title: sec }); section = sec; }
  const slide = pres.addSlide({ masterName: s.panel === "cover" ? "Cover" : "Scene", sectionTitle: sec });
  slide.background = { path: path.join(CAP, `bg-${String(s.n).padStart(2, "0")}.jpg`) };
  if (s.panel !== "cover") { slide.addText(TH.rtl ? s.chapter : s.chapter.toUpperCase(), { placeholder: "chapter" }); addCorner(slide); }
  const merged = [];
  s.items.forEach((cur) => { const prev = merged[merged.length - 1];
    const same = prev && prev.t === "text" && cur.t === "text" && !prev.role && !cur.role && prev.valign === "top" && cur.valign === "top" && prev.align === cur.align
      && Math.abs(prev.x - cur.x) < 1.5 && Math.abs(prev.w - cur.w) < 1.5 && Math.abs(prev.fs - cur.fs) < 0.3 && Math.abs(prev.lh - cur.lh) < 0.5;
    const gap = same ? cur.y - (prev.y + prev.h) : -1;
    if (same && gap >= 0 && gap < 1.6 * cur.lh) { const natural = cur.runs.find((r) => !r.br).serif ? TH.natSerif : TH.natSans;
      prev.runs = prev.runs.concat([{ para: gap + natural * cur.fs - cur.lh }], cur.runs); prev.h = cur.y + cur.h - prev.y; prev.lines += cur.lines; prev.nowrap = prev.nowrap && cur.nowrap; }
    else merged.push(Object.assign({}, cur, { runs: cur.runs ? cur.runs.slice() : undefined })); });
  s.items = merged;
  let titled = false, callouts = 0; const seen = {};   // callouts: the labels pinned to 3D parts, named so that add_motion.ps1 can fade them in after the camera flight
  if (!s.items.some((it) => it.role === "title")) { const first = s.items.find((it) => it.t === "text" && it.fs > 30); if (first) first.role = "title"; } // a slide without a heading: its opening line is the title
  s.items.forEach((it) => { stats[it.t]++; seen[it.t] = (seen[it.t] || 0) + 1;
    const label = it.t === "text" ? it.runs.filter((r) => r.text).map((r) => r.text).join(" ").replace(/\s+/g, " ").slice(0, 40) : "";
    if (it.callout) { const nm = `Callout ${++callouts}` + (label ? `: ${label}` : ""); if (it.t === "rect") addRect(slide, Object.assign({}, it, { name: nm }), nm); else if (it.t === "line") addLine(slide, it, nm); else addText(slide, it, nm); return; }
    if (it.t === "rect") addRect(slide, it, `Shape ${seen.rect}`);
    else if (it.t === "line") addLine(slide, it, `Line ${seen.line}`);
    else if (it.t === "path") addPath(slide, it, `Curve ${seen.path}`);
    else if (it.t === "img") addPicture(slide, it, `Picture ${seen.img}: ${it.key}`);
    else if (it.t === "text") { const isTitle = it.role === "title" && !titled; if (isTitle) titled = true; addText(slide, it, isTitle ? "Title" : `Text: ${label}`); } });
  if (s.notes) slide.addNotes(s.notes);
});

// ---------------------------------------------------------------- write, then finish the package
(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  // (1) the heading of each slide becomes its title placeholder, keeping its own position; (2) a soft fade between slides
  const zip = await JSZip.loadAsync(fs.readFileSync(OUT)); let titles = 0, fades = 0;
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    let xml = await zip.file(name).async("string");
    xml = xml.replace(/(<p:cNvPr id="\d+" name="Title"[^>]*>(?:<\/p:cNvPr>)?)<p:cNvSpPr txBox="1"\/><p:nvPr>\s*<\/p:nvPr>/, (m, head) => { titles++; return head + '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr>'; });
    if (!xml.includes("<p:transition")) xml = xml.replace("</p:clrMapOvr>", () => { fades++; return '</p:clrMapOvr><p:transition spd="med"><p:fade/></p:transition>'; });
    zip.file(name, xml);
  }
  // theme font references per script, and a package with file entries only (folder entries break cloud co-editing)
  const pack = new JSZip();
  for (const name of Object.keys(zip.files)) { if (zip.files[name].dir) continue;
    let data = await zip.file(name).async("nodebuffer");
    if (/\.xml$/.test(name) && /^ppt\/(slides|slideLayouts|slideMasters)\//.test(name)) data = Buffer.from(data.toString("utf8").replace(/<a:ea typeface="\+mj-lt"/g, '<a:ea typeface="+mj-ea"').replace(/<a:cs typeface="\+mj-lt"/g, '<a:cs typeface="+mj-cs"'), "utf8");
    pack.file(name, data, { createFolders: false }); }
  fs.writeFileSync(OUT, await pack.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
  console.log(`${OUT}  ${fs.statSync(OUT).size.toLocaleString()} bytes  slides=${L.slides.length}  titles=${titles}  fades=${fades}  items=${JSON.stringify(stats)}`);
})().catch((e) => { console.error(e); process.exit(1); });
