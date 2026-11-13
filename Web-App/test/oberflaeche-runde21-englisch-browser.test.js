/**
 * UX-Prüfung 21 auf Englisch (N8, N11): Ein Konto in Englisch, Hintergrundarbeiten bei 320 px und 200 %
 * Schrift. Eigene Datei, weil je Datenbank nur ein Web-Prozess läuft und starteApp den Pool am Ende schliesst.
 *
 * Gegenproben (13.11.2026 gemessen, je einzeln):
 *   P  mobile.css wieder `.ptitle { overflow-wrap: anywhere }` → rot: Bruch nach „Backg“ ohne Trennstrich
 *   Q  en.js 'parts.stat.colors' wieder 'Colors' → rot: „amerikanische Schreibung“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp } = require('./helpers/app-browser');
const { musterHaushalt } = require('./helpers/bestand');

const text = sel => `(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\\s+/g, ' ').trim()`;

/** Ein eigenes Konto in Englisch: Der Titel bricht beim ersten Aufbau in der schmalen Breite. */
async function englisch(e) {
  const { b, bis, ruhig } = e;
  await ruhig();
  await b.tab('Emulation.setDeviceMetricsOverride', { width: 320, height: 760, deviceScaleFactor: 1, mobile: true });
  await b.auswerten(`document.documentElement.style.setProperty('font-size', '200%', 'important'); true`);
  await b.auswerten(`document.getElementById('ntab-monitor').click(); true`);
  await bis(`document.querySelector('.ptitle[data-tab-title="monitor"]')?.checkVisibility()`, 'Titel');
  await ruhig();
  const brueche =
    await b.auswerten(`(() => { const h = document.querySelector('.ptitle[data-tab-title="monitor"] span:not(.ptitle-icon)');
    const n = h.firstChild, r = document.createRange(), out = []; let oben = null;
    for (let i = 0; i < n.length; i++) { r.setStart(n, i); r.setEnd(n, i + 1); const q = r.getClientRects()[0];
      if (!q || q.width === 0) continue;
      if (oben !== null && q.top > oben + 2) out.push(n.data.slice(0, i)); oben = q.top; }
    return { text: n.data, out }; })()`);
  assert.ok(brueche.out.length > 0, `Testaufbau: „${brueche.text}“ bricht nicht um`);
  for (const vor of brueche.out) assert.ok(/[ \u00ad]$/.test(vor), `Bruch nach „${vor}“ ohne Trennstrich`);
  const amerikanisch = await b.auswerten(`[...document.querySelectorAll('[data-i18n]')].map(e => e.textContent)
    .concat([...document.querySelectorAll('[aria-label], [title]')].map(e => e.getAttribute('aria-label') + ' ' + e.getAttribute('title')))
    .filter(t => /\\bcolors?\\b|\\bcolorful\\b/i.test(t))`);
  assert.deepEqual(amerikanisch, [], 'amerikanische Schreibung');
  assert.equal(await b.auswerten(text('[data-i18n="parts.stat.colors"]')), 'Colours');
}

test('UX-Prüfung 21 auf Englisch', { timeout: 120_000 }, async t => {
  const e = await starteApp(t, { name: `r21_en_${process.pid}`, sprache: 'en', bestand: musterHaushalt });
  if (e.grund) {
    t.skip(e.grund);
    return;
  }
  await englisch(e);
});
