/**
 * Streams and summary reports give no internal error text to the client:
 * a domain error arrives with code and sentence, everything else (SQL, paths,
 * foreign APIs) as “interner_fehler” — the text only stands in the log.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  in POST /sets/add-stream again `error: fehlertext(e)` → red: “the
 *      add stream names no internal text”
 *   A2 (09.11.2026) in the stream after a failed completion `ergaenzung` omitted
 *      → red: “the add stream …” (the set is created, the response must say so)
 *   B  in the wishlist CSV import again `error: e?.message` → red: “the
 *      CSV report names no internal text”
 *   C  handleRouteError() without the branch for domain errors with code → red: “a
 *      domain error arrives with its code”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { importWorker } = require('./helpers/jobs');
const { testServer } = require('./helpers/server');

const GEHEIM = 'relation "geheime_tabelle" does not exist';
const replace = (rel, zusatz) => {
  const pfad = require.resolve(path.join(quellen.DIST, rel));
  _req(rel);
  require.cache[pfad].exports = Object.assign({}, require.cache[pfad].exports, zusatz);
};
const { fileError, errorText } = _req('src/infra/errorTexts.js');
// Before loading the routes: the services throw what would come from the database in production.
// The wishlist one level deeper: the import runs as a job and calls the service internally.
replace('src/wanted/repository/wanted.js', {
  markSetWanted: async () => {
    throw new Error(GEHEIM);
  },
});
// Creation happens without network; afterwards only the completion in the open stream can fail.
// The process's sets services with two replaced; the routes get the same ones (routerFrom).
Object.assign(require('./helpers/sources').testArea('sets'), {
  setErfassen: async e => {
    if (e.setNumber === 'FACH-1') throw fileError('ungueltig', 'setnummer_ungueltig');
    return {
      action: 'added',
      set_number: e.setNumber,
      name: e.setNumber,
      katalog_offen: true,
      ergaenzung: 'ausstehend',
      besitzer: e.requester,
    };
  },
  setSupplement: async () => {
    throw new Error(GEHEIM);
  },
});

const db = quellen.testData();

test('no internal error text to the client', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const NAME = `fehlertext_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(`INSERT INTO users (username, password_hash, is_active) VALUES ($1, 'x', true) RETURNING id`, [NAME])
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  importWorker(t, _req);
  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const strom = async (setNumber, sprache = 'de') => {
    const r = await fetch(`${base}/api/v1/sets/add-stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': sprache },
      body: JSON.stringify({ set_number: setNumber }),
    });
    const text = await r.text();
    if (!r.headers.get('content-type')?.includes('event-stream')) return { status: r.status, ...JSON.parse(text) };
    const ereignisse = text
      .split('\n')
      .filter(z => z.startsWith('data: '))
      .map(z => JSON.parse(z.slice(6)));
    return ereignisse.at(-1);
  };

  await t.test('the acquisition stream names no internal text', async () => {
    const letztes = await strom('GEHEIM-1', 'en');
    assert.ok(!JSON.stringify(letztes).includes('geheime_tabelle'), JSON.stringify(letztes));
    // The set is already created: the end says that a job completes it, instead of “error”.
    assert.equal(letztes.step, 'done');
    assert.equal(letztes.success, true);
    assert.equal(letztes.ergaenzung, 'ausstehend');
    assert.equal(letztes.katalog_offen, true);
  });

  await t.test('a domain error arrives with its code', async () => {
    const letztes = await strom('FACH-1');
    assert.equal(letztes.status, 400);
    assert.equal(letztes.code, 'setnummer_ungueltig');
    assert.equal(letztes.error, errorText('setnummer_ungueltig', 'de'));
  });

  await t.test('the CSV report names no internal text', async () => {
    const form = new FormData();
    form.append('file', new Blob(['set_number\n10283-1\n'], { type: 'text/csv' }), 'merkliste.csv');
    const r = await fetch(`${base}/api/v1/wanted/import/csv`, { method: 'POST', body: form });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.errors, 1);
    assert.equal(j.results[0].error, errorText('interner_fehler', 'de'));
    assert.ok(!JSON.stringify(j).includes('geheime_tabelle'));
  });
});
