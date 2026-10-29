/**
 * Im Dunkelmodus jedes Designs bleibt keine Fläche hell und kein Text
 * unlesbar. Gemessen in Chrome an der echten App: je Design data-dunkel
 * setzen, jeden Reiter und das Set-Detail öffnen und jedes sichtbare Element
 * prüfen — eigene Hintergrundfarbe nicht hell (relative Helligkeit ≤ 0,4),
 * Text mindestens 4,5:1 (gross 3:1) gegen den tatsächlichen Grund.
 *
 * Ausgenommen sind Inhalte, deren Farbe Information ist (Farbpunkte, Bilder,
 * Diagramme), die gedämpfte Bildfläche .sci, die bewusst hellgrau bleibt,
 * damit Produktbilder mit weissem Rand nicht leuchten, und Flächen in Marken-
 * oder Diagrammfarbe — deren Text wird trotzdem auf Kontrast geprüft.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in styles.css .cond-used wieder `background:#fef3c7;color:#92400e`
 *      → rot: „classic: keine helle Fläche“ (span.cond-used)
 *   B  in themes/farbfaecher.css die Dunkel-Ausnahme der Zustandsplaketten
 *      entfernt → rot: „farbfaecher: keine helle Fläche“
 *   C  in styles.css .delbtn wieder `background:rgba(255,255,255,.92)`
 *      → rot: „classic: keine helle Fläche“ (button.delbtn)
 *   D  in themes/brick.css bei .bp die feste weisse Schrift entfernt
 *      → rot: „brick: Text lesbar“ (3,63:1 auf Petrol)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { haeltSet, haeltTeil } = require('./helpers/bestand');

const DESIGNS = ['classic', 'brick', 'farbfaecher', 'noppe', 'hochglanz'];

/** Läuft im Browser: sammelt helle Flächen und zu schwachen Text im sichtbaren Teil. */
const MESSUNG = `(() => {
  const rgba = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const hell = (f) => 0.2126 * lin(f.r) + 0.7152 * lin(f.g) + 0.0722 * lin(f.b);
  const ueber = (oben, unten) => ({ r: oben.r * oben.a + unten.r * (1 - oben.a), g: oben.g * oben.a + unten.g * (1 - oben.a),
    b: oben.b * oben.a + unten.b * (1 - oben.a), a: 1 });
  const ausgenommen = (e) => e.closest('svg, img, canvas, video, .color-dot, [data-farbe], .sci, .bild-ph, .ph, .skelett');
  const sichtbar = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 4 && r.height > 4 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.1; };
  /** Grund hinter e: eigene und Vorfahren-Farben übereinander; ein Verlauf macht den Grund unbestimmt. */
  const grund = (e) => { const schichten = [];
    for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x);
      if (s.backgroundImage !== 'none' && !s.backgroundImage.startsWith('url')) return null;
      const f = rgba(s.backgroundColor); if (f && f.a > 0) { schichten.push(f); if (f.a >= 1) break; } }
    let g = { r: 255, g: 255, b: 255, a: 1 };
    for (const f of schichten.reverse()) g = ueber(f, g);
    return g; };
  // Flächen in Marken- und Diagrammfarbe sind dunkel bewusst hell, mit dunkler Schrift.
  const akzent = new Set(['--b600', '--chart-new', '--chart-used'].map(v => {
    const probe = document.createElement('i'); probe.style.background = 'var(' + v + ')'; document.body.append(probe);
    const f = rgba(getComputedStyle(probe).backgroundColor); probe.remove(); return f && f.r + ',' + f.g + ',' + f.b; }));
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].slice(0, 2).map(c => '.' + c).join('');
  const flaechen = new Set(), texte = new Set();
  for (const e of document.querySelectorAll('body *')) {
    if (ausgenommen(e) || !sichtbar(e)) continue;
    const s = getComputedStyle(e);
    const f = rgba(s.backgroundColor);
    if (f && f.a >= 0.5 && s.backgroundImage === 'none') {
      const g = grund(e);
      if (g && hell(g) > 0.4 && !akzent.has(f.r + ',' + f.g + ',' + f.b)) flaechen.add(name(e) + ' ' + s.backgroundColor);
    }
    const text = [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!text) continue;
    const g = grund(e); if (!g) continue;
    const vorne = ueber(rgba(s.color), g);
    const [a, b] = [hell(vorne), hell(g)].sort((x, y) => y - x);
    const k = (a + 0.05) / (b + 0.05);
    const gross = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && +s.fontWeight >= 700);
    if (k < (gross ? 3 : 4.5)) texte.add(name(e) + ' „' + e.textContent.trim().slice(0, 20) + '“ ' + k.toFixed(2) + ':1');
  }
  return { flaechen: [...flaechen], texte: [...texte] };
})()`;

test('Dunkelmodus: keine hellen Flächen, lesbarer Text', { concurrency: 1, timeout: 600_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `dunkel_${process.pid}`,
    bestand: async (db, uid) => {
      await haeltSet(db, uid, '10300-1', 1, { preis: 199 });
      await haeltSet(db, uid, '75192-1', 1, { preis: 650, zustand: 'U' });
      await db.run(`INSERT INTO set_teile (set_number, part_number, color_id, quantity) VALUES ('10300-1', '3001', 5, 4)
                    ON CONFLICT DO NOTHING`);
      await haeltTeil(db, uid, '3001', { setNumber: '10300-1', menge: 4, colorId: 5 });
    },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis } = app;
  const reiter = await b.auswerten(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
  assert.ok(reiter.length >= 8, `nur ${reiter.length} Reiter`);

  for (const design of DESIGNS) {
    await b.auswerten(`document.documentElement.setAttribute('data-theme', '${design}');
      document.documentElement.setAttribute('data-dunkel', ''); true`);
    const funde = { flaechen: new Set(), texte: new Set() };
    const sammle = async (wo) => {
      const r = await b.auswerten(MESSUNG);
      for (const x of r.flaechen) funde.flaechen.add(`${wo}: ${x}`);
      for (const x of r.texte) funde.texte.add(`${wo}: ${x}`);
    };
    for (const r of reiter) {
      await b.auswerten(`document.querySelector('.ntab[data-tab="${r}"]').click(); true`);
      await warte(600);
      await sammle(r);
    }
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await bis(`!!document.querySelector('[data-click="openModal"]')`, 'Set-Karte');
    await b.auswerten(`document.querySelector('[data-click="openModal"]').click(); true`);
    await bis(`document.getElementById('m-tit').textContent.length > 0`, 'Set-Detail offen');
    await warte(600);
    await sammle('Set-Detail');
    await b.auswerten(`document.querySelector('.ovl.open .mx, .ovl.open [data-click="closeModal"]')?.click(); true`);
    await b.auswerten(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
    await warte(300);

    await t.test(`${design}: keine helle Fläche`, () => assert.deepEqual([...funde.flaechen], []));
    await t.test(`${design}: Text lesbar`, () => assert.deepEqual([...funde.texte], []));
  }
});
