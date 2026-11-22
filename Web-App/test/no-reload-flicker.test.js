/**
 * No double rebuild of the content when reloading / after login.
 *
 * Counter-checks (05.11.2026, each on its own, bundle rebuilt):
 *   A  navigation.js: on language change loadGallery() instead of renderGallery()
 *      → “a real language change …” red
 *   B  navigation.js without `if (!realSwitch) return;` → “the startup loads …” red
 *   C  loadGallery always shows the loading indicator (`if (true)`) → “refreshing …” red
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Remove import/export syntax from a module file.
 * @param {string} src
 * @returns {string}
 */
function stripModuleSyntax(src) {
  const body = src
    .replace(/^import[^;]*;\s*$/gm, '') // import { a, b } from '…';
    .replace(/^export\s+/gm, ''); // export function/const/let/class
  // registerActions() otherwise comes from js/registry.js and is not defined after
  // removing the imports. In the sandbox the registration does not
  // matter — that it IS called is checked by test/csp-actions.test.js
  // and test/bundle-smoke.test.js against the real source text. …
  return (
    'function registerActions() {}\n' + 'function tRaw(k, v) { return typeof t === "function" ? t(k, v) : k; }\n' + body
  );
}

const { openUi } = require('./helpers/ui');

const SETS = { success: true, sets: [{ set_number: '10294-1', name: 'Titanic', quantity: 1 }], count: 1, total: 1 };
const setsCalls = aufrufe => aufrufe.filter(a => a.method === 'GET' && /\/api\/v1\/sets\?/.test(a.url)).length;
const kachel = d => d.querySelector('#gallery [data-price-for="10294-1"]')?.closest('[data-click="openModal"], .sc');

test('the startup loads the gallery once, and the same language rebuilds nothing', async () => {
  const { w, d, warte, ruhig, aufrufe } = await openUi({ '/v1/sets': SETS });
  try {
    assert.ok(await warte(() => kachel(d)));
    await ruhig();
    assert.equal(setsCalls(aufrufe), 1, 'die Galerie wurde beim Start mehrfach geladen');
    const vorher = kachel(d);
    const wahl = d.getElementById('lang-select');
    wahl.value = 'de';
    wahl.dispatchEvent(new w.Event('change', { bubbles: true }));
    await ruhig();
    assert.equal(kachel(d), vorher, 'gleiche Sprache hat die Kacheln neu gezeichnet');
    assert.equal(setsCalls(aufrufe), 1);
  } finally {
    w.close();
  }
});

test('a real language change redraws the gallery without reloading it', async () => {
  const { w, d, warte, ruhig, aufrufe } = await openUi({ '/v1/sets': SETS });
  try {
    assert.ok(await warte(() => kachel(d)));
    await ruhig();
    const vorher = kachel(d);
    const wahl = d.getElementById('lang-select');
    wahl.value = 'en';
    wahl.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => kachel(d) && kachel(d) !== vorher), 'Kacheln nicht neu gezeichnet');
    await ruhig();
    assert.equal(setsCalls(aufrufe), 1, 'ein Sprachwechsel hat die Galerie neu geladen');
  } finally {
    w.close();
  }
});

test('refreshing leaves the tiles standing until the new response is there', async () => {
  let n = 0;
  let los;
  const spaeter = new Promise(r => {
    los = r;
  });
  const { w, d, warte } = await openUi({ '/v1/sets': () => (++n === 1 ? SETS : spaeter.then(() => SETS)) });
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

test('the import query does not run unthrottled and not before login', () => {
  // It polled every 3 seconds — also on the login screen and also when
  // the response was not JSON at all. If a reverse proxy stands in front, it delivers
  // an HTML error page during a restart; r.json() then threw on every
  // attempt "Unexpected token '<'".
  const core = stripModuleSyntax(require('./helpers/sources').coreSource());
  const fn = core.slice(core.indexOf('async function gibCheckOnLoad'), core.indexOf('let _gibCheckTimer = null;'));
  assert.match(
    fn,
    /if \(!loggedInAccount( \|\| document\.hidden)?\) return;/,
    'Ohne Anmeldung gibt es nichts zu prüfen',
  );
  assert.match(fn, /ct\.includes\('application\/json'\)/, 'Die Antwort muss vor dem Parsen geprüft werden');
  assert.match(fn, /setInterval\(doCheck, 30000\)/, 'Nach mehreren Fehlschlägen muss die Abfrage langsamer werden');
  assert.doesNotMatch(
    fn,
    /\.then\(r=>r\.json\(\)\)/,
    'Direktes json() ohne Statusprüfung erzeugt bei HTML-Antworten einen Parsefehler',
  );
});
