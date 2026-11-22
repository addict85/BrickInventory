/**
 * The storage location must stand in the DETAIL — and only in the accounts that have it.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
// Since migration 0036 a stock entry is TWO rows: one in `sets` („this
// account holds this set") and one per purchase in `set_acquisitions`. holdsSet()
// creates both — see test/helpers/inventory.js.
const { holdsSet, holdsPart, catalogSet } = require('./helpers/inventory');
const { testServer } = require('./helpers/server');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

const SN = '10179-1';
let MAIN = 0,
  KIND = 0;

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
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('haupt','x'),('kind','x')`);
  MAIN = (await db.get("SELECT id FROM users WHERE username='haupt'")).id;
  KIND = (await db.get("SELECT id FROM users WHERE username='kind'")).id;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [MAIN, KIND]);
  // The set name stands in the catalog, the piece count in the capture, not on the stock row.
  await catalogSet(db, SN, { name: 'Falcon' });
  // The set belongs to the MAIN ACCOUNT. The sub-account has no row at all — exactly
  // the situation in which an entry in its stock describes nothing.
  await holdsSet(db, MAIN, SN, 1);
}

test('storage location: detail and stock against a real database', async t => {
  try {
    await db.get('SELECT 1 AS ok');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await seed();

  const L = {
    ..._req('src/inventory/storageLocation.js'),
    ...require('./helpers/sources').testArea('inventory').locationService,
  };
  const S = require('./helpers/sources').areaPage('sets');
  const household = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const writable = await household.writeScope(MAIN);
  // Precondition: the scope really covers BOTH accounts, otherwise
  // finding 2 below checks nothing.
  assert.ok(
    writable.includes(MAIN) && writable.includes(KIND),
    `schreibbereich lieferte ${writable} — der Haushalt steht nicht`,
  );

  assert.equal(
    await L.setLocation('set', writable, [SN], 'Estrich'),
    1,
    'Das Setzen muss genau die eine Zeile des Hauptkontos treffen',
  );

  await t.test('finding 1: the detail call delivers the name of the storage location', async () => {
    const detail = await S.readSet(writable, SN);
    assert.equal(
      detail.storage,
      'Estrich',
      `Das Detail liefert storage=${JSON.stringify(detail.storage)} — die Oberfläche zeigt ` +
        'dann ein leeres Feld, obwohl der Ort in der Datenbank steht',
    );

    // List and detail must say the same. Exactly between these two
    // the QUANTITY already drifted apart (see readSet in src/sets/read.ts).
    const liste = await S.readSets(writable, { page: 1, page_size: 10 });
    const row = (liste.sets || []).find(s => s.set_number === SN);
    assert.ok(row, 'Das Set fehlt in der Liste');
    assert.equal(
      row.storage,
      detail.storage,
      `Liste sagt ${JSON.stringify(row.storage)}, Detail sagt ` +
        `${JSON.stringify(detail.storage)} — zwei Antworten auf dieselbe Frage`,
    );

    // ── COUNTER-CHECK: the query in its earlier form ────────────────────
    // `SELECT s.*` without a resolved name. It delivers storage_id and no
    // storage — exactly the reported picture.
    const alt = await db.get(`SELECT s.* FROM sets s WHERE s.user_id = ANY($1) AND s.set_number = $2 LIMIT 1`, [
      writable,
      SN,
    ]);
    assert.equal(
      alt.storage,
      undefined,
      'Die frühere Form liefert plötzlich ein storage-Feld — dann prüft diese ' + 'Gegenprobe nicht mehr, was sie soll',
    );
    assert.ok(alt.storage_id > 0, 'Die frühere Form liefert keine storage_id — dann ist die Lage nicht die gedachte');
  });

  await t.test('finding 2: the place only arises in the account whose row it describes', async () => {
    const haupt = (await L.locationsOf([MAIN])).map(o => o.name);
    const kind = (await L.locationsOf([KIND])).map(o => o.name);
    assert.deepEqual(haupt, ['Estrich'], `Vorrat des Hauptkontos: ${haupt}`);
    assert.deepEqual(
      kind,
      [],
      `Der Vorrat des Unterkontos enthält ${kind} — diese Einträge stehen im ` +
        'Kontofilter und zeigen kein einziges Set',
    );

    // ── COUNTER-CHECK: the earlier INSERT ─────────────────────────────────────
    // It created the place for every writable account. Executed here,
    // the phantom entry must arise in the sub-account — and afterwards be gone again.
    await db.run(
      `INSERT INTO storage_locations (user_id, name)
       SELECT id, $2 FROM users WHERE id = ANY($1)
       ON CONFLICT (user_id, lower(name)) DO NOTHING`,
      [writable, 'Estrich'],
    );
    const kindNachAlt = (await L.locationsOf([KIND])).map(o => o.name);
    assert.deepEqual(
      kindNachAlt,
      ['Estrich'],
      'Die frühere Form legt im Unterkonto KEINEN Eintrag an — dann prüft diese ' +
        'Gegenprobe nicht mehr, was sie soll',
    );
    const belegt = await db.get(`SELECT COUNT(*)::int AS n FROM sets WHERE user_id = $1 AND storage_id IS NOT NULL`, [
      KIND,
    ]);
    assert.equal(belegt.n, 0, 'Das Unterkonto hält plötzlich ein Set mit Lagerort — die Lage ist nicht die gedachte');
    await db.run('DELETE FROM storage_locations WHERE user_id = $1', [KIND]);
  });

  await t.test('a place on a foreign set leaves no entry', async () => {
    // This property was had by the earlier path via a transaction with
    // rollback. It must stay, even though the rollback has gone away:
    // now it is asked beforehand who holds a row at all.
    const n = await L.setLocation('set', writable, ['99999-1'], 'Garage');
    assert.equal(n, 0, 'Ein Set, das niemand hält, darf keine Zeile treffen');
    for (const [wer, id] of [
      ['Hauptkonto', MAIN],
      ['Unterkonto', KIND],
    ]) {
      const locations = (await L.locationsOf([id])).map(o => o.name);
      assert.ok(
        !locations.includes('Garage'),
        `Der Vorrat des ${wer} hat „Garage" bekommen, obwohl kein Set getroffen wurde: ${locations}`,
      );
    }
  });

  await t.test('the sub-account gets its own entry as soon as it holds a row', async () => {
    // The flip side of finding 2: not „only the main account", but „whoever
    // holds the row". If the sub-account holds a copy, the place belongs there too
    // — and as an OWN row, because a shelf stands in one flat
    // (Migration 0020). …
    await holdsSet(db, KIND, SN, 1);
    const n = await L.setLocation('set', writable, [SN], 'Keller');
    assert.equal(n, 2, `${n} Zeilen getroffen, erwartet 2 (beide Konten halten das Set)`);
    for (const [wer, id] of [
      ['Hauptkonto', MAIN],
      ['Unterkonto', KIND],
    ]) {
      const locations = (await L.locationsOf([id])).map(o => o.name);
      assert.ok(locations.includes('Keller'), `Der Vorrat des ${wer} hat „Keller" nicht: ${locations}`);
    }
    // And the detail combines both instead of concealing one.
    await L.setLocation('set', [MAIN], [SN], 'Estrich');
    const detail = await S.readSet(writable, SN);
    assert.equal(
      detail.storage,
      'Estrich, Keller',
      `Das Detail zeigt ${JSON.stringify(detail.storage)} — bei zwei Besitzern in ` +
        'zwei Kisten muss es beide nennen, wie die Liste es tut',
    );
  });
});

/**
 * The storage location filter of the set list, checked via the ROUTE. Counter-check: `storage` removed from
 * the passing-on in routes/api_v1/sets.ts → red („2 Sets statt 1“); without a filter
 * both sets come (otherwise an empty list would pass too).
 */
