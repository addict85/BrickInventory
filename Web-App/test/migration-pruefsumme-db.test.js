/**
 * schema_migrations trägt je Migration eine Prüfsumme; ist eine schon
 * angewandte Datei danach geändert worden, bricht runMigrations() mit einer
 * Meldung ab, die die Datei nennt. Eine fehlende Summe (vor der Prüfung
 * angewandt) wird nachgetragen.
 *
 * Die Änderung wird an der gespeicherten Summe nachgestellt, nicht an der
 * Datei: dist/ teilen sich alle Testdateien, auch parallel laufende.
 *
 * Gegenproben (am 30.10.2026 gemessen):
 *   A  in pruefeAngewandte() den Vergleich `r.pruefsumme !== ist` entfernt →
 *      rot: „eine geänderte Migration hält den Start an“ (kein Fehler)
 *   B  das Nachtragen fehlender Summen entfernt → rot: „eine fehlende Summe
 *      wird nachgetragen“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { runMigrations } = _req('db/migrate.js');

const PROBE = '0077-wechselkurse.sql';

test('Prüfsummen der Migrationen', { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  const summe = async () => (await c.query('SELECT pruefsumme FROM schema_migrations WHERE name = $1', [PROBE])).rows[0].pruefsumme;
  t.after(async () => {
    await c.query('UPDATE schema_migrations SET pruefsumme = NULL WHERE name = $1', [PROBE]).catch(() => {});
    await runMigrations(c).catch(() => {});
    c.release();
    await db.pool.end().catch(() => {});
  });
  const echt = await summe();
  assert.match(echt, /^[0-9a-f]{64}$/, 'die Migration trägt eine SHA-256-Summe');

  await t.test('eine fehlende Summe wird nachgetragen', async () => {
    await c.query('UPDATE schema_migrations SET pruefsumme = NULL WHERE name = $1', [PROBE]);
    assert.deepEqual(await runMigrations(c), []);
    assert.equal(await summe(), echt);
  });

  await t.test('eine geänderte Migration hält den Start an', async () => {
    await c.query(`UPDATE schema_migrations SET pruefsumme = repeat('0', 64) WHERE name = $1`, [PROBE]);
    await assert.rejects(runMigrations(c),
      new RegExp(`Schon angewandte Migration\\(en\\) nachträglich geändert: ${PROBE.replace('.', '\\.')}\\. Den alten Inhalt wiederherstellen`));
  });
});
