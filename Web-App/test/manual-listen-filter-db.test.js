/**
 * The filter of the tabs „Teile" and „Minifiguren" hits BOTH lists.
 *
 * ── Counter-checks (MEASURED on 20.10., numbers copied) ──────────────────
 *
 * Starting point: `# pass 11 / # fail 0` (ten cases and their wrapper). Every
 * counter-check is ONE change, reverted afterwards (the files were
 * compared against their backup).
 *
 *   A  `search` ignored in manualPartsList (`if (false && search)`)
 *      → `pass 4 / fail 7`. SIX cases are red: part number, name,
 *        BrickLink number, “without hits … empty”, “search text and storage location
 *        together” and “the set part stays out”. The first reports
 *        „die Suche nach 3001 liefert 3001,3002,3003 — erwartet nur 3001".
 *        That is Marco's finding, in numbers.
 *   B  `search` ignored in readManualMinifigs
 *      → `pass 9 / fail 2`. The figure case is red. That it is only one
 *        is the reason why this gap stayed unnoticed for so long: nobody
 *        searches the minifigures tab for a manually captured figure
 *        before noticing it with the parts.
 *   C  the BrickLink number removed from teileSuche()
 *      → `pass 8 / fail 3`. TWO cases are red: “the search finds the
 *        BrickLink number from the tile” (manual list) and “the wall of
 *        set parts searches via the same phrasing”. One change, two
 *        places — exactly for that the expression is merged.
 *   D  the storage location placeholder put BEFORE the search text in `params`, the
 *      numbers left in the SQL
 *      → `pass 9 / fail 2`. Red is “search text and storage location together” with
 *        zero hits: every condition got the value of the other one. The case
 *        stands there exactly for that reason.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { holdsMinifig, holdsPart } = require('./helpers/inventory');
const db = testData();

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('search text and storage location also hit the manually captured lists', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
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

  const u = await db.get(`INSERT INTO users (username,password_hash) VALUES ('marco','x') RETURNING id`);
  const UID = u.id;

  // Three manually captured parts. At BrickLink 3002 carries a DIFFERENT number —
  // and the tile shows that one (bl_part_number, blNumberSql). Whoever reads it
  // there also types it in.
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES
                  ('3001','Brick 2 x 4'), ('3002','Brick 2 x 2'), ('3003','Brick 2 x 3')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name) VALUES
                  ('3001',4,'Red'), ('3002',4,'Red'), ('3003',4,'Red')`);
  await db.run(`INSERT INTO bl_mapping (type,rb_id,bl_id) VALUES ('part','3002','9999')`);
  await db.run(`INSERT INTO storage_locations (user_id,name) VALUES ($1,'Kiste 3')`, [UID]);
  const ORT = (await db.get(`SELECT id FROM storage_locations WHERE name='Kiste 3'`)).id;
  await holdsPart(db, UID, '3001', { colorId: 4, quantity: 10, storageId: ORT });
  await holdsPart(db, UID, '3002', { colorId: 4, quantity: 5 });
  await holdsPart(db, UID, '3003', { colorId: 4, quantity: 1 });
  // A set part with the same number: it must NEVER show up in this list,
  // not even as a search hit.
  await holdsPart(db, UID, '3001', { setNumber: '10497-1', colorId: 7, quantity: 2 });

  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES
                  ('fig-000123','Chewbacca'), ('fig-000456','Luke Skywalker')`);
  await holdsMinifig(db, UID, 'fig-000123', { quantity: 1 });
  await holdsMinifig(db, UID, 'fig-000456', { quantity: 2 });

  const parts = _req('src/parts/queries.js');
  const minifigs = _req('src/minifigs/queries.js');
  const nummern = async opt => (await parts.manualPartsList([UID], UID, opt)).map(p => String(p.part_number)).sort();
  const figNumbers = async opt =>
    (await minifigs.readManualMinifigs([UID], UID, opt)).map(f => String(f.fig_number)).sort();

  await t.test('without search text everything is there', async () => {
    assert.deepEqual(
      await nummern({}),
      ['3001', '3002', '3003'],
      'Die Liste ohne Filter ist der Vergleichspunkt für alles Folgende',
    );
    assert.deepEqual(await figNumbers({}), ['fig-000123', 'fig-000456']);
  });

  await t.test('the search for the part number leaves only it', async () => {
    const g = await nummern({ search: '3001' });
    assert.deepEqual(
      g,
      ['3001'],
      `Die Suche nach 3001 liefert ${g.join(',')} — erwartet nur 3001. ` +
        'Genau das ist Marcos Befund: „passiert nichts".',
    );
  });

  await t.test('the search finds the name from the catalog', async () => {
    assert.deepEqual(
      await nummern({ search: '2 x 3' }),
      ['3003'],
      'Der Teilename steht seit Migration 0034 in part_catalog — die ' +
        'Bedingung muss über den JOIN gehen, nicht über parts',
    );
  });

  await t.test('the search finds the BrickLink number from the tile', async () => {
    const g = await nummern({ search: '9999' });
    assert.deepEqual(
      g,
      ['3002'],
      `Die Suche nach 9999 liefert ${g.join(',') || '(nichts)'} — erwartet 3002. ` +
        'Auf der Kachel steht 9999 (bl_part_number); eine Suche, die nur die ' +
        'Rebrickable-Nummer kennt, findet nicht, was dasteht.',
    );
  });

  await t.test('without hits the list stays empty — not full', async () => {
    assert.deepEqual(
      await nummern({ search: '4711' }),
      [],
      'Ein Suchtext ohne Treffer muss eine leere Liste ergeben. Käme die ' +
        'ganze Liste zurück, sähe es wieder aus wie „passiert nichts".',
    );
  });

  await t.test('the storage location filters the same list', async () => {
    assert.deepEqual(
      await nummern({ storage: 'Kiste 3' }),
      ['3001'],
      'Der Lagerortfilter steht in derselben Leiste und gehört zum gleichen ' + 'Versprechen',
    );
    assert.deepEqual(await nummern({ storage: 'Regal B' }), [], 'Ein Ort ohne Teile ergibt eine leere Liste');
  });

  await t.test('search text and storage location together', async () => {
    assert.deepEqual(
      await nummern({ search: '3001', storage: 'Kiste 3' }),
      ['3001'],
      'Beide Platzhalter stehen in EINER Abfrage; vertauschen sich ihre ' +
        'Nummern, bekommt jede Bedingung den Wert der anderen und die Liste ' +
        'ist leer',
    );
    assert.deepEqual(
      await nummern({ search: '3002', storage: 'Kiste 3' }),
      [],
      'Beide Bedingungen gelten zusammen, nicht wahlweise',
    );
  });

  await t.test('the set part stays out, even as a search hit', async () => {
    const alle = await parts.manualPartsList([UID], UID, { search: '3001' });
    assert.deepEqual(
      alle.map(p => p.color_id),
      [4],
      'Diese Liste zeigt nur source=manual. Das Set-Teil 3001 in Farbe 7 ' +
        'gehört in die Wand darunter — der Suchtext darf es nicht hereinholen.',
    );
  });

  await t.test('the figure list searches via number and name', async () => {
    assert.deepEqual(
      await figNumbers({ search: 'chewb' }),
      ['fig-000123'],
      'Der Figurenname steht in minifigs_catalog',
    );
    assert.deepEqual(await figNumbers({ search: '000456' }), ['fig-000456'], 'Die Figurennummer muss genauso treffen');
  });

  await t.test('the wall of set parts searches via the same phrasing', async () => {
    // teileSuche() is ONE expression for both lists. This assertion holds
    // them together: before, the live path of the set parts did NOT know the
    // BrickLink number, the precomputed summary next to it did
    // — the same search found something different depending on the path.
    const d = await parts.partsQuery([UID], { search: '9999' });
    assert.deepEqual(
      d.parts.map(p => String(p.part_number)),
      ['9999'],
      'Die Set-Teile-Wand findet die BrickLink-Nummer nicht — sie zeigt sie ' + 'aber an (blNumberSql als part_number)',
    );
  });
});
