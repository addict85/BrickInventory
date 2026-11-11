/**
 * POST /sets/:setNumber/parts importiert nur Sets im eigenen Blickfeld, für
 * deren Besitzer, und ist je Konto gedrosselt; eine leere Antwort von
 * Rebrickable wird kurz gemerkt, statt bei jedem Versuch erneut zu fragen.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  findSetInScope() aus der Route entfernt (Import für das fragende
 *      Konto wie vorher) → rot: „ein fremdes Set wird nicht importiert“ und
 *      „das Set des Unterkontos … für dessen Besitzer“
 *   B  Drossel entfernt → rot: „je Konto höchstens 30 Importe je Stunde“
 *   C  der Merker `_leer` in getAllSetParts() nicht gelesen → rot: „eine
 *      leere Antwort wird gemerkt“ (zwei Abrufe statt einem)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

// Vor dem Laden der Route: Import und Rebrickable-Abruf mitschreiben statt ausführen.
const importe = [];
const abrufe = [];
const ersetze = (rel, zusatz) => {
  const pfad = require.resolve(path.join(quellen.DIST, rel));
  _req(rel);
  require.cache[pfad].exports = Object.assign({}, require.cache[pfad].exports, zusatz);
};
// Der Client zuerst: Wer ihn danach lädt, bekommt schon den Ersatz.
ersetze('clients/rebrickable.js', { holeSetTeile: async (n) => { abrufe.push(n); return { teile: [], verweigert: false }; } });
ersetze('src/katalog/partsImport.js', { importPartsForSet: async (sn, uid) => { importe.push([sn, uid]); return 3; } });

const db = _req('db/database.js');
const P = process.pid;

test('Teile-Import nur im Blickfeld', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;

  const namen = [`ti_haupt_${P}`, `ti_unter_${P}`, `ti_fremd_${P}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen) ids.push((await db.get(`INSERT INTO users (username, password_hash, is_active)
    VALUES ($1, 'x', true) RETURNING id`, [n])).id);
  const [H, U, F] = ids;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [H, U]);
  const UNTER = `TIU${P}-1`, FREMD = `TIF${P}-1`;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2), ($3, $4)', [U, UNTER, F, FREMD]);
  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'teile-import|%'");
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'teile-import|%'").catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const sitzung = {};
  const { base } = testServer(_req, { sitzung, t, routen: { '/api/v1': 'routes/api_v1/index.js' } });
  const importiere = async (als, sn) => {
    sitzung.userId = als;
    const r = await fetch(`${base}/api/v1/sets/${encodeURIComponent(sn)}/parts`, { method: 'POST' });
    return { status: r.status, body: await r.json() };
  };

  await t.test('ein fremdes Set wird nicht importiert', async () => {
    const r = await importiere(H, FREMD);
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(r.body.code, 'set_nicht_gefunden');
    assert.deepEqual(importe, []);
  });

  await t.test('das Set des Unterkontos importiert das Hauptkonto für dessen Besitzer', async () => {
    const r = await importiere(H, UNTER);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { success: true, count: 3 });
    assert.deepEqual(importe, [[UNTER, U]]);
  });

  await t.test('je Konto höchstens 30 Importe je Stunde', async () => {
    const status = [];
    for (let i = 0; i < 30; i++) status.push((await importiere(U, UNTER)).status);
    assert.deepEqual([...new Set(status)], [200], 'bis zur Grenze geht jeder durch');
    const zuViel = await importiere(U, UNTER);
    assert.equal(zuViel.status, 429);
    assert.equal(zuViel.body.code, 'zu_viele_anfragen');
    assert.equal((await importiere(F, FREMD)).status, 200, 'ein anderes Konto zählt für sich');
  });

  await t.test('eine leere Antwort wird gemerkt', async () => {
    const { getAllSetParts } = _req('src/katalog/rebrickableKatalog.js');
    const leer = `TIL${P}-1`;
    assert.deepEqual(await getAllSetParts(leer), []);
    assert.deepEqual(await getAllSetParts(leer), []);
    assert.deepEqual(abrufe, [leer], 'die zweite Frage ging wieder an Rebrickable');
  });
});
