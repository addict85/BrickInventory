/**
 * Kein doppelter Neuaufbau des Inhalts beim Neuladen / nach dem Login.
 *
 * Gegenproben (05.11.2026, je einzeln, Bündel neu gebaut):
 *   A  navigation.js: bei Sprachwechsel loadGallery() statt renderGallery()
 *      → „ein echter Sprachwechsel …“ rot
 *   B  navigation.js ohne `if (!echterWechsel) return;` → „der Start lädt …“ rot
 *   C  loadGallery zeigt die Ladeanzeige immer (`if (true)`) → „Auffrischen …“ rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * import-/export-Syntax aus einer Moduldatei entfernen.
 * @param {string} src
 * @returns {string}
 */
function stripModuleSyntax(src) {
  const body = src
    .replace(/^import[^;]*;\s*$/gm, '') // import { a, b } from '…';
    .replace(/^export\s+/gm, ''); // export function/const/let/class
  // registerActions() kommt sonst aus js/registry.js und ist nach dem
  // Entfernen der Importe nicht definiert. In der Sandbox interessiert die
  // Anmeldung nicht — dass sie aufgerufen WIRD, prüfen test/csp-actions.test.js
  // und test/bundle-smoke.test.js gegen den echten Quelltext. …
  return (
    'function registerActions() {}\n' + 'function tRaw(k, v) { return typeof t === "function" ? t(k, v) : k; }\n' + body
  );
}

const { oeffneOberflaeche } = require('./helpers/oberflaeche');

const SETS = { success: true, sets: [{ set_number: '10294-1', name: 'Titanic', quantity: 1 }], count: 1, total: 1 };
const setsAufrufe = aufrufe => aufrufe.filter(a => a.method === 'GET' && /\/api\/v1\/sets\?/.test(a.url)).length;
const kachel = d => d.querySelector('#gallery [data-price-for="10294-1"]')?.closest('[data-click="openModal"], .sc');

test('der Start lädt die Galerie einmal, und gleiche Sprache baut nichts neu', async () => {
  const { w, d, warte, ruhig, aufrufe } = await oeffneOberflaeche({ '/v1/sets': SETS });
  try {
    assert.ok(await warte(() => kachel(d)));
    await ruhig();
    assert.equal(setsAufrufe(aufrufe), 1, 'die Galerie wurde beim Start mehrfach geladen');
    const vorher = kachel(d);
    const wahl = d.getElementById('lang-select');
    wahl.value = 'de';
    wahl.dispatchEvent(new w.Event('change', { bubbles: true }));
    await ruhig();
    assert.equal(kachel(d), vorher, 'gleiche Sprache hat die Kacheln neu gezeichnet');
    assert.equal(setsAufrufe(aufrufe), 1);
  } finally {
    w.close();
  }
});

test('ein echter Sprachwechsel zeichnet die Galerie neu, ohne sie neu zu laden', async () => {
  const { w, d, warte, ruhig, aufrufe } = await oeffneOberflaeche({ '/v1/sets': SETS });
  try {
    assert.ok(await warte(() => kachel(d)));
    await ruhig();
    const vorher = kachel(d);
    const wahl = d.getElementById('lang-select');
    wahl.value = 'en';
    wahl.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => kachel(d) && kachel(d) !== vorher), 'Kacheln nicht neu gezeichnet');
    await ruhig();
    assert.equal(setsAufrufe(aufrufe), 1, 'ein Sprachwechsel hat die Galerie neu geladen');
  } finally {
    w.close();
  }
});

test('Auffrischen lässt die Kacheln stehen, bis die neue Antwort da ist', async () => {
  let n = 0;
  let los;
  const spaeter = new Promise(r => {
    los = r;
  });
  const { w, d, warte } = await oeffneOberflaeche({ '/v1/sets': () => (++n === 1 ? SETS : spaeter.then(() => SETS)) });
  try {
    assert.ok(await warte(() => kachel(d)));
    d.getElementById('gsort').value = 'name_asc';
    d.getElementById('gsort').dispatchEvent(new w.Event('change'));
    assert.ok(await warte(() => n === 2), 'kein zweiter Abruf');
    assert.ok(kachel(d), 'die Kacheln wurden durch eine Ladeanzeige ersetzt');
    assert.equal(d.querySelector('#gallery .skelett-raster'), null);
    los();
    assert.ok(await warte(() => kachel(d)));
  } finally {
    w.close();
  }
});

test('die Import-Abfrage läuft nicht ungebremst und nicht vor dem Login', () => {
  // Sie pollte alle 3 Sekunden — auch auf dem Login-Screen und auch dann, wenn
  // die Antwort gar kein JSON war. Steht ein Reverse-Proxy davor, liefert der
  // bei einem Neustart eine HTML-Fehlerseite; r.json() warf dann bei jedem
  // Versuch "Unexpected token '<'".
  const core = stripModuleSyntax(require('./helpers/sources').coreQuelle());
  const fn = core.slice(core.indexOf('async function gibCheckOnLoad'), core.indexOf('let _gibCheckTimer = null;'));
  assert.match(fn, /if \(!ME( \|\| document\.hidden)?\) return;/, 'Ohne Anmeldung gibt es nichts zu prüfen');
  assert.match(fn, /ct\.includes\('application\/json'\)/, 'Die Antwort muss vor dem Parsen geprüft werden');
  assert.match(fn, /setInterval\(doCheck, 30000\)/, 'Nach mehreren Fehlschlägen muss die Abfrage langsamer werden');
  assert.doesNotMatch(
    fn,
    /\.then\(r=>r\.json\(\)\)/,
    'Direktes json() ohne Statusprüfung erzeugt bei HTML-Antworten einen Parsefehler',
  );
});
