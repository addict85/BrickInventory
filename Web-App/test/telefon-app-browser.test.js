/**
 * Die App am Telefon (390 × 844, mobile) — gemessen in Chrome am echten
 * Server mit den echten Stylesheets.
 *
 *   - Erster Tab-Halt (Dokumentreihenfolge) ist der Sprunglink „Zum Inhalt“, mit Fokus sichtbar;
 *     Enter setzt den Fokus auf <main>. Je Reiter ist genau eine h1 sichtbar
 *     (der Seitentitel; vorher war die einzige h1 der Markenname).
 *   - In jedem Reiter ist jedes sichtbare Bedienelement mindestens 44 × 44 px
 *     und jeder Text mindestens 12 px groß.
 *   - Diagramme: Jede Beschriftung im Wertdiagramm (Finanzen) und im
 *     Preisverlauf (Set-Ansicht) ist mindestens 11 px groß, und jedes
 *     Diagramm hat role="img" mit einer Zusammenfassung als aria-label.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  diagrammBreite() liefert immer 700 → rot: „Diagrammschrift
 *      Finanzen“ (5,6 px) und „Diagrammschrift Set-Ansicht“ (6,2 px)
 *   B  (29.10.) Marke in der Kopfleiste wieder <h1> → rot: „Sprunglink und genau eine
 *      h1 je Reiter“ (je Reiter zwei h1)
 *   C  (29.10.) Sprunglink aus index.html entfernt → rot: dieselbe Prüfung (erster
 *      Tab-Halt war .ubadge-knopf)
 *   D  (29.10.) --fs-0 wieder .6875rem → rot: „Tippziele und Schrift je
 *      Reiter“ (span.tab-label 11 px); .delbtn wieder 36 px → rot (36×36)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { haeltSet } = require('./helpers/bestand');

/** Kleinste Schrift in px über alle Beschriftungen der Diagramme unter `wurzel`. */
const DIAGRAMMSCHRIFT = (wurzel) => `(() => {
  const svgs = [...document.querySelectorAll(${JSON.stringify(wurzel)} + ' svg.diagramm')];
  return svgs.map(svg => {
    const massstab = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
    const groessen = [...svg.querySelectorAll('text')].map(x => parseFloat(getComputedStyle(x).fontSize) * massstab);
    return { rolle: svg.getAttribute('role'), name: svg.getAttribute('aria-label') || '',
             kleinste: Math.min(...groessen), anzahl: groessen.length };
  });
})()`;

/** Sichtbare Bedienelemente unter 44 × 44 px und Text unter 12 px. */
const KLEINES = `(() => {
  const sichtbar = e => { const q = e.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const klein = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button], label.btn')]
    .filter(sichtbar).filter(e => !e.closest('.vh'))
    .map(e => { const q = e.getBoundingClientRect(); return [e, Math.round(q.width), Math.round(q.height)]; })
    .filter(([, w, h]) => w < 44 || h < 44)
    .map(([e, w, h]) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().replace(/\\s+/g, '.') : '') + ' ' + w + '×' + h);
  const schrift = [...document.querySelectorAll('body *')]
    .filter(e => !e.closest('svg') && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()))
    .filter(sichtbar)
    .map(e => [e, parseFloat(getComputedStyle(e).fontSize)]).filter(([, px]) => px < 12)
    .map(([e, px]) => e.tagName.toLowerCase() + (e.className ? '.' + String(e.className).trim().replace(/\\s+/g, '.') : '') + ' ' + px + ' px');
  return { klein, schrift };
})()`;

