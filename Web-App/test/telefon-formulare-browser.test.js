/**
 * Formulare und Filter auf dem Telefon (390 px), gemessen in Chrome an der echten App:
 * Dialog „Set hinzufügen“, Katalog-Filter und die Abschnittsleiste der Einstellungen.
 *
 * Gegenproben (08.11.2026 gemessen, je einzeln):
 *   A  in mobile.css die Regel `.erfassen-raster > .fg:has(> .preis-mit-waehrung)` entfernt
 *      → rot: „Set hinzufügen: Kaufpreis-Platzhalter ganz sichtbar“ („Platzhalter braucht 65 px,
 *      das Feld hat 58 px“)
 *   B  in mobile.css den Block `#tab-catalog .filterzeile { display: grid … }` entfernt
 *      → rot: „Katalog: Filter in vier Zeilen, nichts abgeschnitten“ („stehen in 5 Zeilen“)
 *   E  (12.11.2026) Katalog am Telefon einspaltig (grid-template-columns: minmax(0, 1fr))
 *      → rot: „Katalog: Filter in vier Zeilen …“ (die Jahre nicht nebeneinander)
 *   C  in styles.css die Pfeil-Regeln der Abschnittsleiste (`.einst-nav[data-mehr*="r"]::after`)
 *      auf das alte Zeichen ohne Knopf (width:2rem, border:0) zurückgesetzt
 *      → rot: „Einstellungen: Pfeil als Knopf, solange rechts Abschnitte liegen“
 *   D  in mobile.js die Zeile `nav.dataset.mehr = …` entfernt → rot: „Einstellungen: Pfeil als
 *      Knopf …“ und „… wechselt am Ende die Seite“ (kein data-mehr)
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

/**
 * Breite des längsten Textes eines Feldes gegen die Innenbreite: Ein Platzhalter oder ein Eintrag der
 * Auswahl, der nicht hineinpasst, wird abgeschnitten. Gemessen mit der Schrift des Feldes selbst.
 */
const TEXTBREITE = `(el, texte) => { const cs = getComputedStyle(el), c = document.createElement('canvas').getContext('2d');
  c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  const innen = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const breit = Math.max(...texte.map(x => c.measureText(x).width));
  return { id: el.id, innen: Math.round(innen), breit: Math.round(breit), passt: breit <= innen }; }`;

test('Formulare und Filter am Telefon', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await starteApp(t, { name: `telform_${process.pid}`, telefon: true });
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

  await t.test('Set hinzufügen: Kaufpreis-Platzhalter ganz sichtbar', async () => {
    await reiter('gallery');
    await b.auswerten(`document.querySelector('button[data-click="oeffneErfassen"][data-arg="set"]').click(); true`);
    await bis(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog offen');
    await ruhig();
    const m = await b.auswerten(`(() => { const breite = ${TEXTBREITE};
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

  await t.test('Katalog: Filter in vier Zeilen, nichts abgeschnitten', async () => {
    await reiter('catalog');
    const m = await b.auswerten(`(() => { const breite = ${TEXTBREITE};
      const ids = ['cat-theme', 'cat-year-from', 'cat-year-to', 'cat-sort'], f = id => document.getElementById(id);
      const r = id => f(id).getBoundingClientRect();
      const zeilen = new Set(['cat-search', ...ids].map(id => Math.round(r(id).top)));
      return { zeilen: zeilen.size, felder: ids.map(id => breite(f(id), [...f(id).options].map(o => o.text))),
               jahreGleich: Math.abs(r('cat-year-to').top - r('cat-year-from').top) < 2,
               themaVoll: Math.abs(r('cat-theme').width - r('cat-search').width) < 2, seite: document.documentElement.scrollWidth }; })()`);
    assert.equal(m.zeilen, 4, `Suche, Thema, die Jahre und die Sortierung stehen in ${m.zeilen} Zeilen`);
    assert.equal(m.jahreGleich, true, 'Jahr ab und Jahr bis stehen nicht in einer Zeile');
    assert.equal(m.themaVoll, true, 'Thema ist nicht so breit wie die Suche');
    assert.deepEqual(
      m.felder.filter(x => !x.passt),
      [],
      'abgeschnittene Auswahlfelder (id, Innenbreite, Textbreite)',
    );
    assert.ok(m.seite <= 390, `Seite ${m.seite} px breit`);
  });

  await t.test('Einstellungen: Pfeil als Knopf, solange rechts Abschnitte liegen', async () => {
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

  await t.test('Einstellungen: Pfeil wechselt am Ende die Seite', async () => {
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
