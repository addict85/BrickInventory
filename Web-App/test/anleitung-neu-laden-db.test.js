/**
 * Geteilte Anleitungen ersetzen (löschen und neu holen) darf nur der
 * Verwalter; wer das Set im Haushalt hat, holt nur fehlende. Sonst war eine
 * Anleitung für alle weg, wenn die Quellen beim Neuladen nichts lieferten.
 *
 * Gegenprobe (am 27.10. gemessen): die Prüfung auf findSetInScope entfernt →
 * rot: „ein fremdes Konto" (200, die Anleitung war gelöscht).
 *
 * Dazu einmal je Set und Tag für alle Konten zusammen; der Verwalter
 * ist frei. Gegenproben (am 30.10. gemessen):
 *   A  anleitungNeuLadenErlaubt() nicht gefragt → rot: „ein zweites Neuladen
 *      am selben Tag“
 *   B  die Prüfung moeglicheSetNummer() entfernt → rot: „eine Nummer mit
 *      Pfadteilen“ (404 statt 400)
 * Gegenproben (am 02.11.2026 gemessen):
 *   C  die Prüfung auf anzahlAnleitungen() entfernt → rot: „wer das Set hat,
 *      ersetzt keine geteilte Anleitung“ (200 statt 403)
 *   D  loescheAnleitungen() wieder für alle → rot: „ein fremdes Konto“ und C
 * Seit 05.11.2026 lädt ein Auftrag, die Route antwortet 202. Gegenprobe:
 *   E  anleitungEinreihen() in der Route nicht gerufen → rot: „das Neuladen
 *      steht als Auftrag an“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet } = require('./helpers/bestand');

// Kein Abruf bei den Quellen: Das Neuladen findet hier nichts.
const anlPfad = require.resolve(path.join(require('./helpers/sources').DIST, 'src/katalog/instructions.js'));
const echt = _req('src/katalog/instructions.js');
require.cache[anlPfad].exports = Object.assign({}, echt, { downloadSetInstructions: async () => [] });

const db = _req('db/database.js');
const SET = '99072-1', URL_A = 'https://quelle.example/99072.pdf';
const NAMEN = ['anl_halter', 'anl_fremd'].map(n => `${n}_${process.pid}`);

test('Anleitungen neu laden', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;

  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const ids = [];
  for (const n of NAMEN)
    ids.push((await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                            VALUES ($1, 'x', true, true) RETURNING id`, [n])).id);
  await db.run(`INSERT INTO set_catalog (set_number, name, year, theme, pieces, minifigs)
                VALUES ($1, 'Anleitungsprobe', 2024, 'Test', 10, 0) ON CONFLICT (set_number) DO NOTHING`, [SET]);
  await haeltSet(db, ids[0], SET, 1);
  const anleitung = () => db.run(`INSERT INTO shared_instructions (set_number, url) VALUES ($1, $2)
                                  ON CONFLICT DO NOTHING`, [SET, URL_A]);
  const vorhanden = async () => !!(await db.get('SELECT 1 AS ok FROM shared_instructions WHERE set_number = $1', [SET]));

  const drossel = () => db.run('DELETE FROM rate_limit_attempts WHERE key = $1', [`anleitung-neu|${SET}`]);
  await drossel();
  t.after(async () => {
    await drossel().catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [SET]).catch(() => {});
    await db.run('DELETE FROM set_catalog WHERE set_number = $1', [SET]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const sitzung = {};
  const { base } = testServer(_req, { sitzung, routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const neuLaden = async (als, nummer = SET) => {
    Object.assign(sitzung, als);
    return (await fetch(`${base}/api/v1/sets/${nummer}/instructions`, { method: 'POST' })).status;
  };

  await t.test('ein fremdes Konto', async () => {
    await anleitung();
    assert.equal(await neuLaden({ userId: ids[1], isAdmin: false }), 404);
    assert.ok(await vorhanden(), 'Die geteilte Anleitung ist weg, obwohl das Konto das Set nicht hat');
  });

  await t.test('wer das Set hat, ersetzt keine geteilte Anleitung', async () => {
    await anleitung();
    assert.equal(await neuLaden({ userId: ids[0], isAdmin: false }), 403);
    assert.ok(await vorhanden(), 'die geteilte Anleitung ist für alle weg');
  });

  await t.test('wer das Set hat, holt eine fehlende einmal am Tag', async () => {
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [SET]);
    assert.equal(await neuLaden({ userId: ids[0], isAdmin: false }), 202);
    assert.equal(await neuLaden({ userId: ids[0], isAdmin: false }), 429);
    await db.run(`UPDATE rate_limit_attempts SET first_at = NOW() - INTERVAL '25 hours' WHERE key = $1`, [`anleitung-neu|${SET}`]);
    assert.equal(await neuLaden({ userId: ids[0], isAdmin: false }), 202, 'nach einem Tag geht es wieder');
  });

  await t.test('der Verwalter ersetzt', async () => {
    await anleitung();
    assert.equal(await neuLaden({ userId: ids[1], isAdmin: true }), 202);
    assert.ok(!await vorhanden(), 'der Verwalter hat die alte Zeile nicht ersetzt');
    const auftrag = await db.get(`SELECT status FROM auftraege WHERE art = 'anleitung' AND schluessel = $1`, [`anleitung:${SET}`]);
    assert.equal(auftrag?.status, 'offen', 'das Neuladen steht als Auftrag an');
    await anleitung();
    assert.equal(await neuLaden({ userId: ids[1], isAdmin: true }), 202, 'den Verwalter hält die Drossel nicht');
  });

  await t.test('eine Nummer mit Pfadteilen', async () => {
    for (const roh of ['%2E%2E%2Fx', '%2E%2E%3Fx%3D', 'users'])
      assert.equal(await neuLaden({ userId: ids[1], isAdmin: true }, roh), 400, roh);
  });
});
