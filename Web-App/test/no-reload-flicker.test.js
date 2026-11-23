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
const setsCalls = calls => calls.filter(a => a.method === 'GET' && /\/api\/v2\/sets\?/.test(a.url)).length;
const tile = d => d.querySelector('#gallery [data-price-for="10294-1"]')?.closest('[data-click="openModal"], .sc');

test('the startup loads the gallery once, and the same language rebuilds nothing', async () => {
  const { w, d, waitFor, settle, calls } = await openUi({ '/v2/sets': SETS });
  try {
    assert.ok(await waitFor(() => tile(d)));
    await settle();
    assert.equal(setsCalls(calls), 1, 'the gallery was loaded several times at start');
    const prior = tile(d);
    const choice = d.getElementById('lang-select');
    choice.value = 'de';
    choice.dispatchEvent(new w.Event('change', { bubbles: true }));
    await settle();
    assert.equal(tile(d), prior, 'the same language redrew the tiles');
    assert.equal(setsCalls(calls), 1);
  } finally {
    w.close();
  }
});

test('a real language change redraws the gallery without reloading it', async () => {
  const { w, d, waitFor, settle, calls } = await openUi({ '/v2/sets': SETS });
  try {
    assert.ok(await waitFor(() => tile(d)));
    await settle();
    const prior = tile(d);
    const choice = d.getElementById('lang-select');
    choice.value = 'en';
    choice.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await waitFor(() => tile(d) && tile(d) !== prior), 'tiles not redrawn');
    await settle();
    assert.equal(setsCalls(calls), 1, 'a language switch reloaded the gallery');
  } finally {
    w.close();
  }
});

test('refreshing leaves the tiles standing until the new response is there', async () => {
  let n = 0;
  let go;
  const subsequent = new Promise(r => {
    go = r;
  });
  const { w, d, waitFor } = await openUi({ '/v2/sets': () => (++n === 1 ? SETS : subsequent.then(() => SETS)) });
  try {
    assert.ok(await waitFor(() => tile(d)));
    d.getElementById('gsort').value = 'name_asc';
    d.getElementById('gsort').dispatchEvent(new w.Event('change'));
    assert.ok(await waitFor(() => n === 2), 'no second fetch');
    assert.ok(tile(d), 'the tiles were replaced by a loading indicator');
    assert.equal(d.querySelector('#gallery .skeleton-grid'), null);
    go();
    assert.ok(await waitFor(() => tile(d)));
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
    'Without login there is nothing to check',
  );
  assert.match(fn, /ct\.includes\('application\/json'\)/, 'The response must be checked before parsing');
  assert.match(fn, /setInterval\(doCheck, 30000\)/, 'After several failures the polling must slow down');
  assert.doesNotMatch(
    fn,
    /\.then\(r=>r\.json\(\)\)/,
    'A direct json() without a status check produces a parse error on HTML responses',
  );
});
