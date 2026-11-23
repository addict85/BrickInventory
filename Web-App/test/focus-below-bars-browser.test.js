/**
 * Guard for WCAG 2.4.11 (focus not obscured): a tab walk through the
 * main views, at 390 px and at 320 px with 200 % browser font. No
 * focused control may lie more than 20 % under the header, bottom
 * bar or floating button (or outside the window).
 * axe does not check this.
 *
 * Counter-checks (measured 04.11.2026):
 *   A  the rule html{scroll-padding-…} removed in styles.css → red at 390 px:
 *      collection, parts, account, vouchers, price alerts; at 320/200 %:
 *      collection, parts, wishlist, build list, account, vouchers (64–100 % each)
 *   B  leistenMessen() with a fixed bar height of 60 px instead of measured → red at
 *      320/200 %: collection, wishlist, vouchers (the bar is 116 px high there)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

const VIEWS = ['sammlung', 'teile', 'finanzen', 'merkliste', 'bauliste', 'konto', 'gutscheine', 'alarme'];

/** Share of the focused element obscured by fixed bars or the window edge. */
const MEASUREMENT = `(() => {
  const e = document.activeElement;
  if (!e || !e.closest('main') || e.closest('.ovl')) return null;
  const r = e.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  const schnitt = (q) => Math.max(0, Math.min(r.right, q.right) - Math.max(r.left, q.left)) * Math.max(0, Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top));
  const bars = [document.querySelector('header'), document.querySelector('nav:not(.settings-nav)'), ...document.querySelectorAll('.tab.active .button-floating')]
    .filter(l => l && l !== e && !l.contains(e) && /fixed|sticky/.test(getComputedStyle(l).position) && l.checkVisibility());
  const flaeche = r.width * r.height;
  const imFenster = schnitt({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });
  const verdeckt = bars.reduce((s, l) => s + schnitt(l.getBoundingClientRect()), 0);
  const name = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ' „' + (e.getAttribute('aria-label') || e.textContent || e.value || '').replace(/\\s+/g, ' ').trim().slice(0, 30) + '“';
  return { name, anteil: Math.min(1, (flaeche - imFenster + verdeckt) / flaeche), hoch: r.height };
})()`;

async function tabGang(app, ansicht) {
  const { b, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  await b.auswerten(`location.hash = '#/${ansicht}'; true`);
  await ruhig();
  await app.bis(`!document.querySelector('.tab.active .skeleton-row, .skeleton-grid')`, 'loaded', 60).catch(() => {});
  await b.auswerten(`scrollTo(0, 0); document.getElementById('content').focus({ preventScroll: true }); true`);
  const funde = [];
  let gesehen = 0;
  for (let i = 0; i < 70; i++) {
    await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await b.auswerten(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
    const m = await b.auswerten(MEASUREMENT);
    if (!m) {
      if (gesehen && !(await b.auswerten(`!!document.activeElement?.closest('main')`))) break;
      continue;
    }
    gesehen++;
    // What is taller than half the window does not fit completely anyway.
    if (m.anteil > 0.2 && m.hoch < 0.5 * (await b.auswerten('innerHeight')))
      funde.push(`${m.name} ${Math.round(m.anteil * 100)} %`);
  }
  return { funde: [...new Set(funde)], gesehen };
}

test('focus below fixed bars', { concurrency: 1, timeout: 400_000 }, async t => {
  const app = await startApp(t, { name: `fokl_${process.pid}`, holding: patternHousehold });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b } = app;
  for (const [breite, hoehe, gross] of [
    [390, 844, false],
    [320, 640, true],
  ]) {
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: breite,
      height: hoehe,
      deviceScaleFactor: 1,
      mobile: true,
    });
    if (gross) await b.tab('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    for (const ansicht of VIEWS) {
      const { funde, gesehen } = await tabGang(app, ansicht);
      await t.test(`${breite} px${gross ? ', 200 %' : ''}: ${ansicht}`, () => {
        // Since round 24 the empty build list only has the field and “add” (“recompute” only with a set).
        const mindestens = ansicht === 'bauliste' ? 2 : 3;
        assert.ok(gesehen >= mindestens, `only ${gesehen} elements reached — does the tab walk still work?`);
        assert.deepEqual(funde, []);
      });
    }
  }
});
