/**
 * Measurements that run in the browser (as an expression for Runtime.evaluate): layout
 * and contrast of the visible UI, plus axe-core. Used by
 * test/helpers/ui-check.js.
 */
const fs = require('node:fs');
const path = require('node:path');

const AXE = fs.readFileSync(
  require.resolve('axe-core/axe.min.js', { paths: [path.join(__dirname, '..', '..')] }),
  'utf8',
);

/** The topmost open dialog (like obersterDialog in dialoge.js), otherwise null. */
const TOPMOST = `(() => { let d = null, z = -Infinity;
  for (const el of document.querySelectorAll('.ovl[role=dialog]')) {
    const isOpen = el.style.display ? el.style.display !== 'none' : el.classList.contains('open');
    const zi = parseInt(getComputedStyle(el).zIndex, 10) || 0;
    if (isOpen && zi >= z) { d = el; z = zi; } }
  return d; })()`;

/** axe on the open page, all levels: “moderate” (heading order, landmarks) and “minor” are also
 * findings a review finds. */
const AXE_RUN = `(async () => {
  if (!window.axe) { (0, eval)(${JSON.stringify(AXE)}); }
  const d = ${TOPMOST}; const root = d?.querySelector('.modal') || d || document;
  const r = await axe.run(root, { resultTypes: ['violations'], rules: { region: { enabled: false } } });
  return r.violations
    .flatMap(v => v.nodes.slice(0, 4).map(n => v.id + ': ' + n.target.join(' ') + (n.any?.[0]?.message ? ' — ' + n.any[0].message.slice(0, 90) : '')));
})()`;

/**
 * Layout: horizontal overflow, tap targets (phone ≥ 44 px, desktop ≥ 24 px),
 * overlapping controls, too narrow or obscured text blocks,
 * cut-off text without “…”, contrast of
 * text and placeholders (4.5:1, large 3:1) and of field borders and
 * icon buttons (3:1). Measured in the open dialog, otherwise on the page.
 */
