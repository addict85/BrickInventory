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
  const findings = [];
  for (const a of nav.querySelectorAll('.settings-link')) {
    if (!a.checkVisibility()) continue;
    const r = a.getBoundingClientRect(), z = document.createRange();
    z.selectNodeContents(a);
    const t = z.getBoundingClientRect(), cs = getComputedStyle(a);
    const innenRechts = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    const text = a.textContent.trim();
    if (t.right > innenRechts + 1 || a.scrollWidth > a.clientWidth + 1) findings.push(text + ': Text ragt über den Eintrag (' + Math.round(t.right - innenRechts) + ' px)');
    if (r.right > n.right + 1) findings.push(text + ': Eintrag ragt über die Leiste');
    if (nav.scrollWidth > nav.clientWidth + 1) findings.push('Leiste scrollt waagerecht');
  }
  return { findings: [...new Set(findings)], column: Math.round(n.width), entries: nav.querySelectorAll('.settings-link').length,
           page: document.documentElement.scrollWidth, inner: document.documentElement.clientWidth };
})()`;

test('settings: section list with large font on the desktop', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, { name: `einstnav_${process.pid}`, allDesigns: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  await settle();
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await b.evaluate(`document.querySelector('.ntab[data-tab="settings"]').click(); true`);
  await until(`document.getElementById('tab-settings').classList.contains('active')`, 'Einstellungen');
  await until(
    `document.querySelector('#global-settings-grid > .settings-nav .settings-link')?.checkVisibility()`,
    'Abschnittsliste',
  );
  await settle();

  for (const design of ['brick', 'classic']) {
    for (const font of ['100%', '200%']) {
      await t.test(`${design}, ${font}: no entry cut off`, async () => {
        await b.evaluate(`document.documentElement.setAttribute('data-theme', '${design}');
          document.documentElement.style.fontSize = '${font}'; true`);
        await b.evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
        const m = await b.evaluate(MEASURE);
        assert.ok(m.entries >= 6, `only ${m.entries} entries measured`);
        assert.deepEqual(m.findings, [], `column ${m.column} px`);
        assert.ok(m.page <= m.inner, `page ${m.page} px wide with a ${m.inner} px window`);
      });
    }
  }
});
