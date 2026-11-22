/**
 * „Set hinzufügen“ names the right cause: if the set catalog is not
 * loaded at all yet, the server reports catalog_not_loaded instead of
 * set_not_in_catalog; the UI then says that Rebrickable is missing,
 * not „Nummer prüfen“. A set of the own collection is called „schon in deiner
 * Sammlung“ and leads to the set with a button.
 *
 * Counter-checks (measured 04.11.2026, each on its own):
 *   A  in routes/api_v1/catalog.ts always 'set_not_in_catalog' → red:
 *      “server: empty catalog” (code set_not_in_catalog)
 *   B  the query of the own collection removed in setUnbekannt() → red:
 *      “UI: set already in the collection” (message „unbekannt“)
 *   C  in setUnbekannt() catalog_not_loaded treated like set_not_in_catalog
 *      → red: “UI: catalog not loaded”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { openUi, warte } = require('./helpers/ui');
const db = testData();

test('server: empty catalog', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const name = `ursache-${process.pid}`;
  await db.run('DELETE FROM users WHERE username=$1', [name]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.pool.end();
  });
  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const frage = async nr => (await fetch(`${base}/api/v2/catalog/sets/${nr}`)).json();

  await db.run('TRUNCATE rb_sets CASCADE');
  assert.equal((await frage('10294-1')).code, 'catalog_not_loaded', 'leerer Katalog');
  await db.run(
    `INSERT INTO rb_sets (set_num, name, year, theme_id, num_parts) VALUES ('75192-1', 'Millennium Falcon', 2017, 158, 7541)`,
  );
  assert.equal((await frage('10294-1')).code, 'set_not_in_catalog', 'geladener Katalog ohne die Nummer');
  assert.equal((await frage('75192-1')).success, true, 'bekannte Nummer');
});

/** Opens „Set hinzufügen“, enters the number and delivers the hint below it. */
async function versuche(antworten, nr) {
  const o = await openUi(antworten);
  const { d } = o;
  d.querySelector('button[data-click="openCapture"][data-arg="set"]').click();
  d.getElementById('add-num').value = nr;
  d.getElementById('btn-add').click();
  await warte(() => !d.getElementById('add-unknown').hidden);
  return {
    ...o,
    hint: d.getElementById('add-unknown').textContent.replace(/\s+/g, ' ').trim(),
    knopf: d.getElementById('btn-add').textContent.trim(),
  };
}

test('UI: set already in the collection', async () => {
  const set = { set_number: '10294-1', name: 'Titanic', quantity: 2, conditions: ['N'], instructions: [] };
  const { w, d, aufrufe, hint, knopf } = await versuche(
    {
      '/v2/sets/10294-1': { success: true, set },
      '/v2/catalog/sets/10294-1': {
        $status: 404,
        success: false,
        code: 'catalog_not_loaded',
        error: 'Katalog nicht geladen',
      },
    },
    '10294',
  );
  try {
    assert.match(hint, /Titanic \(10294-1\) ist schon in deiner Sammlung \(×2\)/);
    assert.equal(knopf, 'Set öffnen');
    assert.equal(
      aufrufe.some(a => a.url.includes('add-stream')),
      false,
      'trotzdem angelegt',
    );
    // A button „Set öffnen“ (UI check 17, N2): the main button.
    d.getElementById('btn-add').click();
    assert.ok(await warte(() => d.getElementById('set-modal').classList.contains('open')), 'das Set öffnet sich');
    assert.equal(
      d.getElementById('add-set-modal').classList.contains('open'),
      false,
      'der Erfassen-Dialog bleibt offen',
    );
  } finally {
    w.close();
  }
});

test('UI: catalog not loaded', async () => {
  const { w, hint, knopf } = await versuche(
    {
      '/v2/sets/99999-1': { $status: 404, success: false, code: 'set_not_found', error: 'Set nicht gefunden' },
      '/v2/catalog/sets/99999-1': {
        $status: 404,
        success: false,
        code: 'catalog_not_loaded',
        error: 'Katalog nicht geladen',
      },
    },
    '99999',
  );
  try {
    assert.match(hint, /Set-Katalog ist noch nicht geladen/);
    assert.doesNotMatch(hint, /Nummer prüfen/);
    assert.equal(knopf, 'Trotzdem anlegen');
  } finally {
    w.close();
  }
});
