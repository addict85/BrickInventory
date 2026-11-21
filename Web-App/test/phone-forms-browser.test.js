/**
 * Forms and filters on the phone (390 px), measured in Chrome on the real app:
 * dialog „Set hinzufügen“, catalog filters and the section bar of the settings.
 *
 * Counter-checks (measured 08.11.2026, each on its own):
 *   A  the rule `.erfassen-raster > .fg:has(> .preis-mit-waehrung)` removed in mobile.css
 *      → red: “add set: purchase price placeholder fully visible” („Platzhalter braucht 65 px,
 *      das Feld hat 58 px“)
 *   B  (14.11.2026, round 24: filters behind the button) the rule
 *      `#tab-catalog .filterleiste.offen > :is(#cat-year-from, #cat-year-to)` removed in mobile.css
 *      → red: “catalog: filters in four rows, nothing cut off” („stehen in 5 Zeilen“)
 *   C  in styles.css the arrow rules of the section bar (`.einst-nav[data-mehr*="r"]::after`)
 *      reset to the old character without a button (width:2rem, border:0)
 *      → red: “settings: arrow as a button while there are sections to the right”
 *   D  the line `nav.dataset.mehr = …` removed in mobile.js → red: “settings: arrow as a
 *      button …” and “… switches the page at the end” (no data-mehr)
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

/**
 * Width of the longest text of a field against the inner width: a placeholder or an entry of the
 * selection that does not fit in is cut off. Measured with the font of the field itself.
 */
const TEXT_WIDTH = `(el, texte) => { const cs = getComputedStyle(el), c = document.createElement('canvas').getContext('2d');
  c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  const innen = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const breit = Math.max(...texte.map(x => c.measureText(x).width));
  return { id: el.id, innen: Math.round(innen), breit: Math.round(breit), passt: breit <= innen }; }`;

