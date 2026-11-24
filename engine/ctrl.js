/* ctrl.js: the slide controller. Each <section class="slide"> tells the stage what to show through data- attributes:
     data-scene   which scene (default: the first one scene.js creates)
     data-cam     camera name (default: the scene's first camera)
     data-shift   lens shift: where the subject sits sideways, -1..1 (default 0.3 beside a left panel, -0.3 beside a right one)
     data-dim     0..1 darkens the scene behind a text or chart slide
     data-orbit   slow orbit, radians per second
     data-labels  comma-separated callouts to show
     data-hero    the journey the hero drop travels
     data-chapter the running head, data-notes the speaker notes
   Any other data- attribute reaches scene.js as c.d.name / c.num("name", default).
   ?capture in the address removes every transition (screenshots, tests). */
(function () {
  const slides = Array.from(document.querySelectorAll('.slide'));
  const IMG = (window.ASSETS && window.ASSETS.img) || {};
  document.querySelectorAll('[data-asset]').forEach((im) => { const a = IMG[im.dataset.asset]; if (a) im.src = a; else console.error("no picture '" + im.dataset.asset + "' in assets.js"); });
  const CAP = /capture/.test(location.search); if (CAP) { document.body.classList.add('capture'); window.__CUT = true; }
  const el = (id) => document.getElementById(id);
  STAGE.start();
  let cur = -1;
  function go(i) {
    i = Math.max(0, Math.min(slides.length - 1, i)); if (i === cur) return;
    if (cur >= 0) slides[cur].classList.remove('on');
    cur = i; const s = slides[i]; s.classList.add('on');
    // restart the slide's own drawings
    s.querySelectorAll('svg').forEach((svg) => { try { svg.setCurrentTime(CAP ? 60 : 0); } catch (e) {} });
    if (!CAP) s.querySelectorAll('.draw,.pop').forEach((n) => { n.style.animation = 'none'; n.offsetHeight; n.style.animation = ''; });
    const d = s.dataset, num = (k, def) => (d[k] == null || d[k] === '' ? def : +d[k]);
    window.PRES3D.setSlide({ d, scene: d.scene, cam: d.cam, hero: d.hero, dim: num('dim', 0), orbit: num('orbit', 0), cut: !!window.__CUT,
      labels: d.labels ? d.labels.split(',').map((t) => t.trim()).filter(Boolean) : [],
      shift: num('shift', s.querySelector('.panel.left') ? 0.3 : s.querySelector('.panel.right') ? -0.3 : 0) });
    document.body.classList.toggle('on-cover', s.classList.contains('cover'));
    if (el('chap')) el('chap').textContent = d.chapter || '';
    if (el('count')) el('count').textContent = String(i + 1).padStart(2, '0') + ' / ' + String(slides.length).padStart(2, '0');
    if (el('prog')) el('prog').style.width = ((i + 1) / slides.length * 100) + '%';
    if (i > 0 && el('hint')) el('hint').style.opacity = 0;
    if (location.hash !== '#' + (i + 1)) history.replaceState(null, '', '#' + (i + 1));
  }
  window.goSlide = go;
  document.addEventListener('keydown', (e) => {
    if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(cur + 1); }
    else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(cur - 1); }
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(slides.length - 1);
    else if (e.key === 'f' || e.key === 'F') { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); }
  });
  document.addEventListener('click', (e) => { if (e.clientX > innerWidth * 0.25) go(cur + 1); else go(cur - 1); });
  const h = parseInt((location.hash || '#1').slice(1), 10) || 1; go(h - 1);
})();
