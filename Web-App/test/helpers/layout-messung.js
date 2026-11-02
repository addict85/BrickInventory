/**
 * Messungen, die im Browser laufen (als Ausdruck für Runtime.evaluate): Layout
 * und Kontrast der sichtbaren Oberfläche, dazu axe-core. Benutzt von
 * test/oberflaeche-browser.test.js.
 */
const fs = require('node:fs');
const path = require('node:path');

const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js', { paths: [path.join(__dirname, '..', '..')] }), 'utf8');

/** Der oberste offene Dialog (wie obersterDialog in 01-dialoge.js), sonst null. */
const OBERSTER = `(() => { let d = null, z = -Infinity;
  for (const el of document.querySelectorAll('.ovl[role=dialog]')) {
    const offen = el.style.display ? el.style.display !== 'none' : el.classList.contains('open');
    const zi = parseInt(getComputedStyle(el).zIndex, 10) || 0;
    if (offen && zi >= z) { d = el; z = zi; } }
  return d; })()`;

/** axe auf der offenen Seite; zurück kommen nur Verstösse der Stufen serious und critical. */
const AXE_LAUF = `(async () => {
  if (!window.axe) { (0, eval)(${JSON.stringify(AXE)}); }
  const d = ${OBERSTER}; const wurzel = d?.querySelector('.modal') || d || document;
  const r = await axe.run(wurzel, { resultTypes: ['violations'], rules: { region: { enabled: false } } });
  return r.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    .flatMap(v => v.nodes.slice(0, 4).map(n => v.id + ': ' + n.target.join(' ') + (n.any?.[0]?.message ? ' — ' + n.any[0].message.slice(0, 90) : '')));
})()`;

/**
 * Layout: waagrechter Überlauf, Tippziele (Telefon ≥ 44 px, Rechner ≥ 24 px),
 * überlappende Bedienelemente, abgeschnittener Text ohne „…“, Kontrast von
 * Text und Platzhaltern (4,5:1, gross 3:1) und von Feldgrenzen und
 * Sinnbild-Knöpfen (3:1). Gemessen wird im offenen Dialog, sonst auf der Seite.
 */
