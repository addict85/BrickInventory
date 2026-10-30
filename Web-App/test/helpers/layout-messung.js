/**
 * Messungen, die im Browser laufen (als Ausdruck für Runtime.evaluate): Layout
 * und Kontrast der sichtbaren Oberfläche, dazu axe-core. Benutzt von
 * test/oberflaeche-browser.test.js.
 */
const fs = require('node:fs');
const path = require('node:path');

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js', { paths: [path.join(__dirname, '..', '..')] }), 'utf8');

/** axe auf der offenen Seite; zurück kommen nur Verstösse der Stufen serious und critical. */
const AXE_LAUF = `(async () => {
  if (!window.axe) { (0, eval)(${JSON.stringify(AXE)}); }
  const wurzel = document.querySelector('.ovl.open .modal, .ovl.open') || document;
  const r = await axe.run(wurzel, { resultTypes: ['violations'], rules: { region: { enabled: false } } });
  return r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    .flatMap(v => v.nodes.slice(0, 4).map(n => v.id + ': ' + n.target.join(' ') + (n.any?.[0]?.message ? ' — ' + n.any[0].message.slice(0, 90) : '')));
})()`;

/**
 * Layout: waagrechter Überlauf, Tippziele (Telefon ≥ 44 px), überlappende
 * Bedienelemente, abgeschnittener Text ohne „…“, Kontrast von Text und
 * Platzhaltern (4,5:1, gross 3:1). Gemessen wird im offenen Dialog, sonst auf
 * der Seite.
 */
const LAYOUT = (telefon) => `(() => {
  const telefon = ${telefon ? 'true' : 'false'};
  const wurzel = document.querySelector('.ovl.open') || document.body;
  const rgba = (s) => { const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const hell = (f) => 0.2126 * lin(f.r) + 0.7152 * lin(f.g) + 0.0722 * lin(f.b);
  const ueber = (o, u) => ({ r: o.r * o.a + u.r * (1 - o.a), g: o.g * o.a + u.g * (1 - o.a), b: o.b * o.a + u.b * (1 - o.a), a: 1 });
  const kontrast = (v, h) => { const [a, b] = [hell(v), hell(h)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
  const deckkraft = (e) => { let o = 1; for (let x = e; x; x = x.parentElement) o *= +getComputedStyle(x).opacity; return o; };
  const sichtbar = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none') return false;
    return !e.closest('[hidden], [inert], [aria-hidden="true"], details:not([open]) > :not(summary)') && deckkraft(e) > 0.1; };
  const grund = (e) => { const schichten = [];
    for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x);
      if (s.backgroundImage !== 'none' && !s.backgroundImage.startsWith('url')) return null;
      const f = rgba(s.backgroundColor); if (f && f.a > 0) { schichten.push(f); if (f.a >= 1) break; } }
    let g = { r: 255, g: 255, b: 255, a: 1 }; for (const f of schichten.reverse()) g = ueber(f, g); return g; };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 2).map(c => '.' + c).join('')
    + ((e.textContent || e.getAttribute('aria-label') || '').trim() ? ' „' + (e.textContent.trim() || e.getAttribute('aria-label')).replace(/\\s+/g, ' ').slice(0, 24) + '“' : '');
  // Eigene Ebene: fest, klebend oder absolut mit z-index (Klappmenüs liegen über der Seite).
  const fest = (e) => { for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x); if (s.position === 'fixed' || s.position === 'sticky' || (s.position === 'absolute' && s.zIndex !== 'auto')) return x; } return null; };
  const funde = [];

  // 1. Waagrechter Überlauf der Seite.
  const breite = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > breite + 1) {
    const zu = [...wurzel.querySelectorAll('*')].filter(e => sichtbar(e) && e.getBoundingClientRect().right > breite + 1
      && ![...(function* () { for (let x = e.parentElement; x; x = x.parentElement) yield x; })()].some(x => /auto|scroll|hidden|clip/.test(getComputedStyle(x).overflowX)));
    funde.push('Überlauf ' + (document.documentElement.scrollWidth - breite) + ' px: ' + zu.slice(0, 3).map(name).join(', '));
  }

  // 2. Bedienelemente: Tippziele und Überlappung.
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [tabindex]:not([tabindex="-1"])';
  const ziele = [...wurzel.querySelectorAll(SEL)].filter(e => {
    if (e.closest('.ovl:not(.open)') || e.matches('.sprunglink, [disabled]')) return false;
    if (e.matches('input') && e.closest('label')) return sichtbar(e.closest('label'));
    return sichtbar(e);
  }).map(e => {
    const flaeche = e.matches('input') && e.closest('label') ? e.closest('label') : e;
    return { e, flaeche, r: flaeche.getBoundingClientRect() };
  });
  const eindeutig = [...new Map(ziele.map(z => [z.flaeche, z])).values()];
  if (telefon) {
    for (const z of eindeutig) {
      // Ein Verweis mitten im Fliesstext ist ausgenommen (WCAG 2.5.8, Ausnahme „inline“).
      if (z.e.matches('a') && [...z.e.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
      if (z.r.width < 43.5 || z.r.height < 43.5) funde.push('Tippziel ' + Math.round(z.r.width) + '×' + Math.round(z.r.height) + ': ' + name(z.flaeche));
    }
  }
  for (let i = 0; i < eindeutig.length; i++) for (let k = i + 1; k < eindeutig.length; k++) {
    const a = eindeutig[i], b = eindeutig[k];
    if (a.flaeche.contains(b.flaeche) || b.flaeche.contains(a.flaeche) || fest(a.flaeche) !== fest(b.flaeche)) continue;
    const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (x > 1 && y > 1) funde.push('Überlappung ' + Math.round(x) + '×' + Math.round(y) + ': ' + name(a.flaeche) + ' / ' + name(b.flaeche));
  }

  // 3. Abgeschnittener Text ohne Auslassungszeichen, 4. Kontrast.
  for (const e of wurzel.querySelectorAll('*')) {
    if (!sichtbar(e) || e.closest('svg, img, canvas, video, .color-dot, [data-farbe], .bild-ph, .skelett, .vh')) continue;
    const text = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const s = getComputedStyle(e);
    if (text && e.scrollWidth > e.clientWidth + 1 && /hidden|clip/.test(s.overflowX) && s.textOverflow !== 'ellipsis')
      funde.push('abgeschnitten: ' + name(e));
    const ph = e.matches('input[placeholder]:placeholder-shown, textarea[placeholder]:placeholder-shown');
    // Gesperrte Bedienelemente sind von der Kontrastregel ausgenommen (WCAG 1.4.3).
    if ((!text && !ph) || e.closest(':disabled, [aria-disabled="true"]')) continue;
    const g = grund(e); if (!g) continue;
    const farbe = ph ? getComputedStyle(e, '::placeholder').color : s.color;
    const vorne = rgba(farbe); if (!vorne) continue;
    const k = kontrast(ueber({ ...vorne, a: vorne.a * deckkraft(e) }, g), g);
    const gross = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
    if (k < (gross && !ph ? 3 : 4.5) - 0.005) funde.push('Kontrast ' + k.toFixed(2) + ':1' + (ph ? ' (Platzhalter)' : '') + ': ' + name(e));
  }
  return [...new Set(funde)];
})()`;

module.exports = { AXE_LAUF, LAYOUT };