test('Telefon', { concurrency: 1, timeout: 240_000 }, async (t) => {
  const app = await starteApp(t, {
    name: `telefon_${process.pid}`, telefon: true,
    bestand: async (db, uid) => {
      await haeltSet(db, uid, '10300-1', 1, { preis: 199 });
      await db.run(`DELETE FROM price_history WHERE set_number = '10300-1'`);
      for (const [tage, preis] of [[90, 210], [60, 230], [30, 250], [1, 260]])
        await db.run(`INSERT INTO price_history (set_number, condition, currency_code, avg_price, qty_avg_price, recorded_at)
                      VALUES ('10300-1', 'N', 'EUR', $1, $1, NOW() - ($2 || ' days')::interval)`, [preis, String(tage)]);
    },
  });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis } = app;
  const reiter = async (name) => { await b.auswerten(`document.querySelector('.ntab[data-tab="${name}"]').click(); true`); await warte(400); };

  await t.test('Tippziele und Schrift je Reiter', async () => {
    const reiterListe = await b.auswerten(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
    const klein = [], schrift = [];
    for (const r of reiterListe) {
      await reiter(r);
      const m = await b.auswerten(KLEINES);
      klein.push(...m.klein.map(k => `${r}: ${k}`));
      schrift.push(...m.schrift.map(k => `${r}: ${k}`));
    }
    assert.deepEqual([...new Set(klein)], [], 'Tippziele unter 44 × 44 px');
    assert.deepEqual([...new Set(schrift)], [], 'Text unter 12 px');
  });

  await t.test('Sprunglink und genau eine h1 je Reiter', async () => {
    const reiterListe = await b.auswerten(`[...document.querySelectorAll('.ntab[data-tab]')].map(x => x.dataset.tab)`);
    assert.ok(reiterListe.length >= 8, `nur ${reiterListe.length} Reiter`);
    const falsch = [];
    for (const r of reiterListe) {
      await reiter(r);
      const h1 = await b.auswerten(`[...document.querySelectorAll('h1')].filter(h => h.getClientRects().length > 0).map(h => h.textContent.trim())`);
      if (h1.length !== 1) falsch.push(`${r}: ${JSON.stringify(h1)}`);
    }
    assert.deepEqual(falsch, []);
    await reiter('gallery');
    // Der erste Tab-Halt in Dokumentreihenfolge — so springt Tab nach dem Laden hin.
    const fokus = await b.auswerten(`(() => {
      const e = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
        .find(x => x.tabIndex >= 0 && !x.disabled && x.getClientRects().length > 0);
      e.focus(); const r = e.getBoundingClientRect();
      return { klasse: e.className, text: e.textContent.trim(), oben: r.top, hoehe: r.height }; })()`);
    assert.equal(fokus.klasse, 'sprunglink', `Erster Tab-Halt: ${JSON.stringify(fokus)}`);
    assert.equal(fokus.text, 'Zum Inhalt');
    assert.ok(fokus.oben >= 0 && fokus.hoehe >= 24, `Der Sprunglink ist mit Fokus nicht sichtbar: ${JSON.stringify(fokus)}`);
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await warte(100);
    assert.equal(await b.auswerten(`document.activeElement.id`), 'inhalt');
  });

  await t.test('Diagrammschrift Finanzen', async () => {
    await reiter('finance');
    await bis(`!!document.querySelector('#portfolio-chart svg.diagramm')`, 'Wertdiagramm');
    const [d] = await b.auswerten(DIAGRAMMSCHRIFT('#portfolio-chart'));
    assert.ok(d.anzahl >= 4, `nur ${d.anzahl} Beschriftungen`);
    assert.ok(d.kleinste >= 11, `kleinste Beschriftung ${d.kleinste.toFixed(1)} px`);
    assert.equal(d.rolle, 'img');
    assert.match(d.name, /Wertentwicklung Portfolio, .+ bis .+: von .+ auf .+/);
  });

  await t.test('Diagrammschrift Set-Ansicht', async () => {
    await reiter('gallery');
    await bis(`!!document.querySelector('[data-click="openModal"]')`, 'Set-Karte');
    await b.auswerten(`document.querySelector('[data-click="openModal"]').click(); true`);
    await bis(`!!document.querySelector('#m-sparkline-content svg.diagramm')`, 'Preisverlauf');
    const [d] = await b.auswerten(DIAGRAMMSCHRIFT('#m-sparkline-content'));
    assert.ok(d.kleinste >= 11, `kleinste Beschriftung ${d.kleinste.toFixed(1)} px`);
    assert.equal(d.rolle, 'img');
    assert.match(d.name, /Preisverlauf, .+ bis .+: Neu zuletzt/);
    await b.auswerten(`document.querySelector('#modal .mc-close, #modal [data-click="closeModal"]')?.click(); true`);
  });
});