test("the lists' storage location filter works via the route", async t => {
  try {
    await db.get('SELECT 1 AS ok');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await seed();

  const L = {
    ..._req('src/inventory/storageLocation.js'),
    ...require('./helpers/sources').testArea('inventory').locationService,
  };
  // A second set WITHOUT a storage location — without it the filter would have nothing
  // to sift out, and „all" would be indistinguishable from „the right ones".
  const OHNE = '21058-1';
  await catalogSet(db, OHNE, { name: 'Cheops' });
  await holdsSet(db, MAIN, OHNE, 1);
  await L.setLocation('set', [MAIN], [SN], 'Estrich');

  // A part in the same box and one without — for the parts list next to it.
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES
                  ('3001','Brick 2x4'), ('3002','Brick 2x3')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES
                  ('3001',4,'Rot'), ('3002',4,'Rot')
                ON CONFLICT (part_number, color_id) DO NOTHING`);
  await holdsPart(db, MAIN, '3001', { setNumber: SN, quantity: 2, colorId: 4 });
  await holdsPart(db, MAIN, '3002', { setNumber: OHNE, quantity: 2, colorId: 4 });
  // The keys are a FLAT list in the order of the CONDITION
  // (src/inventory/storageLocation.ts): for a part number AND color, i.e. two entries.
  await L.setLocation('part', [MAIN], ['3001', 4], 'Estrich');

  const { base } = testServer(_req, { sitzung: { userId: MAIN }, t });
  const hole = async path => {
    const r = await fetch(base + path);
    assert.equal(r.status, 200, `${path} antwortete ${r.status}`);
    return r.json();
  };

  await t.test('sets: without a filter both come', async () => {
    const d = await hole('/api/v2/sets?page=1&page_size=60');
    const nummern = (d.sets || []).map(s => s.set_number).sort();
    assert.deepEqual(
      nummern,
      [OHNE, SN].sort(),
      `Vorbedingung: beide Sets müssen ohne Filter kommen, bekam ${JSON.stringify(nummern)}`,
    );
  });

  await t.test('sets: with storage=Estrich ONLY the set in the box comes', async () => {
    const d = await hole(`/api/v2/sets?page=1&page_size=60&storage=${encodeURIComponent('Estrich')}`);
    const nummern = (d.sets || []).map(s => s.set_number);
    assert.deepEqual(
      nummern,
      [SN],
      `Erwartet nur ${SN}, bekam ${JSON.stringify(nummern)}. Kommen BEIDE, hat die ` +
        'Route den Parameter weggelassen — der Filter in setsLesen() ist in Ordnung, ' +
        'er bekommt ihn nur nie zu sehen.',
    );
    assert.equal(
      Number(d.total),
      1,
      `total sagt ${d.total} statt 1 — dann zählt die Gesamtzahl ungefiltert, und ` +
        'die Oberfläche blättert in Sets, die sie nicht zeigt',
    );
  });

  await t.test('sets: a place that does not exist delivers nothing', async () => {
    // The opposite direction: without it the case above would be green too if the
    // filter mapped every value to the same one set.
    const d = await hole('/api/v2/sets?page=1&page_size=60&storage=Dachboden');
    assert.deepEqual(
      (d.sets || []).map(s => s.set_number),
      [],
      'Ein unbekannter Lagerort muss eine leere Liste ergeben',
    );
  });

  await t.test('parts: the same filter, the same path', async () => {
    const alle = await hole('/api/v2/parts?page=1&page_size=60');
    const numbersAll = (alle.parts || []).map(p => p.part_number).sort();
    assert.deepEqual(
      numbersAll,
      ['3001', '3002'],
      `Vorbedingung: beide Teile ohne Filter, bekam ${JSON.stringify(numbersAll)}`,
    );

    const d = await hole(`/api/v2/parts?page=1&page_size=60&storage=${encodeURIComponent('Estrich')}`);
    assert.deepEqual(
      (d.parts || []).map(p => p.part_number),
      ['3001'],
      `Erwartet nur 3001, bekam ${JSON.stringify((d.parts || []).map(p => p.part_number))}`,
    );
  });
});
