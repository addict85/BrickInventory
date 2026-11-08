/**
 * Einstellungen am Desktop (1280 px) bei 100 % und 200 % Schrift, Designs Stein (brick) und classic:
 * Die Abschnittsliste links kürzt keinen Eintrag (kein hartes Abschneiden), die Spalte wächst mit der Schrift.
 *
 * Gegenprobe (08.11.2026 gemessen): in styles.css die Spalte wieder auf `minmax(170px,210px)` gesetzt
 *   → rot bei 200 %: „Benutzerverwaltung“ und „Erscheinungsbild“ ragen über die Spalte hinaus.
 *
 * Ohne Chrome (CHROME_BIN, google-chrome, chromium) wird übersprungen.
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');

/** Je Eintrag: ragt sein Text über den Eintrag, ragt der Eintrag über die Spalte, steht der Text sichtbar? */
const MESSEN = `(() => {
  const nav = document.querySelector('#global-settings-grid > .einst-nav'), n = nav.getBoundingClientRect();
  const funde = [];
  for (const a of nav.querySelectorAll('.einst-link')) {
    if (!a.checkVisibility()) continue;
    const r = a.getBoundingClientRect(), z = document.createRange();
    z.selectNodeContents(a);
    const t = z.getBoundingClientRect(), cs = getComputedStyle(a);
    const innenRechts = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const text = a.textContent.trim();
    if (t.right > innenRechts + 1 || a.scrollWidth > a.clientWidth + 1) funde.push(text + ': Text ragt über den Eintrag (' + Math.round(t.right - innenRechts) + ' px)');
    if (r.right > n.right + 1) funde.push(text + ': Eintrag ragt über die Leiste');
    if (nav.scrollWidth > nav.clientWidth + 1) funde.push('Leiste scrollt waagerecht');
  }
  return { funde: [...new Set(funde)], spalte: Math.round(n.width), eintraege: nav.querySelectorAll('.einst-link').length,
           seite: document.documentElement.scrollWidth, innen: document.documentElement.clientWidth };
})()`;

test('Einstellungen: Abschnittsliste bei grosser Schrift am Desktop', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await starteApp(t, { name: `einstnav_${process.pid}` });
  if (app.grund) {
    t.skip(app.grund);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig();
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.auswerten(`document.querySelector('.ntab[data-tab="settings"]').click(); true`);
  await bis(`document.getElementById('tab-settings').classList.contains('active')`, 'Einstellungen');
  await bis(
    `document.querySelector('#global-settings-grid > .einst-nav .einst-link')?.checkVisibility()`,
    'Abschnittsliste',
  );
  await ruhig();

  for (const design of ['brick', 'classic']) {
    for (const schrift of ['100%', '200%']) {
      await t.test(`${design}, ${schrift}: kein Eintrag abgeschnitten`, async () => {
        await b.auswerten(`document.documentElement.setAttribute('data-theme', '${design}');
          document.documentElement.style.fontSize = '${schrift}'; true`);
        await b.auswerten(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
        const m = await b.auswerten(MESSEN);
        assert.ok(m.eintraege >= 6, `nur ${m.eintraege} Einträge gemessen`);
        assert.deepEqual(m.funde, [], `Spalte ${m.spalte} px`);
        assert.ok(m.seite <= m.innen, `Seite ${m.seite} px breit bei ${m.innen} px Fenster`);
      });
    }
  }
});
