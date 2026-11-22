/**
 * Which sets use this part / this figure?
 *
 * Counter-check: usingSets() (src/inventory/shared.ts) delivers set_name null → red “the list of using sets follows the viewport”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { holdsMinifig, holdsSet, holdsPart, catalogSet } = require('./helpers/inventory');
const db = testData();
const { usingSets } = _req('src/inventory/shared.js');

async function erreichbar() {
  try {
    await db.get('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

after(() => db.pool.end());

test('the list of using sets follows the viewport', async t => {
  if (!(await erreichbar())) {
    noDb(t);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();
  // And the MIGRATIONS, not only the schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const haupt = await id('haupt'),
    kind = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [haupt, kind]);

  await holdsSet(db, haupt, '75192-1', 1);
  await holdsSet(db, haupt, '10305-1', 1);
  await holdsSet(db, kind, '21058-1', 1);
  // Since migration 0033 the set name stands in the catalog; the list of
  // using sets fetches it with its own JOIN on it.
  for (const [nr, name] of [
    ['75192-1', 'Millennium Falcon'],
    ['10305-1', 'Lion Knights Castle'],
    ['21058-1', 'Cheops-Pyramide'],
  ])
    await catalogSet(db, nr, { name });

  // Since migration 0034 name, color label and spare part flag stand
  // in the catalogs. The dialog header below reads them from there, and
  // this test checks exactly that it forms them from THE SAME pass as
  // the list.
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES ('3001','Brick 2x4')`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES
      ('3001',4,'Rot'), ('3001',1,'Blau')`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ('sw0001','Han Solo')`);

  // The same part in three sets — twice at the main account, once at the child.
  await holdsPart(db, haupt, '3001', { setNumber: '75192-1', quantity: 15, colorId: 4 });
  await holdsPart(db, haupt, '3001', { setNumber: '10305-1', quantity: 7, colorId: 4 });
  await holdsPart(db, kind, '3001', { setNumber: '21058-1', quantity: 3, colorId: 4 });
  await holdsPart(db, haupt, '3001', { setNumber: '75192-1', quantity: 99, colorId: 1 });

  // Captured manually: NO set number. Must not show up.
  await holdsPart(db, haupt, '3001', { quantity: 42, colorId: 4 });

  await holdsMinifig(db, haupt, 'sw0001', { setNumber: '75192-1', quantity: 2 });
  await holdsMinifig(db, kind, 'sw0001', { setNumber: '21058-1', quantity: 1 });
  await holdsMinifig(db, haupt, 'sw0001', { quantity: 9 });

  // ── Part, scope of the main account (household) ───────────────────────────
  const { item, sets: inHousehold } = await usingSets([haupt, kind], 'parts', {
    part_number: '3001',
    color_id: 4,
  });
  assert.deepEqual(
    inHousehold.map(s => s.set_number),
    ['10305-1', '21058-1', '75192-1'],
    `Expected three sets in number order, got ${JSON.stringify(inHousehold.map(s => s.set_number))}`,
  );

  // ── A second row for the same key is rejected ──────────
  //
  // The setup above claims it cannot exist. Without this probe
  // that would only be a claim in the comment; if idx_parts_unique falls
  // away, the old duplication would come back — and with it two piece counts for
  // the same position, one of which is wrong.
  await assert.rejects(
    () =>
      db.run(
        `INSERT INTO parts (user_id, set_number, part_number, color_id, source)
                  VALUES ($1,'75192-1','3001',4,'set')`,
        [haupt],
      ),
    /idx_parts_unique|duplicate key/,
    'A second parts row for the same account, set, part and colour ' +
      'was accepted — then the piece count exists twice again',
  );

  const nach = Object.fromEntries(inHousehold.map(s => [s.set_number, s]));
  assert.equal(nach['75192-1'].quantity, 15, 'The piece count of a set part is the catalogue number of the set');
  assert.equal(nach['10305-1'].quantity, 7);
  assert.equal(nach['21058-1'].quantity, 3);
  assert.equal(
    nach['21058-1'].owner_user_id,
    kind,
    'The owner must come along — otherwise the household view does not show whom the set belongs to',
  );
  assert.equal(nach['75192-1'].set_name, 'Millennium Falcon', 'Without the name the dialog only shows a number');

  // The manual position (42 pieces, without a set) must be in no sum.
  const summe = inHousehold.reduce((n, s) => n + s.quantity, 0);
  assert.equal(summe, 25, `total ${summe} — the manually recorded row was counted as well`);

  // ── The COLOR separates ─────────────────────────────────────────────────────
  const blau = (await usingSets([haupt, kind], 'parts', { part_number: '3001', color_id: 1 })).sets;
  assert.deepEqual(
    blau.map(s => [s.set_number, s.quantity]),
    [['75192-1', 99]],
    'The colour is not distinguished — then the dialog shows foreign stock',
  );

  // ── A single account sees only its own set ───────────────────────────────
  const nurKind = (await usingSets([kind], 'parts', { part_number: '3001', color_id: 4 })).sets;
  assert.deepEqual(
    nurKind.map(s => s.set_number),
    ['21058-1'],
    'Without a household only the own set may appear',
  );

  // ── Figures: the same function, the same rules ─────────────────────────
  const { item: figItem, sets: minifigs } = await usingSets([haupt, kind], 'minifigs', { fig_number: 'sw0001' });
  assert.deepEqual(
    minifigs.map(s => [s.set_number, s.quantity]),
    [
      ['21058-1', 1],
      ['75192-1', 2],
    ],
    'The same applies to figures — including: the manually recorded one does not count',
  );

  // ── The header of the dialog comes from THE SAME rows ─────────────────────
  //
  // A second query for name, color and image could say something different
  // than the list below it. Hence both are formed from one pass —
  // and hence both are checked here.
  assert.equal(item.number, '3001');
  assert.equal(item.name, 'Brick 2x4');
  assert.equal(item.color_name, 'Rot');
  assert.equal(
    item.total_quantity,
    25,
    'The total quantity must be the sum of the sets — and NOT contain the manual row',
  );
  assert.equal(
    item.is_spare,
    false,
    'is_spare arrives as INTEGER; "0" is TRUTHY in JavaScript — a real boolean must be here',
  );

  assert.equal(figItem.number, 'sw0001');
  assert.equal(figItem.name, 'Han Solo');
  assert.equal(
    figItem.color_name,
    null,
    'Figures have no colour — the field must be there anyway so that both responses have the same shape',
  );
  assert.equal(figItem.total_quantity, 3);

  // Self-proof: if the query were broken and delivered nothing at all, all the
  // deepEqual above would have run against empty lists — the first would have reported it.
  // This line additionally records that BOTH sides delivered something.
  assert.ok(inHousehold.length >= 3 && minifigs.length >= 2, 'One of the two queries returned nothing');
});

test('a disallowed column is rejected', async t => {
  if (!(await erreichbar())) {
    t.skip('no test DB');
    return;
  }
  // The column name is inserted into the query text — as a parameter that does
  // not work. The names come from literals of the two routes, never from a
  // request; the barrier stands nevertheless, so that a future caller cannot insert
  // anything else.
  await assert.rejects(
    () => usingSets([1], 'parts', { 'part_number; DROP TABLE parts': 'x' }),
    /unerlaubte Spalte/,
    'An arbitrary column name got through',
  );
});