const LAYOUT = phone => `(() => {
  const phone = ${phone ? 'true' : 'false'};
  const root = ${TOPMOST} || document.body;
  const rgba = (s) => { const c = String(s).match(/color\\(srgb ([^)]+)\\)/);
    if (c) { const [r, g, b, a = 1] = c[1].replace('/', ' ').split(/\\s+/).filter(Boolean).map(Number); return { r: r * 255, g: g * 255, b: b * 255, a }; }
    const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const hell = (f) => 0.2126 * lin(f.r) + 0.7152 * lin(f.g) + 0.0722 * lin(f.b);
  const over = (o, u) => ({ r: o.r * o.a + u.r * (1 - o.a), g: o.g * o.a + u.g * (1 - o.a), b: o.b * o.a + u.b * (1 - o.a), a: 1 });
  const kontrast = (v, h) => { const [a, b] = [hell(v), hell(h)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
  const deckkraft = (e) => { let o = 1; for (let x = e; x; x = x.parentElement) o *= +getComputedStyle(x).opacity; return o; };
  const visible = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none') return false;
    return !e.closest('[hidden], [inert], [aria-hidden="true"], details:not([open]) > :not(summary)') && deckkraft(e) > 0.1; };
  const reason = (e) => { const schichten = [];
    for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x);
      if (s.backgroundImage !== 'none' && !s.backgroundImage.startsWith('url')) return null;
      const f = rgba(s.backgroundColor); if (f && f.a > 0) { schichten.push(f); if (f.a >= 1) break; } }
    let g = { r: 255, g: 255, b: 255, a: 1 }; for (const f of schichten.reverse()) g = over(f, g); return g; };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 2).map(c => '.' + c).join('')
    + ((e.textContent || e.getAttribute('aria-label') || '').trim() ? ' „' + (e.textContent.trim() || e.getAttribute('aria-label')).replace(/\\s+/g, ' ').slice(0, 24) + '“' : '');
  // Eigene Ebene: fest, klebend oder absolut mit z-index (Klappmenüs liegen über der Seite).
  const fest = (e) => { for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x); if (s.position === 'fixed' || s.position === 'sticky' || (s.position === 'absolute' && s.zIndex !== 'auto')) return x; } return null; };
  const findings = [];

  // 1. Waagrechter Überlauf: die Seite selbst, und Elemente über den Fensterrand
  //    (auch wenn ein Vorfahr sie abschneidet — dann fehlt ein Stück). Nur
  //    Rollbereiche dürfen breiter sein.
  const width = document.documentElement.clientWidth;
  const rollt = (e) => { for (let x = e.parentElement; x; x = x.parentElement) if (/auto|scroll/.test(getComputedStyle(x).overflowX)) return true; return false; };
  const closed = [...root.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect();
    return r.width > 2 && (r.right > width + 1 || r.left < -1) && visible(e) && !rollt(e); });
  if (document.documentElement.scrollWidth > width + 1 || closed.length)
  {
    // Zuerst, was im Fluss am weitesten hinausragt: Es zieht die Seite breit; feste Leisten folgen nur.
    const right = (e) => e.getBoundingClientRect().right;
    const zieher = closed.filter(e => !fest(e)).sort((a, b) => right(b) - right(a));
    const list = [...zieher.slice(0, 2), ...closed.filter(e => !zieher.slice(0, 2).includes(e)).slice(0, 3 - Math.min(2, zieher.length))];
    // Ragt nichts Sichtbares hinaus, zieht ein verborgenes Element die Seite breit: das äusserste nennen.
    let outer = null;
    if (!zieher.length) for (const e of document.body.querySelectorAll('*')) { const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > width + 1 && !fest(e) && !rollt(e) && (!outer || r.right > outer.r)) outer = { e, r: r.right }; }
    const verborgen = outer ? '; verborgen: ' + name(outer.e) + ' bis ' + Math.round(outer.r) + ' px' : '';
    // Die Reiterleiste ist fest und kann das Fenster selbst aufweiten: dann ihre Masse dazu.
    const bar = list.find(e => e.matches('nav:not(.settings-nav)'));
    const ls = bar && getComputedStyle(bar);
    const tabs = bar ? [...bar.querySelectorAll('.ntab')].filter(visible) : [];
    const measures = bar ? '; Leiste ' + Math.round(bar.getBoundingClientRect().width) + ' px, Schrift ' + ls.fontSize + ', ' + ls.flexWrap + ', ' + tabs.length + ' Reiter je ' + (tabs[0] ? getComputedStyle(tabs[0]).flexBasis : '?') + ' (' + tabs.map(r => Math.round(r.getBoundingClientRect().width)).join('/') + ')' : '';
    findings.push('Überlauf ' + Math.max(0, document.documentElement.scrollWidth - width) + ' px (Fenster ' + innerWidth + ', Seite ' + width + '): ' + list.map(name).join(', ') + verborgen + measures);
  }

  // 2. Bedienelemente: Tippziele und Überlappung.
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [tabindex]:not([tabindex="-1"])';
  const targets = [...root.querySelectorAll(SEL)].filter(e => {
    if (e.closest('.ovl:not(.open)') || e.matches('.skip-link, [disabled]')) return false;
    if (e.matches('input') && e.closest('label')) return visible(e.closest('label'));
    return visible(e);
  }).map(e => {
    const flaeche = e.matches('input') && e.closest('label') ? e.closest('label') : e;
    return { e, flaeche, r: flaeche.getBoundingClientRect() };
  });
  const eindeutig = [...new Map(targets.map(z => [z.flaeche, z])).values()];
  // Telefon 44 px (eigene Vorgabe), Rechner 24 px (WCAG 2.5.8).
  const MIN = phone ? 43.5 : 23.5;
  for (const z of eindeutig) {
    // Ein Verweis mitten im Fliesstext ist ausgenommen (WCAG 2.5.8, Ausnahme „inline“).
    if (z.e.matches('a') && [...z.e.parentElement.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (z.r.width < MIN || z.r.height < MIN) findings.push('Tippziel ' + Math.round(z.r.width) + '×' + Math.round(z.r.height) + ': ' + name(z.flaeche));
  }
  for (let i = 0; i < eindeutig.length; i++) for (let k = i + 1; k < eindeutig.length; k++) {
    const a = eindeutig[i], b = eindeutig[k];
    if (a.flaeche.contains(b.flaeche) || b.flaeche.contains(a.flaeche) || fest(a.flaeche) !== fest(b.flaeche)) continue;
    const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (x > 1 && y > 1) findings.push('Überlappung ' + Math.round(x) + '×' + Math.round(y) + ': ' + name(a.flaeche) + ' / ' + name(b.flaeche));
  }

  // 3. Abgeschnittener Text ohne Auslassungszeichen, 4. Kontrast.
  for (const e of root.querySelectorAll('*')) {
    if (!visible(e) || e.closest('svg, img, canvas, video, .color-dot, [data-color-hex], .image-ph, .skeleton, .vh')) continue;
    const text = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const s = getComputedStyle(e);
    if (text && e.scrollWidth > e.clientWidth + 1 && /hidden|clip/.test(s.overflowX) && s.textOverflow !== 'ellipsis')
      findings.push('abgeschnitten: ' + name(e));
    const ph = e.matches('input[placeholder]:placeholder-shown, textarea[placeholder]:placeholder-shown');
    // Gesperrte Bedienelemente sind von der Kontrastregel ausgenommen (WCAG 1.4.3).
    if ((!text && !ph) || e.closest(':disabled, [aria-disabled="true"]')) continue;
    const g = reason(e); if (!g) continue;
    const farbe = ph ? getComputedStyle(e, '::placeholder').color : s.color;
    const front = rgba(farbe); if (!front) continue;
    const k = kontrast(over({ ...front, a: front.a * deckkraft(e) }, g), g);
    const gross = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
    if (k < (gross && !ph ? 3 : 4.5) - 0.005) findings.push('Kontrast ' + k.toFixed(2) + ':1' + (ph ? ' (Platzhalter)' : '') + ': ' + name(e));
  }
  // 5. Nicht-Text-Kontrast (WCAG 1.4.11): Ein Formularfeld braucht eine Grenze
  //    mit 3:1 zur Umgebung — Rand oder eigene Füllfarbe. Ein Knopf nur mit
  //    Sinnbild braucht 3:1 für das Sinnbild.
  const umgebung = (e) => reason(e.parentElement);
  const feld = 'input:not([type=hidden]):not([type=file]):not([type=range]):not([type=color]), select, textarea';
  for (const e of root.querySelectorAll(feld + ', [role=switch]')) {
    if (!visible(e) || e.closest(':disabled, [aria-disabled="true"], .file-hidden') || e.matches('.file-hidden')) continue;
    const s = getComputedStyle(e);
    if ((e.type === 'checkbox' || e.type === 'radio') && s.appearance !== 'none') continue;   // gezeichnet vom Browser
    const u = umgebung(e); if (!u) continue;
    const fuell = rgba(s.backgroundColor);
    let best = fuell && fuell.a > 0 ? kontrast(over(fuell, u), u) : 1;
    // Ein gezeichnetes Kästchen (appearance: none, Verlaufsschichten) hat seine Grenze im Bild.
    for (const f of s.backgroundImage.match(/(rgba?|color)\\([^)]*\\)/g) || []) { const c = rgba(f); if (c && c.a > 0) best = Math.max(best, kontrast(over(c, u), u)); }
    if (e.matches(':focus') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1) {
      const o = rgba(s.outlineColor); if (o && o.a > 0) best = Math.max(best, kontrast(over(o, u), u));
    }
    for (const page of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(s['border' + page + 'Width']) < 1 || s['border' + page + 'Style'] === 'none') continue;
      const r = rgba(s['border' + page + 'Color']); if (r && r.a > 0) best = Math.max(best, kontrast(over(r, u), u));
    }
    if (best < 2.995) findings.push('Feldgrenze ' + best.toFixed(2) + ':1: ' + name(e));
  }
  for (const z of eindeutig) {
    const e = z.e;
    if (!e.matches('button, [role=button]') || (e.textContent || '').trim() || !e.querySelector('svg')) continue;
    const g = reason(e); if (!g) continue;
    const ic = rgba(getComputedStyle(e.querySelector('svg')).color); if (!ic) continue;
    const k = kontrast(over({ ...ic, a: ic.a * deckkraft(e) }, g), g);
    if (k < 2.995) findings.push('Sinnbild ' + k.toFixed(2) + ':1: ' + name(e));
  }
  // 6. Knopfgrenze: Ein Knopf hebt sich mit Rand oder Fläche 3:1 von der
  //    Umgebung ab. Segmente einer Gruppe (Ansicht, Sammlungswahl, Zeitraum) zählen
  //    über den Rand der Gruppe; ihr aktiver Zustand wird unter 7. gemessen.
  const limit = (e) => { const s = getComputedStyle(e), u = umgebung(e); if (!u) return null;
    const f = rgba(s.backgroundColor); let best = f && f.a > 0 ? kontrast(over(f, u), u) : 1;
    for (const page of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(s['border' + page + 'Width']) < 1 || s['border' + page + 'Style'] === 'none') continue;
      const r = rgba(s['border' + page + 'Color']); if (r && r.a > 0) best = Math.max(best, kontrast(over(r, u), u)); }
    return best; };
  const KNOPF = '.btn, .period-btn:not(.period-choice > *), .ubadge-button, .v-btn, .vtgl, .period-choice, .collection-choice';
  for (const e of root.querySelectorAll(KNOPF)) {
    if (!visible(e) || e.closest(':disabled, [aria-disabled="true"]') || e.matches(':disabled')) continue;
    const k = limit(e); if (k === null) continue;
    if (k < 2.995) findings.push('Knopfgrenze ' + k.toFixed(2) + ':1: ' + name(e));
  }
  // 7. Aktiver Zustand: Das aktive Element unterscheidet sich vom inaktiven
  //    Nachbarn mit 3:1 — als Fläche gegen Fläche oder als Rand (≥ 2 px)
  //    gegen die Fläche, auf der er liegt.
  const AKTIV = '.vb.active, .collection-choice [aria-current="page"], .period-btn.active, .ntab.active, .settings-nav a[aria-current]';
  for (const e of root.querySelectorAll(AKTIV)) {
    if (!visible(e)) continue;
    const nachbar = [...e.parentElement.children].find(x => x !== e && x.tagName === e.tagName && !x.matches(AKTIV) && visible(x));
    if (!nachbar) continue;
    const u = umgebung(e); if (!u) continue;
    const fa = rgba(getComputedStyle(e).backgroundColor), fi = rgba(getComputedStyle(nachbar).backgroundColor);
    const a = fa && fa.a > 0 ? over(fa, u) : u, i = fi && fi.a > 0 ? over(fi, u) : u;
    let best = kontrast(a, i);
    const s = getComputedStyle(e);
    for (const page of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(s['border' + page + 'Width']) < 1.9 || s['border' + page + 'Style'] === 'none') continue;
      const r = rgba(s['border' + page + 'Color']); if (r && r.a > 0) best = Math.max(best, kontrast(over(r, u), i));
    }
    if (best < 2.995) findings.push('aktiver Zustand ' + best.toFixed(2) + ':1: ' + name(e));
  }
  // 8. Schmaler Text: Ein Textblock, den Nachbarn auf unter 40 px drücken,
  //    steht Buchstabe für Buchstabe untereinander. Er ragt nirgends hinaus,
  //    deshalb sieht ihn die Überlaufprüfung nicht. Auch 0 px breit zählt.
  const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), zeilenText = [];
  for (let n = texts.nextNode(); n; n = texts.nextNode()) {
    const e = n.parentElement, chars = n.textContent.replace(/s+/g, '').length;
    if (chars < 4 || !e || e.closest('svg, script, style, .vh, [hidden], [aria-hidden="true"], .ovl:not(.open), details:not([open]) > :not(summary)')) continue;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || deckkraft(e) <= 0.1 || !e.getClientRects().length) continue;
    const box = e.getBoundingClientRect();
    if (box.width <= 1 && /hidden|clip/.test(s.overflow)) continue;   // absichtlich versteckt (Vorleser)
    zeilenText.push({ n, e });
    const b = document.createRange(); b.selectNodeContents(n);
    const r = b.getBoundingClientRect(), lines = new Set([...b.getClientRects()].map(x => Math.round(x.top))).size;
    const lh = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
    if ((r.width < 40 && r.height > 2.5 * lh) || (lines > 2 && chars / lines < 3))
      findings.push('schmal ' + Math.round(box.width) + ' px, ' + lines + ' Zeilen: ' + name(e));
  }
  // 10. Vom Vorfahren abgeschnitten: Eine Textzeile ragt über einen Kasten mit
  //     overflow hidden/clip hinaus, oder seitlich aus einem Dialog (der rollt nur
  //     senkrecht) — dort fehlt ein Stück („Marktp…“ ohne „…“).
  const kappt = (e) => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
    const o = getComputedStyle(x).overflowX; if (o === 'hidden' || o === 'clip') return x; if (o !== 'visible') return x.matches('.modal') ? x : null; } return null; };
  for (const { n, e } of zeilenText) {
    if (!visible(e) || getComputedStyle(e).textOverflow === 'ellipsis') continue;
    const k = kappt(e); if (!k) continue;
    const kr = k.getBoundingClientRect(), b = document.createRange(); b.selectNodeContents(n);
    const r = b.getBoundingClientRect();
    if (r.width > 1 && (r.right > kr.right + 2 || r.left < kr.left - 2)) findings.push('abgeschnitten (Rahmen): ' + name(e));
  }
  //     Ebenso eine Beschriftung im Diagramm, die über die Zeichenfläche hinausläuft (auch oben oder unten).
  for (const e of root.querySelectorAll('svg text')) {
    const r = e.getBoundingClientRect(), f = e.ownerSVGElement?.getBoundingClientRect();
    if (!f || r.width < 1 || getComputedStyle(e).visibility === 'hidden' || deckkraft(e) <= 0.1) continue;
    if (r.left < f.left - 2 || r.right > f.right + 2 || r.top < f.top - 2 || r.bottom > f.bottom + 2) findings.push('abgeschnitten (Diagramm): ' + name(e));
  }
  // 9. Verdeckt: Ein darübergelegter Knopf (position: absolute) liegt auf
  //    einer Textzeile im Fluss der Seite — dort ist der Text nicht lesbar.
  //    Aufgeklappte Menüs liegen mit Absicht über der Seite.
  const absolut = (e) => { for (let x = e; x; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'absolute') return true; if (p === 'fixed' || p === 'sticky') return false; } return false; };
  const darueber = eindeutig.filter(z => absolut(z.flaeche) && !z.flaeche.closest('.import-toggle, #umenu-pop, [role=menu], [role=listbox]'));
  for (const { n, e } of zeilenText) {
    if (absolut(e) || fest(e) || !visible(e)) continue;
    const b = document.createRange(); b.selectNodeContents(n);
    for (const z of darueber) for (const r of b.getClientRects()) {
      if (z.flaeche.contains(e)) continue;
      const x = Math.min(r.right, z.r.right) - Math.max(r.left, z.r.left), y = Math.min(r.bottom, z.r.bottom) - Math.max(r.top, z.r.top);
      if (x > 2 && y > 2) findings.push('verdeckt ' + Math.round(x) + '×' + Math.round(y) + ': ' + name(e) + ' unter ' + name(z.flaeche));
    }
  }
  // 11. Wortbruch in Bedienelementen: „Woch|e“ liest niemand als „Woche“.
  //     Gemessen nur ohne Silbentrennung (hyphens: auto setzt einen Strich, braucht
  //     aber ein Wörterbuch, das dem CI-Chrome fehlt). Ein weiches Trennzeichen trennt zwei Wörter.
  const BEDIEN = 'button, [role=button], [role=tab], summary, .btn, .period-btn, .vb, .ntab, label.btn';
  for (const k of root.querySelectorAll(BEDIEN)) {
    if (!visible(k) || k.closest('svg')) continue;
    const gang = document.createTreeWalker(k, NodeFilter.SHOW_TEXT);
    for (let n = gang.nextNode(); n; n = gang.nextNode()) {
      if (n.parentElement.closest('.vh, [hidden], [aria-hidden="true"]') || getComputedStyle(n.parentElement).hyphens === 'auto') continue;
      for (const m of n.textContent.matchAll(/[\\p{L}\\p{N}]+/gu)) {
        // Je längerem Anfang des Worts die Zahl seiner Zeilen: Wo sie springt, beginnt ein Stück.
        const lines = (k) => { const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + k);
          return new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top / 4))).size; };
        const pieces = [];
        for (let k = 1, prior = 0; k <= m[0].length; k++) { const z = lines(k); if (z > prior) pieces.push(1); else pieces[pieces.length - 1]++; prior = z; }
        if (pieces.length > 1)
          findings.push('Wortbruch „' + m[0] + '“ (' + pieces.join('|') + '): ' + name(k));
      }
    }
  }
  // 12. Diagramm: Die Zeichenfläche (data-surface, in viewBox-Einheiten) behält
  //     mindestens die Hälfte der Breite, sonst bleibt neben den Achsen kaum Kurve.
  for (const svg of root.querySelectorAll('svg[data-surface]')) {
    if (!visible(svg)) continue;
    const px = +svg.dataset.surface * svg.getBoundingClientRect().width / (svg.viewBox.baseVal.width || 1);
    if (px < Math.min(160, svg.getBoundingClientRect().width * 0.5)) findings.push('schmal (Diagramm) ' + Math.round(px) + ' px Kurve: ' + name(svg));
  }
  // 13. Filter einer Liste: Der gewählte Eintrag passt ganz hinein (der Browser
  //     kürzt ihn ohne „…“, und „Alle Zuständ“ sagt nicht, was gefiltert ist).
  const leinwand = document.createElement('canvas').getContext('2d');
  for (const e of root.querySelectorAll(':is(.filter-row, .filter-bar) select')) {
    if (!visible(e) || e.multiple || e.size > 1) continue;
    const s = getComputedStyle(e), text = e.selectedOptions[0]?.textContent.trim() || '';
    leinwand.font = s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily;
    const platz = e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - (s.appearance === 'none' ? 0 : 18);
    if (text && leinwand.measureText(text).width > platz + 1) findings.push('Auswahl gekürzt „' + text.slice(0, 24) + '“: ' + name(e));
  }
  return [...new Set(findings)];
})()`;

