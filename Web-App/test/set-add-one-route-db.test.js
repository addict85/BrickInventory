/**
 * The import (CSV, wanted XML) also captures via setErfassen(): without network, set,
 * acquisition, storage location and follow-up work in one transaction. Typed in, a set
 * in view is called „exists“; an import tops up at the owner and creates it in its own
 * account if only another one in the household has it (the file is its inventory).
 *
 * Counter-checks (measured 14.11.2026):
 *   A  in the top-up branch the follow-up work enqueued after the transaction (like the
 *      former addSet, error swallowed with attempts()) → red: “if the
 *      follow-up work fails, nothing is booked”
 *   B  in the top-up branch `await t.katalog.setInfo(sn)` before booking → red:
 *      “an import tops up at the owner, without network”
 *   C  the top-up branch never entered (always „melden“) → red: “an import tops
 *      up at the owner …” (exists instead of updated)
 *   D  in the top-up branch the default storage location set again → red: “an import
 *      without a location leaves the storage location alone”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testSources, testImageWorker, asAccount } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('add a set: one path for input and import', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const netz = [];
  testSources(t, {
    holeSet: async sn => {
      netz.push(sn);
      return null;
    },
    setDetails: async sn => {
      netz.push(sn);
      return null;
    },
  });
  testImageWorker(t, { loadSetImage: async () => null });
  const sets = require('./helpers/sources').areaPage('sets');
  const P = process.pid % 100000;
  const MAIN = `einweg-h-${P}`,
    KIND = `einweg-k-${P}`;
  const SN = `${60000 + (P % 9000)}-1`,
    FREMD = `${50000 + (P % 9000)}-1`;
  const FUNCTION_NAME = `einweg_sperre_${P}`;
  const weg = async () => {
    await db.exec(`DROP TRIGGER IF EXISTS ${FUNCTION_NAME} ON jobs; DROP FUNCTION IF EXISTS ${FUNCTION_NAME}();`);
    for (const sn of [SN, FREMD]) {
      await db.run("DELETE FROM jobs WHERE type = 'rework' AND payload->>'set_number' = $1", [sn]);
      await db.run('DELETE FROM rb_sets WHERE set_num = $1', [sn]);
    }
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[MAIN, KIND]]);
  };
  await weg();
  t.after(async () => {
    await weg();
    await db.pool.end().catch(() => {});
  });
  const neu = async n =>
    (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [n])).id;
  const h = await neu(MAIN),
    k = await neu(KIND);
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [h, k]);
  const quantity = async (uid, sn) =>
    (
      await db.get(
        'SELECT COALESCE(SUM(quantity), 0)::int AS n FROM set_acquisitions WHERE user_id = $1 AND set_number = $2',
        [uid, sn],
      )
    ).n;
  const record = (uid, e) => asAccount(uid, () => sets.acquireSet({ requester: uid, ...e }));

  await t.test('no network on import, follow-up work in the same transaction', async () => {
    const r = await record(h, {
      setNumber: SN,
      quantity: 1,
      storage: 'Kiste 1',
      ifPresent: 'aufstocken',
      rework: 'csv',
    });
    assert.equal(r.action, 'added');
    const auftrag = await db.get(
      "SELECT payload->>'kind' AS type FROM jobs WHERE type = 'rework' AND payload->>'set_number' = $1",
      [SN],
    );
    assert.equal(auftrag?.type, 'csv');
    assert.deepEqual(netz, []);
  });

  await t.test('an import tops up at the owner, without network', async () => {
    // A default of the account: it must not move the already sorted-in set (below).
    const preset = await db.get(`INSERT INTO storage_locations (user_id, name) VALUES ($1, 'Vorgabe') RETURNING id`, [
      h,
    ]);
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'default_storage_id', $2)`, [
      h,
      String(preset.id),
    ]);
    const r = await record(h, { setNumber: SN, quantity: 2, ifPresent: 'aufstocken' });
    assert.equal(r.action, 'updated');
    assert.equal(await quantity(h, SN), 3);
    assert.deepEqual(netz, [], 'no network during import');
  });

  await t.test('an import without a location leaves the storage location alone', async () => {
    const location = await db.get(
      'SELECT l.name FROM sets s JOIN storage_locations l ON l.id = s.storage_id WHERE s.user_id = $1 AND s.set_number = $2',
      [h, SN],
    );
    assert.equal(location?.name, 'Kiste 1');
  });

  await t.test('typed in, a set in view is called “exists”', async () => {
    const r = await record(h, { setNumber: SN, quantity: 1 });
    assert.equal(r.action, 'exists');
    assert.equal(await quantity(h, SN), 3);
  });

  await t.test('if only the other account has the set, the import creates it in its own', async () => {
    assert.equal((await record(k, { setNumber: FREMD, quantity: 1 })).action, 'added');
    assert.equal((await record(h, { setNumber: FREMD, quantity: 1 })).action, 'exists', 'typed: in scope');
    assert.equal((await record(h, { setNumber: FREMD, quantity: 1, ifPresent: 'aufstocken' })).action, 'added');
    assert.equal(await quantity(h, FREMD), 1);
    assert.equal(await quantity(k, FREMD), 1);
  });

  await t.test('if the follow-up work fails, nothing is booked', async () => {
    await db.exec(`
      CREATE FUNCTION ${FUNCTION_NAME}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'rework' AND NEW.payload->>'set_number' = '${SN}' THEN RAISE EXCEPTION 'Auftrag abgelehnt'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER ${FUNCTION_NAME} BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION ${FUNCTION_NAME}();`);
    await db.run("DELETE FROM jobs WHERE type = 'rework' AND payload->>'set_number' = $1", [SN]);
    await assert.rejects(record(h, { setNumber: SN, quantity: 1, ifPresent: 'aufstocken' }), /Auftrag abgelehnt/);
    assert.equal(await quantity(h, SN), 3);
  });
});
