/**
 * Eine Menge kürzen heisst, mehrere Erfassungen zu löschen oder zu kürzen.
 * Scheitert ein Schritt, bleibt alles, wie es war — vorher waren dann nur
 * einige Erfassungen weg, und die Menge stimmte nicht mehr.
 *
 * Erzwungen wird der Fehler mit einem Trigger auf der älteren Erfassung.
 *
 * Gegenprobe (am 27.10. gemessen): in updateManualPart die Schleife wieder
 * ohne db.transaction (db.run statt tx.run) → rot: „nichts halb gekürzt"
 * (die neuere Erfassung war gelöscht).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { updateManualPart } = _req('utils/manuelleTeile.js');

const NAME = `kuerzen_${process.pid}`, TEIL = '3001kz';

test('Kürzen geht ganz oder gar nicht', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); } finally { client.release(); }

  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', 1, 1) RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, $2, 5, 'manual')`, [uid, TEIL]);
  const alt = (await db.get(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, created_at)
                             VALUES ($1, $2, 5, 3, NOW() - INTERVAL '3 days') RETURNING id`, [uid, TEIL])).id;
  await db.run(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, created_at)
                VALUES ($1, $2, 5, 2, NOW() - INTERVAL '1 day')`, [uid, TEIL]);
  const fn = `kuerzen_sperre_${process.pid}`;
  await db.run(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN IF OLD.id = ${alt} THEN RAISE EXCEPTION 'erzwungener Fehler'; END IF; RETURN NEW; END $$`);
  await db.run(`CREATE TRIGGER ${fn} BEFORE UPDATE ON part_acquisitions FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  t.after(async () => {
    await db.run(`DROP TRIGGER IF EXISTS ${fn} ON part_acquisitions`).catch(() => {});
    await db.run(`DROP FUNCTION IF EXISTS ${fn}()`).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const erfassungen = async () => (await db.all(
    'SELECT quantity FROM part_acquisitions WHERE user_id = $1 ORDER BY created_at', [uid])).map(r => r.quantity);

  await t.test('nichts halb gekürzt', async () => {
    assert.deepEqual(await erfassungen(), [3, 2], 'Vorbedingung');
    // 5 → 1: die neuere (2) weg, die ältere um 2 kürzen — dort greift der Trigger.
    await assert.rejects(updateManualPart(uid, TEIL, 5, { quantity: 1 }), /erzwungener Fehler/);
    assert.deepEqual(await erfassungen(), [3, 2], 'Die neuere Erfassung ist weg, die ältere nicht gekürzt');
  });

  await t.test('ohne Fehler wird gekürzt', async () => {
    await db.run(`DROP TRIGGER ${fn} ON part_acquisitions`);
    await updateManualPart(uid, TEIL, 5, { quantity: 1 });
    assert.deepEqual(await erfassungen(), [1]);
  });
});
