/**
 * Jeder Import läuft als Auftrag im Job-Prozess (src/auftraege/importAlsAuftrag.ts):
 * Die Anfrage reicht ein und wartet; ohne Job-Prozess bleibt der Auftrag offen.
 *
 * Gegenproben (05.11.2026 gemessen):
 *   A  in jobs/auftraegeStarten.ts csv_import immer über fuehreCsvImportAus
 *      (ohne Blick auf `quelle`) → rot: „mit Worker kommt das Ergebnis“
 *   B  importAlsAuftrag() vergisst das Ergebnis nicht (setzeErgebnis(id, null)
 *      gestrichen) → rot: derselbe Test (ergebnis bleibt in der Tabelle)
 *   C  importAlsAuftrag() ruft importiereTeileCsv direkt statt einzureichen
 *      → rot: „ohne Worker bleibt der Auftrag offen“ (und der zweite Fall)
 *   D  fuehreImportAus() fängt den Fachfehler nicht ab → rot: „ein Fachfehler
 *      kommt mit Code an“ (500 import_fehlgeschlagen)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { importWorker } = require('./helpers/auftraege');
const path = require('node:path');

// Vor dem Laden des Workers: Der Alarm-Import wirft einen Fachfehler.
const { dateiFehler } = _req('src/infra/fehlerTexte.js');
const pa = require.resolve(path.join(require('./helpers/sources').DIST, 'src/finanzen/preisalarm.js'));
_req('src/finanzen/preisalarm.js');
require.cache[pa].exports = Object.assign({}, require.cache[pa].exports,
  { alarmeAusCsv: async () => { throw dateiFehler('alarm_schwelle_ungueltig', 400); } });

test('Import als Auftrag', { concurrency: 1 }, async (t) => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const NAME = `importauftrag_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active) VALUES ($1, 'x', true) RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { importAlsAuftrag } = _req('src/auftraege/importAlsAuftrag.js');
  const csv = (teil) => `part_number,color_id,quantity\n${teil},0,2\n`;

  await t.test('ohne Worker bleibt der Auftrag offen', async () => {
    await assert.rejects(importAlsAuftrag(uid, 'teile_csv', { text: csv('ohne1') }, { wartenMs: 300 }),
      (e) => e.code === 'import_laeuft_noch' && e.status === 504);
    const a = await db.get(`SELECT status, nutzlast->>'quelle' AS quelle FROM auftraege
      WHERE art = 'csv_import' AND user_id = $1 ORDER BY id DESC LIMIT 1`, [uid]);
    assert.deepEqual(a, { status: 'offen', quelle: 'teile_csv' });
    assert.equal(await db.get("SELECT 1 FROM parts WHERE user_id = $1 AND part_number = 'ohne1'", [uid]), undefined);
    await db.run("DELETE FROM auftraege WHERE art = 'csv_import' AND user_id = $1", [uid]);
  });

  await t.test('mit Worker kommt das Ergebnis', async (tt) => {
    importWorker(tt, _req);
    const r = await importAlsAuftrag(uid, 'teile_csv', { text: csv('mit1') });
    assert.equal(r.success, true);
    assert.equal(r.total, 1);
    assert.equal(r.added + r.updated, 1, JSON.stringify(r));
    assert.ok(await db.get("SELECT 1 FROM parts WHERE user_id = $1 AND part_number = 'mit1'", [uid]));
    const a = await db.get(`SELECT status, ergebnis FROM auftraege WHERE art = 'csv_import' AND user_id = $1
      ORDER BY id DESC LIMIT 1`, [uid]);
    assert.deepEqual(a, { status: 'erledigt', ergebnis: null }, 'gelesen ist gelesen');
  });

  await t.test('ein Fachfehler kommt mit Code an', async (tt) => {
    importWorker(tt, _req);
    await assert.rejects(importAlsAuftrag(uid, 'alarme_csv', { waehrung: 'CHF', text: 'set_number\n1-1\n' }),
      (e) => e.code === 'alarm_schwelle_ungueltig' && e.status === 400);
  });
});
