/**
 * Ströme und Sammelberichte geben keinen internen Fehlertext an den Client:
 * Ein Fachfehler kommt mit Code und Satz an, alles andere (SQL, Pfade,
 * fremde APIs) als „interner_fehler“ — der Text steht nur im Protokoll.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  in POST /sets/add-stream wieder `error: fehlertext(e)` → rot: „der
 *      Erfassungsstrom nennt keinen internen Text“ und „ein Fachfehler …“ (ohne Code)
 *   B  im Merklisten-CSV-Import wieder `error: e?.message` → rot: „der
 *      CSV-Bericht nennt keinen internen Text“
 *   C  oeffentlicherFehler() ohne den Zweig für Fachfehler → rot: „ein
 *      Fachfehler kommt mit seinem Code an“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { importWorker } = require('./helpers/auftraege');
const { testServer } = require('./helpers/server');

const GEHEIM = 'relation "geheime_tabelle" does not exist';
const ersetze = (rel, zusatz) => {
  const pfad = require.resolve(path.join(quellen.DIST, rel));
  _req(rel);
  require.cache[pfad].exports = Object.assign({}, require.cache[pfad].exports, zusatz);
};
const { dateiFehler, fehlerText } = _req('src/infra/fehlerTexte.js');
// Vor dem Laden der Routen: Die Dienste werfen, was im Betrieb aus der Datenbank käme.
// Die Merkliste eine Ebene tiefer: Der Import läuft als Auftrag und ruft den Dienst intern.
ersetze('src/merkliste/repository/merkliste.js', { merkeSetVor: async () => { throw new Error(GEHEIM); } });
ersetze('src/sets/setService.js', { addSet: async (sn) => {
  throw sn === 'FACH-1' ? dateiFehler('setnummer_ungueltig', 400) : new Error(GEHEIM);
} });

const db = _req('db/database.js');

test('kein interner Fehlertext an den Client', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const NAME = `fehlertext_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active) VALUES ($1, 'x', true) RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  importWorker(t, _req);
  const { base } = testServer(_req, { sitzung: { userId: uid }, t, routen: { '/api/v1': 'routes/api_v1/index.js' } });
  const strom = async (setNumber, sprache = 'de') => {
    const r = await fetch(`${base}/api/v1/sets/add-stream`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': sprache },
      body: JSON.stringify({ set_number: setNumber }) });
    const ereignisse = (await r.text()).split('\n').filter(z => z.startsWith('data: ')).map(z => JSON.parse(z.slice(6)));
    return ereignisse.at(-1);
  };

  await t.test('der Erfassungsstrom nennt keinen internen Text', async () => {
    const letztes = await strom('GEHEIM-1', 'en');
    assert.equal(letztes.step, 'error');
    assert.ok(!JSON.stringify(letztes).includes('geheime_tabelle'), JSON.stringify(letztes));
    assert.equal(letztes.code, 'interner_fehler');
    assert.equal(letztes.error, fehlerText('interner_fehler', 'en'));
  });

  await t.test('ein Fachfehler kommt mit seinem Code an', async () => {
    const letztes = await strom('FACH-1');
    assert.equal(letztes.code, 'setnummer_ungueltig');
    assert.equal(letztes.error, fehlerText('setnummer_ungueltig', 'de'));
  });

  await t.test('der CSV-Bericht nennt keinen internen Text', async () => {
    const form = new FormData();
    form.append('file', new Blob(['set_number\n10283-1\n'], { type: 'text/csv' }), 'merkliste.csv');
    const r = await fetch(`${base}/api/v1/wanted/import/csv`, { method: 'POST', body: form });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    assert.equal(j.errors, 1);
    assert.equal(j.results[0].error, fehlerText('interner_fehler', 'de'));
    assert.ok(!JSON.stringify(j).includes('geheime_tabelle'));
  });
});