const LAYOUT = (telefon) => `(() => {
  const telefon = ${telefon ? 'true' : 'false'};
  const wurzel = ${OBERSTER} || document.body;
  const rgba = (s) => { const c = String(s).match(/color\\(srgb ([^)]+)\\)/);
    if (c) { const [r, g, b, a = 1] = c[1].replace('/', ' ').split(/\\s+/).filter(Boolean).map(Number); return { r: r * 255, g: g * 255, b: b * 255, a }; }
    const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
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

  // 1. Waagrechter Überlauf: die Seite selbst, und Elemente über den Fensterrand
  //    (auch wenn ein Vorfahr sie abschneidet — dann fehlt ein Stück). Nur
  //    Rollbereiche dürfen breiter sein.
  const breite = document.documentElement.clientWidth;
  const rollt = (e) => { for (let x = e.parentElement; x; x = x.parentElement) if (/auto|scroll/.test(getComputedStyle(x).overflowX)) return true; return false; };
  const zu = [...wurzel.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect();
    return r.width > 2 && (r.right > breite + 1 || r.left < -1) && sichtbar(e) && !rollt(e); });
  if (document.documentElement.scrollWidth > breite + 1 || zu.length)
    funde.push('Überlauf ' + Math.max(0, document.documentElement.scrollWidth - breite) + ' px: ' + zu.slice(0, 3).map(name).join(', '));

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
  // Telefon 44 px (eigene Vorgabe), Rechner 24 px (WCAG 2.5.8).
  const MIN = telefon ? 43.5 : 23.5;
  for (const z of eindeutig) {
    // Ein Verweis mitten im Fliesstext ist ausgenommen (WCAG 2.5.8, Ausnahme „inline“).
    if (z.e.matches('a') && [...z.e.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (z.r.width < MIN || z.r.height < MIN) funde.push('Tippziel ' + Math.round(z.r.width) + '×' + Math.round(z.r.height) + ': ' + name(z.flaeche));
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
  // 5. Nicht-Text-Kontrast (WCAG 1.4.11): Ein Formularfeld braucht eine Grenze
  //    mit 3:1 zur Umgebung — Rand oder eigene Füllfarbe. Ein Knopf nur mit
  //    Sinnbild braucht 3:1 für das Sinnbild.
  const umgebung = (e) => grund(e.parentElement);
  const feld = 'input:not([type=hidden]):not([type=file]):not([type=range]):not([type=color]), select, textarea';
  for (const e of wurzel.querySelectorAll(feld + ', [role=switch]')) {
    if (!sichtbar(e) || e.closest(':disabled, [aria-disabled="true"], .datei-versteckt') || e.matches('.datei-versteckt')) continue;
    const s = getComputedStyle(e);
    if ((e.type === 'checkbox' || e.type === 'radio') && s.appearance !== 'none') continue;   // gezeichnet vom Browser
    const u = umgebung(e); if (!u) continue;
    const fuell = rgba(s.backgroundColor);
    let best = fuell && fuell.a > 0 ? kontrast(ueber(fuell, u), u) : 1;
    // Ein gezeichnetes Kästchen (appearance: none, Verlaufsschichten) hat seine Grenze im Bild.
    for (const f of s.backgroundImage.match(/(rgba?|color)\\([^)]*\\)/g) || []) { const c = rgba(f); if (c && c.a > 0) best = Math.max(best, kontrast(ueber(c, u), u)); }
    if (e.matches(':focus') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1) {
      const o = rgba(s.outlineColor); if (o && o.a > 0) best = Math.max(best, kontrast(ueber(o, u), u));
    }
    for (const seite of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(s['border' + seite + 'Width']) < 1 || s['border' + seite + 'Style'] === 'none') continue;
      const r = rgba(s['border' + seite + 'Color']); if (r && r.a > 0) best = Math.max(best, kontrast(ueber(r, u), u));
    }
    if (best < 2.995) funde.push('Feldgrenze ' + best.toFixed(2) + ':1: ' + name(e));
  }
  for (const z of eindeutig) {
    const e = z.e;
    if (!e.matches('button, [role=button]') || (e.textContent || '').trim() || !e.querySelector('svg')) continue;
    const g = grund(e); if (!g) continue;
    const ic = rgba(getComputedStyle(e.querySelector('svg')).color); if (!ic) continue;
    const k = kontrast(ueber({ ...ic, a: ic.a * deckkraft(e) }, g), g);
    if (k < 2.995) funde.push('Sinnbild ' + k.toFixed(2) + ':1: ' + name(e));
  }
  // 6. Knopfgrenze: Ein Knopf hebt sich mit Rand oder Fläche 3:1 von der
  //    Umgebung ab. Segmente einer Gruppe (Ansicht, Sammlungswahl) zählen über
  //    den Rand der Gruppe; ihr aktiver Zustand wird unter 7. gemessen.
  const grenze = (e) => { const s = getComputedStyle(e), u = umgebung(e); if (!u) return null;
    const f = rgba(s.backgroundColor); let best = f && f.a > 0 ? kontrast(ueber(f, u), u) : 1;
    for (const seite of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(s['border' + seite + 'Width']) < 1 || s['border' + seite + 'Style'] === 'none') continue;
      const r = rgba(s['border' + seite + 'Color']); if (r && r.a > 0) best = Math.max(best, kontrast(ueber(r, u), u)); }
    return best; };
  const KNOPF = '.btn, .period-btn, .ubadge-knopf, .v-btn, .vtgl, .sammlung-wahl';
  for (const e of wurzel.querySelectorAll(KNOPF)) {
    if (!sichtbar(e) || e.closest(':disabled, [aria-disabled="true"]') || e.matches(':disabled')) continue;
    const k = grenze(e); if (k === null) continue;
    if (k < 2.995) funde.push('Knopfgrenze ' + k.toFixed(2) + ':1: ' + name(e));
  }
  // 7. Aktiver Zustand: Das aktive Element unterscheidet sich vom inaktiven
  //    Nachbarn mit 3:1 — als Fläche gegen Fläche oder als Rand (≥ 2 px)
  //    gegen die Fläche, auf der er liegt.
  const AKTIV = '.vb.active, .sammlung-wahl [aria-current="page"], .period-btn.active, .ntab.active, .einst-nav a[aria-current]';
  for (const e of wurzel.querySelectorAll(AKTIV)) {
    if (!sichtbar(e)) continue;
    const nachbar = [...e.parentElement.children].find(x => x !== e && x.tagName === e.tagName && !x.matches(AKTIV) && sichtbar(x));
    if (!nachbar) continue;
    const u = umgebung(e); if (!u) continue;
    const fa = rgba(getComputedStyle(e).backgroundColor), fi = rgba(getComputedStyle(nachbar).backgroundColor);
    const a = fa && fa.a > 0 ? ueber(fa, u) : u, i = fi && fi.a > 0 ? ueber(fi, u) : u;
    let best = kontrast(a, i);
    const s = getComputedStyle(e);
    for (const seite of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(s['border' + seite + 'Width']) < 1.9 || s['border' + seite + 'Style'] === 'none') continue;
      const r = rgba(s['border' + seite + 'Color']); if (r && r.a > 0) best = Math.max(best, kontrast(ueber(r, u), i));
    }
    if (best < 2.995) funde.push('aktiver Zustand ' + best.toFixed(2) + ':1: ' + name(e));
  }
  return [...new Set(funde)];
})()`;

