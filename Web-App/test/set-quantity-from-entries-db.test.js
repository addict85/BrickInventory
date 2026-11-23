/**
 * Since db/base.sql the state BEFORE this migration no longer exists: the
 * cases on bolt, addendum and intermediate state are dropped. What is checked is
 * the final state and the read paths.
 *
 *      COUNTER-CHECK: if an acquisition changes, the response follows.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { catalogSet } = require('./helpers/inventory');
const db = testData();

// The same reasoning as in test/parts-prices-only-entries-db.test.js:
// this file builds the database from zero several times. Whoever runs afterwards
// must find it complete.
test.after(async () => {
  try {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  } catch (e) {
    console.error('[setmenge-aus-erfassungen] Aufraeumen fehlgeschlagen:', e.message);
  }
  await db.pool.end().catch(() => {});
});

const columnsOf = async table =>
  (await db.all(`SELECT column_name FROM information_schema.columns WHERE table_name=$1`, [table]))
    .map(r => r.column_name)
    .sort();

const dbDa = async t => {
  try {
    await db.run('SELECT 1');
    return true;
  } catch (e) {
    noDb(t, e);
    return false;
  }
};

/** Fresh database, schema, all migrations. */
async function fullChain() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
}

test('after the whole chain sets carries no quantity anymore', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();

  // The state before the migrations no longer exists: an empty
  // database gets db/base.sql. What is checked is the final state.
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  const later = await columnsOf('sets');
  assert.ok(
    !later.includes('quantity'),
    'sets.quantity is still there after all migrations — migration 0036 did not ' +
      'delete it, or something creates the column again afterwards.',
  );

  // And what `sets` still is: THIS account holds THIS set, since THEN, at THAT
  // place. Marco's list.
  for (const sp of ['id', 'user_id', 'set_number', 'storage_id', 'added_at', 'updated_at']) {
    assert.ok(later.includes(sp), `sets.${sp} is missing — the column belongs to the stock`);
  }

  // Not disappeared but moved.
  const erf = await columnsOf('set_acquisitions');
  for (const sp of ['user_id', 'set_number', 'quantity', 'purchase_price', 'condition', 'created_at']) {
    assert.ok(erf.includes(sp), `set_acquisitions.${sp} is missing — then the piece count exists nowhere any more`);
  }
});

