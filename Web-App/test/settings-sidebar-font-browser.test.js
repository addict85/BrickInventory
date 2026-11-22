/**
 * Settings on the desktop (1280 px) at 100 % and 200 % font, themes stone (brick) and classic:
 * the section list on the left truncates no entry (no hard cut-off), the column grows with the font.
 *
 * Counter-check (measured 08.11.2026): in styles.css the column set back to `minmax(170px,210px)`
 *   → red at 200 %: „Benutzerverwaltung“ and „Erscheinungsbild“ stick out beyond the column.
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

/** Per entry: does its text stick out beyond the entry, does the entry stick out beyond the column, is the text visible? */
const MEASURE = `(() => {
  const nav = document.querySelector('#global-settings-grid > .settings-nav'), n = nav.getBoundingClientRect();
  const funde = [];
  for (const a of nav.querySelectorAll('.settings-link')) {
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
  return { funde: [...new Set(funde)], spalte: Math.round(n.width), entries: nav.querySelectorAll('.settings-link').length,
           seite: document.documentElement.scrollWidth, innen: document.documentElement.clientWidth };
})()`;

test('settings: section list with large font on the desktop', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, { name: `einstnav_${process.pid}`, allDesigns: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  await ruhig();
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.auswerten(`document.querySelector('.ntab[data-tab="settings"]').click(); true`);
  await bis(`document.getElementById('tab-settings').classList.contains('active')`, 'Einstellungen');
  await bis(
    `document.querySelector('#global-settings-grid > .settings-nav .settings-link')?.checkVisibility()`,
    'Abschnittsliste',
  );
  await ruhig();

  for (const design of ['brick', 'classic']) {
    for (const schrift of ['100%', '200%']) {
      await t.test(`${design}, ${schrift}: no entry cut off`, async () => {
        await b.auswerten(`document.documentElement.setAttribute('data-theme', '${design}');
          document.documentElement.style.fontSize = '${schrift}'; true`);
        await b.auswerten(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
        const m = await b.auswerten(MEASURE);
        assert.ok(m.entries >= 6, `nur ${m.entries} Einträge gemessen`);
        assert.deepEqual(m.funde, [], `Spalte ${m.spalte} px`);
        assert.ok(m.seite <= m.innen, `Seite ${m.seite} px breit bei ${m.innen} px Fenster`);
      });
    }
  }
});
