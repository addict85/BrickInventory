/**
 * A catalog change updates in the parts summary only the groups
 * that contain the changed number, and only in the accounts that
 * carry it (migration 0079, runCatalogFollowUp). The result equals a
 * full rebuild.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in runCatalogFollowUp() instead of the groups the whole account deleted and
 *      rebuilt (`nurGruppen` false, DELETE without part_key) → red: “other
 *      accounts and other groups stay”
 *   B  in the trigger remember_parts_catalog_both() only `neu` read (the old
 *      BrickLink number is missing) → red: “a new BrickLink mapping …”
 *      (the group of W keeps counting X: 3 instead of 1)
 *   C  the follow-up left out in summaryFresh() → red: “a changed
 *      part name …” (old name)
 *   D  (13.11.2026) in runCatalogFollowUp() the system frame left out → red:
 *      “one account's request also updates the others” (account B keeps
 *      „Y“, the queue is empty nevertheless)
 *
 * The services run in the name of an account under the runtime role as in operation;
 * test data is written and read by the owner role.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { holdsSet, holdsPart } = require('./helpers/inventory');
const { asRequest } = _req('src/infra/accountContext.js');
const als = (uid, f) => asRequest({ apiUser: { user_id: uid } }, f);

test('parts summary: catalog changes per part', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    noDb(t, e);
    return;
  }
  const PS = _req('src/parts/summary.js');
  const p = process.pid;
  const X = `kx${p}`,
    W = `kw${p}`,
    Z = `kz${p}`,
    Y = `ky${p}`,
    SA = `91${p % 1000}-1`,
    SB = `92${p % 1000}-1`;
  const konto = async n => {
    await db.run('DELETE FROM users WHERE username=$1', [n]);
    return (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [n])).id;
  };
  const a = await konto(`katalogA_${p}`),
    b = await konto(`katalogB_${p}`);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[a, b]]);
    await db.run('DELETE FROM part_catalog WHERE part_number = ANY($1)', [[X, W, Y, Z]]);
    await db.run(`DELETE FROM bl_mapping WHERE type = 'part' AND rb_id = ANY($1)`, [[X, W]]);
    await db.run('DELETE FROM set_parts WHERE set_number = ANY($1)', [[SA, SB]]);
    await db.pool.end().catch(() => {});
  });
  await holdsSet(db, a, SA, 1);
  await holdsPart(db, a, X, { setNumber: SA, quantity: 2, colorId: 4 });
  await holdsPart(db, a, Z, { setNumber: SA, quantity: 3, colorId: 4 });
  await holdsSet(db, b, SB, 1);
  await holdsPart(db, b, Y, { setNumber: SB, quantity: 5, colorId: 1 });
  await db.run(
    `INSERT INTO part_catalog (part_number, part_name) VALUES ($1,'X alt'),($2,'Z'),($3,'Y')
                ON CONFLICT (part_number) DO UPDATE SET part_name = EXCLUDED.part_name`,
    [X, Z, Y],
  );
  await als(a, () => PS.rebuildNow(a));
  await als(b, () => PS.rebuildNow(b));
  await als(a, () => PS.runCatalogFollowUp()); // clear from the queue what the build already contains

  const zeilen = uid =>
    db.all(
      `SELECT part_key, color_id, part_number, bl_part_number, part_name, total_quantity, in_sets, storage
                                    FROM parts_summary WHERE user_id = $1 ORDER BY part_key, color_id`,
      [uid],
    );
  const marke = (uid, teil) =>
    db.run(`UPDATE parts_summary SET storage = 'Marke' WHERE user_id = $1 AND part_number = $2`, [uid, teil]);
  /** Result now against a full rebuild of the same account. */
  const equalFullSetup = async uid => {
    const nach = await zeilen(uid);
    await als(uid, () => PS.rebuildNow(uid));
    assert.deepEqual(nach, await zeilen(uid), 'catch-up and full rebuild yield the same rows');
  };

  await t.test('a changed part name is there without a rebuild', async () => {
    await marke(a, Z);
    await marke(b, Y);
    await db.run(`UPDATE part_catalog SET part_name = 'X neu' WHERE part_number = $1`, [X]);
    assert.equal(await als(a, () => PS.summaryFresh(a, { strict: true })), true);
    assert.equal(
      (await db.get('SELECT part_name FROM parts_summary WHERE user_id=$1 AND part_number=$2', [a, X])).part_name,
      'X neu',
    );
  });

  await t.test('other accounts and other groups stay', async () => {
    assert.equal(
      (await db.get('SELECT storage FROM parts_summary WHERE user_id=$1', [b])).storage,
      'Marke',
      'account B was rebuilt',
    );
    assert.equal(
      (await db.get('SELECT storage FROM parts_summary WHERE user_id=$1 AND part_number=$2', [a, Z])).storage,
      'Marke',
      'group Z in account A was rebuilt',
    );
    await db.run(`UPDATE parts_summary SET storage = NULL WHERE storage = 'Marke' AND user_id = ANY($1)`, [[a, b]]);
    await equalFullSetup(a);
  });

  await t.test("one account's request also updates the others", async () => {
    await db.run(`UPDATE part_catalog SET part_name = 'Y neu' WHERE part_number = $1`, [Y]);
    assert.equal(await als(a, () => PS.summaryFresh(a, { strict: true })), true);
    assert.equal((await db.get('SELECT count(*)::int AS n FROM parts_catalog_pending')).n, 0);
    assert.equal(
      (await db.get('SELECT part_name FROM parts_summary WHERE user_id=$1 AND part_number=$2', [b, Y])).part_name,
      'Y neu',
    );
  });

  await t.test('a new BrickLink mapping moves the group', async () => {
    // W and X share a BrickLink number; the group is named after W.
    await holdsPart(db, a, W, { setNumber: SA, quantity: 1, colorId: 4 });
    await als(a, () => PS.rebuildNow(a));
    await db.run(`INSERT INTO bl_mapping (type, rb_id, bl_id) VALUES ('part', $1, $3), ('part', $2, $3)`, [
      X,
      W,
      `${X}bl`,
    ]);
    assert.equal(await als(a, () => PS.summaryFresh(a, { strict: true })), true);
    assert.deepEqual(
      (await zeilen(a)).map(z => [z.part_key, z.part_number, Number(z.total_quantity)]),
      [
        [`${X}bl`, W, 3],
        [Z, Z, 3],
      ],
    );
    // X moves on; the group of W then no longer contains X.
    await db.run(`UPDATE bl_mapping SET bl_id = $2 WHERE type = 'part' AND rb_id = $1`, [X, `${X}neu`]);
    assert.equal(await als(a, () => PS.summaryFresh(a, { strict: true })), true);
    assert.deepEqual(
      (await zeilen(a)).map(z => [z.part_key, z.part_number, Number(z.total_quantity)]),
      [
        [`${X}bl`, W, 1],
        [`${X}neu`, X, 2],
        [Z, Z, 3],
      ],
    );
    await equalFullSetup(a);
  });
});
