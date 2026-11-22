/**
 * In the dark mode of every design no surface stays light and no text
 * unreadable. Measured in Chrome on the real app: per design set data-dark,
 * open every tab and the set detail and check every visible element
 * — own background color not light (relative luminance ≤ 0.4), …
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  in styles.css .cond-used again `background:#fef3c7;color:#92400e`
 *      → red: “classic: no light surface” (span.cond-used)
 *   B  in themes/farbfaecher.css the dark exception of the condition badges
 *      removed → red: “farbfaecher: no light surface”
 *   C  in styles.css .delbtn again `background:rgba(255,255,255,.92)`
 *      → red: “classic: no light surface” (button.delbtn)
 *   D  in themes/brick.css the fixed white text removed at .bp
 *      → red: “brick: text readable” (3.63:1 on petrol)
 *   E  in styles.css .ibadge again `color:#15803d` → red: “classic”, “brick”
 *      and “hochglanz: text readable” (span.ibadge, 2.98:1)
 *   F  (29.10.) [data-dark] .sci back to #c9ced4 → red: “classic: no light
 *      surface” (div.sci)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp, warte } = require('./helpers/app-browser');
const { holdsSet, holdsPart } = require('./helpers/inventory');

const DESIGNS = ['classic', 'brick', 'farbfaecher', 'noppe', 'hochglanz'];

/** Runs in the browser: collects light surfaces and too weak text in the visible part. */
const MEASUREMENT = `(() => {
  const rgba = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
    const [r, g, b, a = 1] = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const hell = (f) => 0.2126 * lin(f.r) + 0.7152 * lin(f.g) + 0.0722 * lin(f.b);
  const ueber = (oben, unten) => ({ r: oben.r * oben.a + unten.r * (1 - oben.a), g: oben.g * oben.a + unten.g * (1 - oben.a),
    b: oben.b * oben.a + unten.b * (1 - oben.a), a: 1 });
  const ausgenommen = (e) => e.closest('svg, img, canvas, video, .color-dot, [data-color-hex], .image-ph, .ph, .skeleton');
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
  const surfaces = new Set(), texte = new Set();
  for (const e of document.querySelectorAll('body *')) {
    if (ausgenommen(e) || !sichtbar(e)) continue;
    const s = getComputedStyle(e);
    const f = rgba(s.backgroundColor);
    if (f && f.a >= 0.5 && s.backgroundImage === 'none') {
      const g = grund(e);
      if (g && hell(g) > 0.4 && !akzent.has(f.r + ',' + f.g + ',' + f.b)) surfaces.add(name(e) + ' ' + s.backgroundColor);
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
  return { surfaces: [...surfaces], texte: [...texte] };
})()`;

test('dark mode: no light surfaces, readable text', { concurrency: 1, timeout: 600_000 }, async t => {
  const app = await startApp(t, {
    name: `dunkel_${process.pid}`,
    allDesigns: true,
    bestand: async (db, uid) => {
      await holdsSet(db, uid, '10300-1', 1, { preis: 199 });
      await holdsSet(db, uid, '75192-1', 1, { preis: 650, zustand: 'U' });
      // An instruction so that the badge with the instruction count is on the card.
      await db.run(
        `INSERT INTO instructions (user_id, set_number, url) VALUES ($1, '10300-1', 'https://example.org/10300.pdf')`,
        [uid],
      );
      await db.run(`INSERT INTO set_parts (set_number, part_number, color_id, quantity) VALUES ('10300-1', '3001', 5, 4)
                    ON CONFLICT DO NOTHING`);
      await holdsPart(db, uid, '3001', { setNumber: '10300-1', menge: 4, colorId: 5 });
    },
  });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig } = app;
  const reiter = await b.auswerten(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
  assert.ok(reiter.length >= 8, `nur ${reiter.length} Reiter`);

  for (const design of DESIGNS) {
    await b.auswerten(`document.documentElement.setAttribute('data-theme', '${design}');
      document.documentElement.setAttribute('data-dark', ''); true`);
    const funde = { surfaces: new Set(), texte: new Set() };
    const collect = async wo => {
      // If the login mask is shown, the rest would measure only it; then name the cause.
      if (await b.auswerten(`getComputedStyle(document.getElementById('app')).display === 'none'`))
        assert.fail(`Sitzung vor „${design}: ${wo}“ verloren; 401 auf: ${app.abgewiesen.join(', ') || 'none'}`);
      const r = await b.auswerten(MEASUREMENT);
      for (const x of r.surfaces) funde.surfaces.add(`${wo}: ${x}`);
      for (const x of r.texte) funde.texte.add(`${wo}: ${x}`);
    };
    for (const r of reiter) {
      await b.auswerten(`document.querySelector('.ntab[data-tab="${r}"]').click(); true`);
      await ruhig();
      // The settings show one section at a time; all are measured.
      const seiten =
        r === 'settings'
          ? await b.auswerten(`[...document.querySelectorAll('.settings-nav a')].map(a => a.dataset.arg)`)
          : [null];
      for (const seite of seiten) {
        if (seite) {
          await b.auswerten(`document.querySelector('.settings-nav a[data-arg="${seite}"]').click(); true`);
          await warte(100);
        }
        await collect(seite ? `${r}/${seite}` : r);
      }
    }
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await bis(`!!document.querySelector('[data-click="openModal"]')`, 'Set-Karte');
    await b.auswerten(`document.querySelector('[data-click="openModal"]').click(); true`);
    await bis(`document.getElementById('m-tit').textContent.length > 0`, 'Set-Detail offen');
    await ruhig();
    await collect('Set-Detail');
    await b.auswerten(`document.querySelector('.ovl.open .mx, .ovl.open [data-click="closeModal"]')?.click(); true`);
    await b.auswerten(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); true`);
    await ruhig();

    await t.test(`${design}: no light surface`, () => assert.deepEqual([...funde.surfaces], []));
    await t.test(`${design}: text readable`, () => assert.deepEqual([...funde.texte], []));
  }
});