/**
 * Keyboard in the open dialog: every control must be reachable via Tab,
 * and every click surface (data-click) must be able to take the focus.
 * VORBEREITEN marks the targets and returns their number; afterwards the
 * test presses Tab and asks BESUCHT where the focus stands.
 */
const TAB_PREPARE = `(() => {
  const d = ${TOPMOST}; if (!d) return null;
  const SEL = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  const bereit = (e) => !e.disabled && !e.closest('[inert], [hidden]') &&
    (e.matches('.file-hidden') ? e.parentElement.checkVisibility() : e.checkVisibility({ visibilityProperty: true }));
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 2).map(c => '.' + c).join('')
    + ' „' + (e.textContent.trim() || e.getAttribute('aria-label') || e.getAttribute('data-click') || '').replace(/s+/g, ' ').slice(0, 24) + '“';
  const findings = [];
  for (const e of d.querySelectorAll('[data-click]'))
    if (bereit(e) && !e.closest(SEL) && !e.closest('label')) findings.push('Klickfläche ohne Tastatur: ' + name(e));
  // Ein Knopf-Label (Datei wählen) braucht ein Feld, das den Fokus nehmen kann.
  for (const l of d.querySelectorAll('label.btn'))
    if (l.checkVisibility() && (!l.control || !l.control.checkVisibility())) findings.push('Knopf ohne Tastatur: ' + name(l));
  let n = 0;
  for (const e of d.querySelectorAll(SEL)) {
    if (!bereit(e)) continue;
    // Eine Optionsgruppe ist EIN Tab-Halt.
    const group = e.type === 'radio' && e.name ? d.querySelector('input[type=radio][name="' + e.name + '"][data-tabprobe]') : null;
    e.dataset.tabprobe = group ? group.dataset.tabprobe : String(n++);
    e.dataset.tabname = name(e);
  }
  const f = d.firstElementChild || d; if (!f.hasAttribute('tabindex')) f.setAttribute('tabindex', '-1'); f.focus();
  return { n, findings };
})()`;
const TAB_STATE = `(() => { const a = document.activeElement, d = ${TOPMOST};
  return { id: a?.dataset?.tabprobe ?? null, inside: !!d && d.contains(a),
           where: a ? a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') : '' }; })()`;
const TAB_MISSING = visited => `(() => { const b = new Set(${JSON.stringify(visited)}); const result = [];
  for (const e of document.querySelectorAll('[data-tabprobe]')) { if (!b.has(e.dataset.tabprobe)) result.push(e.dataset.tabname); delete e.dataset.tabprobe; delete e.dataset.tabname; }
  return [...new Set(result)]; })()`;

/** Presses Tab until every target had its turn once; a date field takes one Tab per part. */
async function tabCheck(b) {
  const v = await b.evaluate(TAB_PREPARE);
  if (!v) return [];
  const findings = [...v.findings],
    visited = [];
  for (let i = 0; i < 3 * v.n + 6 && new Set(visited).size < v.n; i++) {
    await b.tab('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const st = await b.evaluate(TAB_STATE);
    if (!st.inside) findings.push('Fokus verlässt den Dialog (auf ' + st.where + ')');
    if (st.id !== null) visited.push(st.id);
  }
  for (const f of await b.evaluate(TAB_MISSING(visited))) findings.push('nicht per Tab erreichbar: ' + f);
  return [...new Set(findings)];
}

module.exports = { AXE, AXE_RUN, LAYOUT, tabCheck };
