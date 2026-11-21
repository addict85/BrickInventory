/**
 * UX review 21 in English (N8, N11): an account in English, background jobs at 320 px and 200 %
 * font. Own file because only one web process runs per database and startApp closes the pool at the end.
 *
 * Counter-checks (measured 13.11.2026, each alone):
 *   P  mobile.css again `.ptitle { overflow-wrap: anywhere }` → red: break after “Backg” without hyphen
 *   Q  en.js 'parts.stat.colors' back to 'Colors' → red: “American spelling”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;

/** An own account in English: the title breaks on the first build in the narrow width. */
async function english(e) {
  const { b, bis, ruhig } = e;
  await ruhig();
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 320, height: 760, deviceScaleFactor: 1, mobile: true });
  await b.auswerten(`document.documentElement.style.setProperty('font-size', '200%', 'important'); true`);
  await b.auswerten(`document.getElementById('ntab-monitor').click(); true`);
  await bis(`document.querySelector('.ptitle[data-tab-title="monitor"]')?.checkVisibility()`, 'Titel');
  await ruhig();
  const breaks =
    await b.auswerten(`(() => { const h = document.querySelector('.ptitle[data-tab-title="monitor"] span:not(.ptitle-icon)');
    const n = h.firstChild, r = document.createRange(), out = []; let oben = null;
    for (let i = 0; i < n.length; i++) { r.setStart(n, i); r.setEnd(n, i + 1); const q = r.getClientRects()[0];
      if (!q || q.width === 0) continue;
      if (oben !== null && q.top > oben + 2) out.push(n.data.slice(0, i)); oben = q.top; }
    return { text: n.data, out }; })()`);
  assert.ok(breaks.out.length > 0, `Testaufbau: „${breaks.text}“ bricht nicht um`);
  for (const vor of breaks.out) assert.ok(/[ \u00ad]$/.test(vor), `Bruch nach „${vor}“ ohne Trennstrich`);
  const american = await b.auswerten(`[...document.querySelectorAll('[data-i18n]')].map(e => e.textContent)
    .concat([...document.querySelectorAll('[aria-label], [title]')].map(e => e.getAttribute('aria-label') + ' ' + e.getAttribute('title')))
    .filter(t => /\\bcolors?\\b|\\bcolorful\\b/i.test(t))`);
  assert.deepEqual(american, [], 'amerikanische Schreibung');
  assert.equal(await b.auswerten(text('[data-i18n="parts.stat.colors"]')), 'Colours');
}

test('English UI: wrapping and terms', { timeout: 120_000 }, async t => {
  const e = await startApp(t, { name: `r21_en_${process.pid}`, sprache: 'en', bestand: patternHousehold });
  if (e.grund) {
    t.skip(e.grund);
    return;
  }
  await english(e);
});
