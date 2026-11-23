/**
 * The sets area gets database and catalog passed in (src/sets/area.ts):
 * its services take what the context gives them, not the access of the
 * process or the catalog of another wiring.
 *
 * Counter-checks (measured 10.11.2026, each on its own):
 *   A  in src/sets/repository/setDetail.ts setMaster() via `standardDb().get`
 *      instead of via the passed access → red: “reading goes through the
 *      passed access” (no query on rb_sets counted)
 *   B  in partListWithRework() again `nacharbeit().setTeileAnreichern(sn)` →
 *      red: “the enrichment comes from the context” (process follow-up called)
 *   C  (15.11.2026) there `sn => sk.katalog.enrichSetParts(sn)` replaced by `async () => {}`
 *      → red: “the enrichment comes from the context” (nothing triggered)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const sources = require('./helpers/sources');
const _req = sources.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

const SN = '99871-1';
const INVENTORY = 987654;

/** An access that records every query and passes it on to the real one. */
function countingAccess(original, sql) {
  const remember = f => (text, p) => {
    sql.push(text);
    return f(text, p);
  };
  const shell = z => ({ all: remember(z.all), get: remember(z.get), run: remember(z.run), exec: remember(z.exec) });
  return new Proxy(original, {
    get(target, name) {
      if (name === 'transaction') return (fn, o) => target.transaction(tx => fn(shell(tx)), o);
      if (['all', 'get', 'run', 'exec'].includes(String(name))) return shell(target)[name];
      return Reflect.get(target, name);
    },
  });
}

/** A catalog that records which enrichment was triggered. */
const recording = note => ({
  enrichSetParts: async sn => {
    note.push(['enrichSetParts', sn]);
  },
});

test('sets with their own context', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(async () => {
    await db.run('DELETE FROM rb_inventory_parts WHERE inventory_id = $1', [INVENTORY]);
    await db.run('DELETE FROM rb_inventories WHERE id = $1', [INVENTORY]);
    sources.buildAndRequire();
    await db.pool.end();
  });
  await db.run('DELETE FROM rb_inventory_parts WHERE inventory_id = $1', [INVENTORY]);
  await db.run('DELETE FROM rb_inventories WHERE id = $1', [INVENTORY]);
  await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1, $2, 1)', [INVENTORY, SN]);
  await db.run(
    `INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare)
                VALUES ($1, '3001', 0, 4, false)`,
    [INVENTORY],
  );

  const sql = [],
    note = [],
    processNote = [];
  const access = countingAccess(sources.testAccess(), sql);
  const { buildServices } = _req('startup/wiring.js');
  const all = buildServices(access);
  Object.assign(all.catalog, recording(note));
  const sets = all.sets;
  sources.replaceServices('catalog', recording(processNote));

  await t.test('reading goes through the passed access', async () => {
    assert.equal(await sets.setInfo(SN), null);
    assert.ok(
      sql.some(s => /LEFT JOIN rb_sets rs/.test(s)),
      `counted: ${sql.join(' | ').slice(0, 300)}`,
    );
  });

  await t.test('the enrichment comes from the context', async () => {
    const r = await sets.partListWithRework(SN);
    assert.equal(r.parts.length, 1);
    assert.ok(sql.some(s => /FROM rb_inventory_parts/.test(s)));
    assert.deepEqual(note, [['enrichSetParts', SN]]);
    assert.deepEqual(processNote, []);
  });
});
