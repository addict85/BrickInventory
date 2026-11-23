/**
 * „Can I build this?" — what the inventory comparison counts.
 *
 * Counter-check (carried out): the LEFT JOIN including multiplication set back to
 * `SUM(p.quantity)` → step 1 turns red, the others stay green.
 *
 * Counter-checks (22.11.2026, each alone, in public/js/init.js):
 *   A  the demand merged by `${blNum}|…` again → red “demand and inventory …” (one row)
 *   B  data-part with p.part_number instead of the BrickLink number → red the same test
 *   C  plFillStock sends the parts tab's stored filter instead of the own choice → red “the inventory reconciliation …”
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const { ownedQuantitiesQuery } = _req('src/parts/queries.js');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');

let UID = 0;

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  await db.run(`INSERT INTO users (username, password_hash) VALUES ('bauer','x')`);
  UID = (await db.get(`SELECT id FROM users WHERE username='bauer'`)).id;

  // Two sets: one owned twice, one once.
  await holdsSet(db, UID, '60052-1', 2);
  await holdsSet(db, UID, '10276-1', 1);

  // Parts FROM the sets (source stays empty — exactly as partsImport.ts creates them).
  const setTeil = async (setNr, num, farbe, quantity) => {
    // Description into the catalog, stock into parts (migration 0034).
    await db.run(
      `INSERT INTO part_catalog (part_number, part_name) VALUES ($1,'Brick')
                  ON CONFLICT (part_number) DO NOTHING`,
      [num],
    );
    await holdsPart(db, UID, num, { setNumber: setNr, quantity: quantity, colorId: farbe });
  };
  await setTeil('60052-1', '3001', 0, 3); // 3 per kit, owned twice → 6
  await setTeil('10276-1', '3002', 0, 5); // 5 per kit, owned once   → 5

  // Captured manually: hangs on no set.
  await holdsPart(db, UID, '3003', { quantity: 7, colorId: 0 });

  // Part row whose set no longer stands in `sets` — the LEFT JOIN case.
  await setTeil('99999-1', '3004', 0, 4);

  // Minifigures: one from the set owned twice, one captured manually.
  await holdsMinifig(db, UID, 'trn241', { setNumber: '60052-1', quantity: 1 });
  await holdsMinifig(db, UID, 'cty0500', { quantity: 2 });
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('inventory reconciliation of the parts list', { concurrency: 1 }, async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }
  await seed();
  t.after(async () => {
    await db.pool.end().catch(() => {});
  });

  const frage = [
    { part_number: '3001', color_id: 0 },
    { part_number: '3002', color_id: 0 },
    { part_number: '3003', color_id: 0 },
    { part_number: '3004', color_id: 0 },
    // The parts list attaches minifigures as rows of their own — with the
    // FIGURE NUMBER as part_number and color 0 (init.js, plGenerate).
    { part_number: 'trn241', color_id: 0 },
    { part_number: 'cty0500', color_id: 0 },
  ];
  const holding = await ownedQuantitiesQuery([UID], frage);

  await t.test('a set owned twice delivers its parts twice', () => {
    assert.equal(
      holding['3001|0']?.total,
      6,
      'Exactly what Marco reported: 3 pieces per kit, the set owned twice — ' +
        `expected 6, got ${holding['3001|0']?.total}. Is sets.quantity not counted?`,
    );
    assert.equal(holding['3001|0']?.loose, 0, 'A set part is not „lose"');
  });

  await t.test('a set owned once stays as it was', () => {
    // The opposite direction: the multiplication must not make more out of every
    // row, but only out of those with a piece count above one.
    assert.equal(holding['3002|0']?.total, 5);
  });

  await t.test('manually captured parts are NEVER multiplied', () => {
    assert.equal(holding['3003|0']?.total, 7);
    assert.equal(
      holding['3003|0']?.loose,
      7,
      'Manually recorded parts are exactly what „nur manuell erfasste Teile“ counts',
    );
  });

  await t.test('minifigures count too — also those from sets', () => {
    // The finding behind this check: the query asked in `parts`, and there
    // no figure stands. EVERY minifigure of a parts list therefore counted as
    // missing, even if it stood in the stock — silently, because „not
    // found" looks like „I don't have it".
    assert.equal(
      holding['trn241|0']?.total,
      2,
      'The figure is in a set owned twice — expected 2, got ' +
        `${holding['trn241|0']?.total}. Is the minifigs table not read at all?`,
    );
    assert.equal(holding['trn241|0']?.loose, 0, 'A figure from a set is not „lose"');
  });

  await t.test('manually captured figures count as loose', () => {
    assert.equal(holding['cty0500|0']?.total, 2);
    assert.equal(holding['cty0500|0']?.loose, 2);
  });

  await t.test('a part row without a set does not drop out of the response', () => {
    // The reason for LEFT instead of INNER: a deleted set would otherwise let its
    // part rows vanish without a trace — and the comparison would report a
    // part as missing that stands there.
    assert.equal(holding['3004|0']?.total, 4, 'Without a matching sets row the item was joined away entirely');
  });
});

/**
 * Both sides of the comparison use THE SAME number.
 *
 * Counter-check (carried out): key set back to `${blNum}|…` →
 * this step turns red.
 */
