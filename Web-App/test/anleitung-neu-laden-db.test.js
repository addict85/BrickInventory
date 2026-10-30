/**
 * Geteilte Anleitungen neu laden darf nur, wer das Set im Haushalt hat.
 *
 * POST /sets/:sn/instructions löscht die geteilten Anleitungen des Sets und
 * holt sie neu. Vorher konnte das jedes Konto für jedes Set — die Anleitung
 * war dann für alle weg, bis die Quellen wieder antworteten.
 *
 * Gegenprobe (am 27.10. gemessen): die Prüfung auf findSetInScope entfernt →
 * rot: „ein fremdes Konto" (200, die Anleitung war gelöscht).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const { haeltSet } = require('./helpers/bestand');

// Kein Abruf bei den Quellen: Das Neuladen findet hier nichts.
const anlPfad = require.resolve(path.join(require('./helpers/sources').DIST, 'utils', 'instructions.js'));
const echt = _req('utils/instructions.js');
require.cache[anlPfad].exports = Object.assign({}, echt, { downloadSetInstructions: async () => [] });

const db = _req('db/database.js');
const SET = '99072-1', URL_A = 'https://quelle.example/99072.pdf';
const NAMEN = ['anl_halter', 'anl_fremd'].map(n => `${n}_${process.pid}`);

test('Anleitungen neu laden', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const ids = [];
  for (const n of NAMEN)
    ids.push((await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                            VALUES ($1, 'x', 1, 1) RETURNING id`, [n])).id);
  await db.run(`INSERT INTO set_catalog (set_number, name, year, theme, pieces, minifigs)
                VALUES ($1, 'Anleitungsprobe', 2024, 'Test', 10, 0) ON CONFLICT (set_number) DO NOTHING`, [SET]);
  await haeltSet(db, ids[0], SET, 1);
  const anleitung = () => db.run(`INSERT INTO shared_instructions (set_number, url) VALUES ($1, $2)
                                  ON CONFLICT DO NOTHING`, [SET, URL_A]);
  const vorhanden = async () => !!(await db.get('SELECT 1 AS ok FROM shared_instructions WHERE set_number = $1', [SET]));

  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [SET]).catch(() => {});
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SET]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const sitzung = {};
  const { base } = testServer(_req, { sitzung, routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const neuLaden = async (als) => {
    Object.assign(sitzung, als);
    return (await fetch(`${base}/api/v1/sets/${SET}/instructions`, { method: 'POST' })).status;
  };

  await t.test('ein fremdes Konto', async () => {
    await anleitung();
    assert.equal(await neuLaden({ userId: ids[1], isAdmin: false }), 404);
    assert.ok(await vorhanden(), 'Die geteilte Anleitung ist weg, obwohl das Konto das Set nicht hat');
  });

  await t.test('wer das Set hat', async () => {
    await anleitung();
    assert.equal(await neuLaden({ userId: ids[0], isAdmin: false }), 200);
    assert.ok(!await vorhanden(), 'Vorbedingung des Neuladens: die alte Zeile ist entfernt');
  });

  await t.test('der Verwalter', async () => {
    await anleitung();
    assert.equal(await neuLaden({ userId: ids[1], isAdmin: true }), 200);
  });
});