test('nobody writes the item count of a set anymore', () => {
  // Only the SOURCE TEXT, and only the WRITE side. The read side is not checked by
  // this test but by the database: after migration 0036 the column does not
  // exist, every remaining read place is a hard error — and exactly
  // for that reason the read paths below run against a migrated database.
  const files = [];
  const run = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        run(p);
        continue;
      }
      if (/\.(ts|js)$/.test(e.name)) files.push(p);
    }
  };
  for (const part of ['routes', 'src', 'jobs', 'db', 'clients', 'scripts']) {
    const v = path.join(ROOT, part);
    if (fs.existsSync(v)) run(v);
  }
  files.push(path.join(ROOT, 'server.ts'));
  assert.ok(files.length > 100, `Only ${files.length} source files found — the path is wrong`);

  /** Lines without comments — an explanatory text that QUOTES a statement is
   *  not a write access. Exactly this trap has already made a rule in this tree
   *  report its own reasoning text. */
  const codeRows = txt =>
    txt.split('\n').filter(z => {
      const t = z.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('--'));
    });

  // Only the sets table: the acquisition tables of course keep writing their own
  // quantity — they are the truth, not the copy.
  // MEASURED with the first draft of this rule in its broader version: it
  // reported `UPDATE part_acquisitions SET quantity=quantity-$1` as a violation,
  // and that is exactly the path on which an acquisition becomes smaller.
  const sets = /UPDATE\s+sets\s+SET\s+[^;`']*\bquantity\s*=/i;
  const carryOn = /UPDATE\s+sets\s+SET\s+quantity\s*=\s*(?:sets\.)?quantity\s*[+-]/i;
  const onConflict = /INSERT\s+INTO\s+sets\b[^;]*DO\s+UPDATE\s+SET\s+[^;]*\bquantity\s*=/i;
  // And the column must not be created again either — an
  // `ADD COLUMN quantity` on sets would bring the copy back without violating a
  // single one of the rules above.
  const creates = /ALTER\s+TABLE\s+sets\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?quantity/i;

  const placeList = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const txt = fs.readFileSync(file, 'utf8');
    for (const z of codeRows(txt)) {
      for (const [was, pattern] of /** @type {[string, RegExp][]} */ ([
        ['setzt', sets],
        ['schreibt fort', carryOn],
        ['bei Konflikt', onConflict],
        ['legt an', creates],
      ])) {
        if (pattern.test(z)) placeList.push(`${rel} (${was}): ${z.trim().slice(0, 90)}`);
      }
    }
  }

  assert.deepEqual(
    placeList,
    [],
    'These places write the piece count of a set:\n  ' +
      placeList.join('\n  ') +
      '\nSince migration 0036 it lives exclusively in set_acquisitions. Exactly the ' +
      'second write direction drifted apart: sets.quantity = 10 with three ' +
      'acquisitions summing to 7.',
  );

  // ── Selbstbeweis ─────────────────────────────────────────────────────────
  //
  // The patterns above now find nothing — that is the point, but alone it does not
  // say yet that they COULD find anything at all. So proven once on
  // invented lines, in exactly the form that stood in the tree before
  // (the examples stand like this in src/sets/service.ts, version before 0036).
  const probeList = [
    ['UPDATE sets SET quantity = $1 WHERE user_id=$2', sets],
    ['UPDATE sets SET quantity = quantity + $1 WHERE id=$2', carryOn],
    [
      `INSERT INTO sets (user_id,set_number,quantity) VALUES ($1,$2,$3)
        ON CONFLICT (user_id,set_number) DO UPDATE SET quantity = sets.quantity + 1`,
      onConflict,
    ],
    ['ALTER TABLE sets ADD COLUMN IF NOT EXISTS quantity INTEGER', creates],
  ];
  for (const [row, pattern] of /** @type {[string, RegExp][]} */ (probeList)) {
    assert.ok(pattern.test(row), `The pattern no longer fires on its own probe: ${row.slice(0, 60)}`);
  }
  // And the opposite direction: what is allowed must NOT trigger.
  for (const row of [
    'UPDATE set_acquisitions SET quantity = quantity - $1 WHERE id=$2',
    'UPDATE parts SET quantity = COALESCE((SELECT SUM(a.quantity) FROM part_acquisitions a), 0)',
  ]) {
    for (const [was, pattern] of /** @type {[string, RegExp][]} */ ([
      ['setzt', sets],
      ['schreibt fort', carryOn],
      ['bei Konflikt', onConflict],
      ['legt an', creates],
    ])) {
      assert.ok(!pattern.test(row), `The pattern „${was}" reports an allowed line: ${row.slice(0, 70)}`);
    }
  }
});