test('forms and filters on the phone', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, { name: `telform_${process.pid}`, telefon: true });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig();
  const reiter = async name => {
    await b.auswerten(`document.querySelector('.ntab[data-tab="${name}"]').click(); true`);
    await bis(`document.getElementById('tab-${name}').classList.contains('active')`, `Reiter ${name}`);
    await ruhig();
  };

  await t.test('add set: purchase price placeholder fully visible', async () => {
    await reiter('gallery');
    await b.auswerten(`document.querySelector('button[data-click="oeffneErfassen"][data-arg="set"]').click(); true`);
    await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog offen');
    await ruhig();
    const m = await b.auswerten(`(() => { const breite = ${TEXT_WIDTH};
      const preis = document.getElementById('add-price'), waehrung = document.getElementById('add-currency');
      const modal = document.querySelector('#add-set-modal .modal').getBoundingClientRect();
      const p = preis.getBoundingClientRect(), w = waehrung.getBoundingClientRect();
      return { platzhalter: breite(preis, [preis.placeholder]), waehrung: breite(waehrung, [...waehrung.options].map(o => o.text)),
               // Die Währung steht neben dem Preis, nicht darunter, und beide bleiben im Dialog.
               nebeneinander: Math.abs(p.top - w.top) < 2, imDialog: w.right <= modal.right + 0.5 && p.left >= modal.left - 0.5,
               seite: document.documentElement.scrollWidth }; })()`);
    await b.auswerten(`document.querySelector('#add-set-modal [data-click="schliesseErfassen"]').click(); true`);
    assert.ok(m.platzhalter.breit > 0, 'kein Platzhalter gemessen');
    assert.ok(
      m.platzhalter.passt,
      `Platzhalter braucht ${m.platzhalter.breit} px, das Feld hat ${m.platzhalter.innen} px`,
    );
    assert.ok(m.waehrung.passt, `Währung braucht ${m.waehrung.breit} px, das Feld hat ${m.waehrung.innen} px`);
    assert.equal(m.nebeneinander, true, 'Währung steht nicht neben dem Preis');
    assert.equal(m.imDialog, true, 'Preis oder Währung ragen aus dem Dialog');
    assert.ok(m.seite <= 390, `Seite ${m.seite} px breit`);
  });

  await t.test('catalog: filters in four rows, nothing cut off', async () => {
    await reiter('catalog');
    // Since round 24 behind the funnel button as in the collection; when expanded the same order applies.
    await b.auswerten(`(() => { const k = document.querySelector('#tab-catalog .filter-knopf');
      if (k.getAttribute('aria-expanded') !== 'true') k.click(); return true; })()`);
    const m = await b.auswerten(`(() => { const breite = ${TEXT_WIDTH};
      const ids = ['cat-theme', 'cat-year-from', 'cat-year-to', 'cat-sort'], f = id => document.getElementById(id);
      const r = id => f(id).getBoundingClientRect();
      const zeilen = new Set(['cat-search', ...ids].map(id => Math.round(r(id).top)));
      return { zeilen: zeilen.size, felder: ids.map(id => breite(f(id), [...f(id).options].map(o => o.text))),
               yearsEqual: Math.abs(r('cat-year-to').top - r('cat-year-from').top) < 2,
               themeFull: Math.abs(r('cat-theme').width - f('cat-theme').parentElement.clientWidth) < 2, seite: document.documentElement.scrollWidth }; })()`);
    assert.equal(m.zeilen, 4, `Suche, Thema, die Jahre und die Sortierung stehen in ${m.zeilen} Zeilen`);
    assert.equal(m.yearsEqual, true, 'Jahr ab und Jahr bis stehen nicht in einer Zeile');
    assert.equal(m.themeFull, true, 'Thema ist nicht so breit wie die Filterleiste');
    assert.deepEqual(
      m.felder.filter(x => !x.passt),
      [],
      'abgeschnittene Auswahlfelder (id, Innenbreite, Textbreite)',
    );
    assert.ok(m.seite <= 390, `Seite ${m.seite} px breit`);
  });

  await t.test('settings: arrow as a button while there are sections to the right', async () => {
    await reiter('settings');
    await bis(
      `document.querySelector('.einst-nav')?.getClientRects().length > 0 && !!document.querySelector('.einst-nav').dataset.mehr`,
      'Abschnittsleiste mit Hinweis',
    );
    const m =
      await b.auswerten(`(() => { const nav = document.querySelector('.einst-nav'), s = getComputedStyle(nav, '::after');
      return { mehr: nav.dataset.mehr, inhalt: s.content, breite: parseFloat(s.width), hoehe: parseFloat(s.height),
               rand: parseFloat(s.borderTopWidth), rund: s.borderTopLeftRadius, fuellung: s.backgroundColor,
               rollt: nav.scrollWidth > nav.clientWidth, zeilen: new Set([...nav.querySelectorAll('a')].map(a => Math.round(a.getBoundingClientRect().top))).size }; })()`);
    assert.equal(m.rollt, true, 'die Leiste rollt gar nicht');
    assert.equal(m.mehr, 'r', 'Hinweis nur nach rechts, solange links nichts versteckt ist');
    assert.match(m.inhalt, /›/);
    assert.ok(m.breite >= 32 && m.hoehe >= 32, `Pfeil ${m.breite} × ${m.hoehe} px`);
    assert.ok(m.rand >= 2, `Pfeil ohne Rand (${m.rand} px)`);
    assert.notEqual(m.rund, '0px', 'Pfeil nicht rund');
    assert.notEqual(m.fuellung, 'rgba(0, 0, 0, 0)', 'Pfeil ohne Fläche: Text läuft dahinter durch');
    assert.equal(m.zeilen, 1, 'die Leiste bleibt einzeilig');
  });

  await t.test('settings: arrow switches the page at the end', async () => {
    await b.auswerten(
      `(() => { const nav = document.querySelector('.einst-nav'); nav.scrollLeft = nav.scrollWidth; return true; })()`,
    );
    await bis(`document.querySelector('.einst-nav').dataset.mehr === 'l'`, 'Hinweis nach links');
    const m = await b.auswerten(`(() => { const nav = document.querySelector('.einst-nav');
      return { vorn: getComputedStyle(nav, '::before').content, hinten: getComputedStyle(nav, '::after').content }; })()`);
    assert.match(m.vorn, /‹/);
    assert.equal(m.hinten, 'none', 'am Ende liegt rechts nichts mehr');
  });
});
