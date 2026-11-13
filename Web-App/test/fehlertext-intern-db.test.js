/**
 * Ströme und Sammelberichte geben keinen internen Fehlertext an den Client:
 * Ein Fachfehler kommt mit Code und Satz an, alles andere (SQL, Pfade,
 * fremde APIs) als „interner_fehler“ — der Text steht nur im Protokoll.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  in POST /sets/add-stream wieder `error: fehlertext(e)` → rot: „der
 *      Erfassungsstrom nennt keinen internen Text“
 *   A2 (09.11.2026) im Strom nach gescheitertem Ergänzen `ergaenzung` weggelassen
 *      → rot: „der Erfassungsstrom …“ (das Set ist angelegt, die Antwort muss es sagen)
 *   B  im Merklisten-CSV-Import wieder `error: e?.message` → rot: „der
 *      CSV-Bericht nennt keinen internen Text“
 *   C  handleRouteError() ohne den Zweig für Fachfehler mit Code → rot: „ein
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
const { datenOderSkip } = require('./helpers/db');
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
ersetze('src/merkliste/repository/merkliste.js', {
  merkeSetVor: async () => {
    throw new Error(GEHEIM);
  },
});
// Angelegt wird ohne Netz; scheitern kann danach nur das Ergänzen im offenen Strom.
// Die Sets-Dienste des Prozesses mit zwei ersetzten; die Routen bekommen dieselben (routerAus).
Object.assign(_req('src/infra/bereich.js').prozessDienste().sets, {
  setErfassen: async e => {
    if (e.setNumber === 'FACH-1') throw dateiFehler('ungueltig', 'setnummer_ungueltig');
    return {
      action: 'added',
      set_number: e.setNumber,
      name: e.setNumber,
      katalog_offen: true,
      ergaenzung: 'ausstehend',
      besitzer: e.anfragender,
    };
  },
  setErgaenzen: async () => {
    throw new Error(GEHEIM);
  },
});

const db = quellen.testDaten();

test('kein interner Fehlertext an den Client', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
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
  const { base } = testServer(_req, { sitzung: { userId: uid }, t, routen: { '/api/v1': 'routes/api_v1/index.js' } });
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

  await t.test('der Erfassungsstrom nennt keinen internen Text', async () => {
    const letztes = await strom('GEHEIM-1', 'en');
    assert.ok(!JSON.stringify(letztes).includes('geheime_tabelle'), JSON.stringify(letztes));
    // Angelegt ist das Set schon: Das Ende sagt, dass ein Auftrag ergänzt, statt „Fehler“.
    assert.equal(letztes.step, 'done');
    assert.equal(letztes.success, true);
    assert.equal(letztes.ergaenzung, 'ausstehend');
    assert.equal(letztes.katalog_offen, true);
  });

  await t.test('ein Fachfehler kommt mit seinem Code an', async () => {
    const letztes = await strom('FACH-1');
    assert.equal(letztes.status, 400);
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