/** The part list in the real bundle: one set whose two mold variants share one BrickLink number. */
async function partListUi() {
  const { openUi, warte } = require('./helpers/ui');
  const part = (pn, q) => ({
    part_number: pn,
    bl_part_number: '3001',
    color_id: 5,
    color_name: 'Rot',
    part_name: 'Brick 2x4',
    total_quantity: q,
  });
  const ui = await openUi({
    '/v2/sets/info/10294-1': { success: true, name: 'Titanic', in_catalog: true },
    '/v2/parts/bl-color-map': { success: true, map: { 5: 5 } },
    '/v2/sets/10294-1/parts-list': { success: true, parts: [part('3001a', 2), part('3001b', 3)] },
    '/v2/sets/10294-1/minifigs-list': { success: true, figs: [] },
    '/v2/parts/owned': {
      success: true,
      holding: { '3001a|5': { total: 2, loose: 2 }, '3001b|5': { total: 1, loose: 1 } },
    },
  });
  const { d } = ui;
  d.getElementById('pl-setnr').value = '10294-1';
  d.getElementById('pl-setnr').dispatchEvent(new ui.w.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.ok(await warte(() => d.querySelectorAll('.pl-have-input').length === 2), 'the two variants are not listed');
  return ui;
}

test('demand and inventory are merged via the same number', async () => {
  // Merged by the Rebrickable number: two variants stay two rows, each finds its own holding.
  const { w, d, warte } = await partListUi();
  try {
    const rows = [...d.querySelectorAll('.pl-have-input')];
    assert.deepEqual(
      rows.map(el => [el.dataset.key, el.dataset.part, el.dataset.need]),
      [
        ['3001a__5', '3001', '2'],
        ['3001b__5', '3001', '3'],
      ],
      'the display shows the BrickLink number, the key stays Rebrickable',
    );
    d.getElementById('btn-pl-stock').click();
    assert.ok(await warte(() => rows[0].value === '2'));
    assert.deepEqual(
      rows.map(el => el.value),
      ['2', '1'],
    );
  } finally {
    w.close();
  }
});

/**
 * The scope of the comparison comes from THIS view.
 *
 * Counter-check (carried out): `scopeQuery('parts')` reinserted → red.
 */
test('the inventory reconciliation reads its scope from its own choice', async () => {
  // Not the parts tab's account filter: without the tick only the own account, with it the household.
  const { w, d, warte, aufrufe } = await partListUi();
  const owned = () => aufrufe.filter(a => a.url.includes('/v2/parts/owned')).map(a => a.url.replace(/^.*\/api/, ''));
  try {
    w.localStorage.setItem('bim_scope_parts', '7');
    d.getElementById('btn-pl-stock').click();
    assert.ok(await warte(() => owned().length === 1));
    assert.ok(await warte(() => !d.getElementById('btn-pl-stock').disabled), 'the button stays busy');
    d.getElementById('pl-stock-subs').checked = true;
    d.getElementById('btn-pl-stock').click();
    assert.ok(await warte(() => owned().length === 2));
    assert.deepEqual(owned(), ['/v2/parts/owned?accounts=own', '/v2/parts/owned']);
    const body = JSON.parse(aufrufe.find(a => a.url.includes('/v2/parts/owned')).body);
    assert.deepEqual(body.parts, [
      { part_number: '3001a', color_id: 5 },
      { part_number: '3001b', color_id: 5 },
    ]);
  } finally {
    w.close();
  }
});