test('the read paths deliver the item count from the entries', { concurrency: 1 }, async t => {
  if (!(await dbDa(t))) return;

  await fullChain();

  const main = await db.get(`INSERT INTO users (username,password_hash) VALUES ('mengeleser','x') RETURNING id`);
  const kind = await db.get(`INSERT INTO users (username,password_hash) VALUES ('mengeleser_kind','x') RETURNING id`);
  const SN = '10290-1';

  await catalogSet(db, SN, { name: 'Pickup Truck', year: 2022, pieces: 1677 });
  // Two accounts hold the same set — the household branch of setsLesen() merges
  // them into ONE tile and must add the quantities.
  await db.run(`INSERT INTO sets (user_id,set_number) VALUES ($1,$2),($3,$2)`, [main.id, SN, kind.id]);
  // Three acquisitions: two at the main account (2+1), one at the child (3).
  //
  // Different DAYS, and that is no cosmetics: idx_set_acq_tag_zustand (migration
  // 0004) allows exactly one acquisition per account, set and day. With the same
  // date the INSERT aborted — measured, „duplicate key value violates
  // unique constraint idx_set_acq_tag_zustand".
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                VALUES ($1,$2,2,100,'N', NOW() - INTERVAL '3 days'),
                       ($1,$2,1, 80,'U', NOW() - INTERVAL '1 day'),
                       ($3,$2,3, 90,'N', NOW() - INTERVAL '2 days')`,
    [main.id, SN, kind.id],
  );

  const H = require('./helpers/sources').areaPage('sets');

  // ── One account ────────────────────────────────────────────────────────────
  const one = await H.readSets([main.id], { page_size: 60 });
  const tile = one.sets.find(s => s.set_number === SN);
  assert.ok(tile, `The set is missing in the response: ${JSON.stringify(one.sets).slice(0, 300)}`);
  assert.equal(Number(tile.quantity), 3, `One account, acquisitions 2+1: expected 3, got ${tile.quantity}`);
  // The driver delivers BIGINT as a STRING. Without the ::int cast in
  // db/stockQuantity.ts the JSON type depends on which branch answered
  // — exactly this error already surfaced in src/parts/queries.ts.
  assert.equal(
    typeof tile.quantity,
    'number',
    `quantity must be a number, was ${typeof tile.quantity} (${tile.quantity})`,
  );

  // ── Household ─────────────────────────────────────────────────────────────
  const bothOnes = await H.readSets([main.id, kind.id], { page_size: 60 });
  const together = bothOnes.sets.find(s => s.set_number === SN);
  assert.ok(together, 'The set is missing in the household response');
  assert.equal(Number(together.quantity), 6, `household, acquisitions 2+1+3: expected 6, got ${together.quantity}`);
  assert.deepEqual(
    [...(together.owner_ids || [])].map(Number).sort((a, b) => a - b),
    [main.id, kind.id].sort((a, b) => a - b),
    'Both accounts hold copies and must both appear as owners',
  );

  // ── Detail ───────────────────────────────────────────────────────────────
  const detail = await H.readSet(main.id, SN);
  assert.ok(detail, 'The set detail does not answer');
  assert.equal(Number(detail.quantity), 3, `detail of one account: expected 3, got ${detail.quantity}`);

  // ── COUNTER-CHECK: change an acquisition ────────────────────────────────────
  //
  // The core of this test. Without it the numbers above could be right by chance —
  // say from another source that happens to say the same. Only when the
  // response FOLLOWS a change is it proven that it comes from the
  // acquisitions.
  const single = await db.get(
    `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2
      ORDER BY id ASC LIMIT 1`,
    [main.id, SN],
  );
  await db.run('UPDATE set_acquisitions SET quantity = 7 WHERE id=$1', [single.id]);

  const later = await H.readSets([main.id], { page_size: 60 });
  const fresh = later.sets.find(s => s.set_number === SN);
  assert.equal(
    Number(fresh.quantity),
    8,
    `After 2 → 7 the total must be 8 (7+1), got ${fresh.quantity}. Then the ` +
      'list does not read the quantity from set_acquisitions.',
  );

  const secondDetail = await H.readSet(main.id, SN);
  assert.equal(
    Number(secondDetail.quantity),
    8,
    `The detail does not follow the change: ${secondDetail.quantity} instead of 8`,
  );

  // ── And without an acquisition the quantity is 0, not 1 ──────────────────────────
  //
  // An inventory row without an acquisition should not exist (step 1 of the
  // migration fills one in for each), but it must not EMPTY the list
  // — hence LEFT JOIN in db/stockQuantity.ts. It then means
  // zero pieces.
  await db.run('DELETE FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [main.id, SN]);
  const empty = await H.readSets([main.id], { page_size: 60 });
  const zeroPieces = empty.sets.find(s => s.set_number === SN);
  assert.ok(
    zeroPieces,
    'Without an acquisition the set dropped out of the list — the JOIN must be a LEFT JOIN, ' +
      'otherwise exactly the rows that lack something disappear',
  );
  assert.equal(
    Number(zeroPieces.quantity),
    0,
    `Without an acquisition the quantity must be 0, not ${zeroPieces.quantity}`,
  );
});
