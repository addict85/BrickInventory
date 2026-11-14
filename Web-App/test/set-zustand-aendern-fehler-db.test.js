/**
 * Scheitert beim Ändern eines Sets das Schreiben des Zustands, meldet updateSet
 * den Fehler, statt mit der alten Menge Erfolg zu melden.
 *
 * Gegenprobe (14.11.2026 gemessen): in updateSet() wieder
 * `try { schreibeInLetzteErfassung(…condition…) } catch (e) { console.error(…) }`
 * → rot: „Missing expected rejection“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten, bereichsSeite, alsKonto } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { haeltSet } = require('./helpers/bestand');
const db = testDaten();
const { updateSet } = bereichsSeite('sets');

test('ein gescheiterter Zustandswechsel ist ein Fehler', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;
  const name = `zsf_${process.pid}`;
  const SET = `91${String(process.pid).slice(-4)}-1`;
  const FUNKTION = `zustand_sperre_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [name])).id;
  await haeltSet(db, uid, SET, 1, { zustand: 'N' });
  // Nur dieses Set: Andere Testdateien teilen die Tabelle nicht, aber die Vorlage.
  await db.exec(`
    CREATE FUNCTION ${FUNKTION}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.set_number = '${SET}' AND NEW.condition IS DISTINCT FROM OLD.condition THEN
        RAISE EXCEPTION 'Zustand gesperrt';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ${FUNKTION} BEFORE UPDATE ON set_acquisitions FOR EACH ROW EXECUTE FUNCTION ${FUNKTION}();`);
  t.after(async () => {
    await db.exec(`DROP TRIGGER IF EXISTS ${FUNKTION} ON set_acquisitions; DROP FUNCTION IF EXISTS ${FUNKTION}();`);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  await assert.rejects(
    alsKonto(uid, () => updateSet(uid, SET, { condition: 'U' })),
    /Zustand gesperrt/,
  );
  const z = await db.get('SELECT condition FROM set_acquisitions WHERE user_id = $1 AND set_number = $2', [uid, SET]);
  assert.equal(z.condition, 'N');
});
