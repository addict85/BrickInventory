/**
 * Moving an entry only takes IT along — not the whole stock.
 *
 * ── Counter-checks (performed) ──────────────────────────────────────────────
 *
 *   a) With the old line (`src.quantity || 1`) the first case is red:
 *      “the sender has 0 entries left, expected 1".
 *   b) The second case checks the other direction — if the LAST
 *      entry moves, the row MUST disappear. Without it the test would also be
 *      green if nothing were ever deleted.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('moving one of two acquisitions leaves the rest with the sender', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const MAIN = await id('haupt'),
    KIND = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [MAIN, KIND]);

  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3001','Brick 2x4')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3001',4,'Rot')`);

  /**
   * A manual item with two entries on DIFFERENT days.
   *
   * Different days because idx_part_acq_tag_zustand (migration 0008) allows only one entry
   * per account, item and day — with the same date the second INSERT would
   * abort, and the setup could not even be created.
   */
  const setup = async () => {
    await db.run(`DELETE FROM part_acquisitions`);
    await db.run(`DELETE FROM parts`);
    await db.run(
      `INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',4,'manual')`,
      [MAIN],
    );
    await db.run(
      `INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                  VALUES ($1,'3001',4,2,0.50,'N', NOW() - INTERVAL '2 days'),
                         ($1,'3001',4,3,0.60,'N', NOW() - INTERVAL '1 day')`,
      [MAIN],
    );
    return (
      await db.all(`SELECT id, quantity FROM part_acquisitions WHERE user_id=$1 ORDER BY created_at`, [MAIN])
    ).map(r => ({ id: r.id, quantity: Number(r.quantity) }));
  };

  const { base } = testServer(_req, { sitzung: { userId: MAIN }, t });
  const move = async (entryId, afterAccount) => {
    const r = await fetch(`${base}/api/v2/parts/3001/4/acquisitions/${entryId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: afterAccount }),
    });
    return { status: r.status, body: await r.json() };
  };
  const zaehle = async uid => ({
    acquisitions: (
      await db.all(`SELECT quantity FROM part_acquisitions WHERE user_id=$1 ORDER BY quantity`, [uid])
    ).map(r => Number(r.quantity)),
    zeilen: (await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND part_number='3001'`, [uid])).c,
  });

  await t.test('the second acquisition moves, the first stays', async () => {
    const erf = await setup();
    const a = await move(erf[0].id, KIND); // the one with quantity 2
    assert.equal(a.status, 200, JSON.stringify(a.body));

    const sender = await zaehle(MAIN);
    assert.deepEqual(
      sender.acquisitions,
      [3],
      `The sender has ${sender.acquisitions.length} acquisitions left (${sender.acquisitions}), ` +
        'expected 1 with quantity 3. If it is 0, the move deleted ALL of them — ' +
        'exactly the bug this is about.',
    );
    assert.equal(sender.zeilen, 1, 'The holding row of the sender is gone although it still has 3 pieces');
    assert.equal(
      a.body.source_emptied,
      false,
      'The response says source_emptied=true although something stays at the sender',
    );

    const ziel = await zaehle(KIND);
    assert.deepEqual(ziel.acquisitions, [2], `The target has ${ziel.acquisitions} instead of [2]`);
    assert.equal(ziel.zeilen, 1, 'The target got no holding row');
  });

  await t.test('if the LAST acquisition moves, the row disappears after all', async () => {
    // The opposite direction. Without it the case above would also be green if
    // nothing were ever deleted — and a manual row without an entry is
    // ballast, not stock.
    const erf = await setup();
    assert.equal((await move(erf[0].id, KIND)).status, 200);
    const zweite = (await db.all(`SELECT id FROM part_acquisitions WHERE user_id=$1`, [MAIN])).map(r => r.id);
    assert.equal(zweite.length, 1, 'Precondition: exactly one must be left at the sender');
    const b = await move(zweite[0], KIND);
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(
      b.body.source_emptied,
      true,
      'The response must report source_emptied=true when nothing stays at the sender',
    );

    const sender = await zaehle(MAIN);
    assert.deepEqual(sender.acquisitions, [], 'No acquisition may stay at the sender');
    assert.equal(
      sender.zeilen,
      0,
      'The empty holding row of the sender must be gone — a manual row ' +
        'without an acquisition is ballast, not stock',
    );

    const ziel = await zaehle(KIND);
    assert.deepEqual(
      ziel.acquisitions,
      [2, 3],
      `The target must hold both quantities, has ${JSON.stringify(ziel.acquisitions)}`,
    );
  });
});