/**
 * Tastatur im offenen Dialog: Jedes Bedienelement muss per Tab erreichbar
 * sein, und jede Klickfläche (data-click) muss den Fokus nehmen können.
 * VORBEREITEN markiert die Ziele und liefert ihre Zahl; danach drückt der
 * Test Tab und fragt BESUCHT, wo der Fokus steht.
 */
const TAB_VORBEREITEN = `(() => {
  const d = ${OBERSTER}; if (!d) return null;
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const bereit = (e) => !e.disabled && !e.closest('[inert], [hidden]') &&
    (e.matches('.datei-versteckt') ? e.parentElement.checkVisibility() : e.checkVisibility({ visibilityProperty: true }));
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 2).map(c => '.' + c).join('')
    + ' „' + (e.textContent.trim() || e.getAttribute('aria-label') || e.getAttribute('data-click') || '').replace(/\s+/g, ' ').slice(0, 24) + '“';
  const funde = [];
  for (const e of d.querySelectorAll('[data-click]'))
    if (bereit(e) && !e.closest(SEL) && !e.closest('label')) funde.push('Klickfläche ohne Tastatur: ' + name(e));
  // Ein Knopf-Label (Datei wählen) braucht ein Feld, das den Fokus nehmen kann.
  for (const l of d.querySelectorAll('label.btn'))
    if (l.checkVisibility() && (!l.control || !l.control.checkVisibility())) funde.push('Knopf ohne Tastatur: ' + name(l));
  let n = 0;
  for (const e of d.querySelectorAll(SEL)) {
    if (!bereit(e)) continue;
    // Eine Optionsgruppe ist EIN Tab-Halt.
    const gruppe = e.type === 'radio' && e.name ? d.querySelector('input[type=radio][name="' + e.name + '"][data-tabprobe]') : null;
    e.dataset.tabprobe = gruppe ? gruppe.dataset.tabprobe : String(n++);
    e.dataset.tabname = name(e);
  }
  const f = d.firstElementChild || d; if (!f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1'); f.focus();
  return { n, funde };
})()`;
const TAB_STAND = `(() => { const a = document.activeElement, d = ${OBERSTER};
  return { id: a?.dataset?.tabprobe ?? null, drin: !!d && d.contains(a),
           wo: a ? a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') : '' }; })()`;
const TAB_FEHLT = (besucht) => `(() => { const b = new Set(${JSON.stringify(besucht)}); const raus = [];
  for (const e of document.querySelectorAll('[data-tabprobe]')) { if (!b.has(e.dataset.tabprobe)) raus.push(e.dataset.tabname); delete e.dataset.tabprobe; delete e.dataset.tabname; }
  return [...new Set(raus)]; })()`;

/** Drückt Tab, bis jedes Ziel einmal dran war; ein Datumsfeld nimmt je Teil einen Tab. */
async function tabPruefung(b) {
  const v = await b.auswerten(TAB_VORBEREITEN);
  if (!v) return [];
  const funde = [...v.funde], besucht = [];
  for (let i = 0; i < 3 * v.n + 6 && new Set(besucht).size < v.n; i++) {
    await b.tab('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const st = await b.auswerten(TAB_STAND);
    if (!st.drin) funde.push('Fokus verlässt den Dialog (auf ' + st.wo + ')');
    if (st.id !== null) besucht.push(st.id);
  }
  for (const f of await b.auswerten(TAB_FEHLT(besucht))) funde.push('nicht per Tab erreichbar: ' + f);
  return [...new Set(funde)];
}

module.exports = { AXE_LAUF, LAYOUT, tabPruefung };
