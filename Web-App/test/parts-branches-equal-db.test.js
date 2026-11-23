/**
 * The parts list has TWO paths — they must deliver the same types.
 *
 * Counter-check: the summary branch in src/parts/queries.ts delivers color_name as an array → red “both paths of the parts list deliver the same types”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { environment, testData } = require('./helpers/sources');
const assert = require('node:assert/strict');
const { holdsSet, holdsPart } = require('./helpers/inventory');

const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

let db,
  H,
  PS,
  skip = null;
try {
  const _req = require('./helpers/sources').buildAndRequire();
  process.env.DATABASE_URL = DB_URL;
  environment({ SESSION_SECRET: 'test' });
  db = testData();
  H = require('./helpers/sources').handlerModule(_req);
  PS = _req('src/parts/summary.js');
} catch (e) {
  skip = e.message;
}

const U = 990601;

test('both paths of the parts list deliver the same types', async t => {
  if (skip) return t.skip(skip);
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('no test database reachable');
  }

  const cleanUp = async () => {
    for (const tab of ['parts', 'sets', 'parts_summary', 'parts_summary_state'])
      await db.run(`DELETE FROM ${tab} WHERE user_id=$1`, [U]).catch(() => {});
    // The catalog rows hang on no account and would otherwise remain.
    await db.run(`DELETE FROM set_parts WHERE set_number='Z-1'`).catch(() => {});
  };

  try {
    await cleanUp();
    await db.run("INSERT INTO users (id,username,password_hash) VALUES ($1,'zweige','x') ON CONFLICT (id) DO NOTHING", [
      U,
    ]);
    await holdsSet(db, U, 'Z-1', 1);
    // A spare part AND an ordinary one: if only one were included, a
    // branch could be right by chance without doing the conversion.
    // Since migration 0034 the spare part flag stands in
    // set_parts_catalog — it belongs to the PARTS LIST of a set, not to the …
    await db.run(`INSERT INTO set_parts (set_number,part_number,color_id,quantity,is_spare)
                  VALUES ('Z-1','3001',5,3,false),
                         ('Z-1','3002',1,1,true)
                  ON CONFLICT (set_number,part_number,color_id) DO UPDATE SET is_spare=EXCLUDED.is_spare`);
    // Name and color label: the type check below compares them between
    // the two branches, so they must be filled.
    await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3001','Brick'),('3002','Plate')
                  ON CONFLICT (part_number) DO NOTHING`);
    await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                  VALUES ('3001',5,'Rot'),('3002',1,'Blau')
                  ON CONFLICT (part_number,color_id) DO NOTHING`);
    await holdsPart(db, U, '3001', { setNumber: 'Z-1', quantity: 3, colorId: 5 });
    await holdsPart(db, U, '3002', { setNumber: 'Z-1', quantity: 1, colorId: 1 });

    const query = { exclude_manual: '1', page: 1, page_size: 50 };

    // ── Path 1: the live query (no summary yet) ───────────────
    const live = await H.partsQuery(U, query);
    assert.equal(live.source, 'db', 'without a summary the live query must answer');

    // ── Path 2: the summary ─────────────────────────────────────────
    await PS.rebuildNow(U);
    const summary = await H.partsQuery(U, query);
    assert.equal(summary.source, 'summary', 'after building, the summary must answer');

    // ── The rule: same fields, same types ───────────────────────────
    const kind = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    const nach = list => new Map(list.map(p => [`${p.part_number}|${p.color_id}`, p]));
    const a = nach(live.parts),
      b = nach(summary.parts);

    assert.ok(a.size > 0, 'the live query returned no parts — then the comparison checks nothing');
    assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort(), 'both paths must return the same parts');

    const deviations = [];
    for (const [key, links] of a) {
      const right = b.get(key);
      for (const field of Object.keys(links)) {
        if (!(field in right)) continue; // only fields that BOTH carry
        // null on one side is not a type conflict: a field may be empty.
        if (links[field] === null || right[field] === null) continue;
        if (kind(links[field]) !== kind(right[field]))
          deviations.push(
            `${key} ${field}: live=${kind(links[field])} (${JSON.stringify(links[field])}), ` +
              `Zusammenfassung=${kind(right[field])} (${JSON.stringify(right[field])})`,
          );
      }
    }
    assert.deepEqual(
      deviations,
      [],
      'The JSON type of a field must not depend on which branch answers — ' +
        'a client expecting one type otherwise fails exactly when the ' +
        'summary is fresh for the first time:\n  ' +
        deviations.join('\n  '),
    );

    // ── And is_spare in particular ─────────────────────────────────────────
    // The rule above would also be fulfilled if BOTH paths delivered a number —
    // the Android app would still need a boolean then.
    for (const [name, list] of [
      ['Live-Abfrage', live.parts],
      ['Zusammenfassung', summary.parts],
    ])
      for (const p of list)
        assert.equal(
          typeof p.is_spare,
          'boolean',
          `${name}: is_spare is ${typeof p.is_spare} (${JSON.stringify(p.is_spare)}) instead of boolean — ` +
            "exactly that is where the app's parts list failed",
        );

    // And the value is right too: 3002 is the spare part.
    assert.equal(b.get('3002|1').is_spare, true, 'the spare part must come out as true');
    assert.equal(b.get('3001|5').is_spare, false, 'the ordinary part must come out as false');
  } finally {
    await cleanUp();
    await db.run('DELETE FROM users WHERE id=$1', [U]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
