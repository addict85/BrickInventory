/**
 * Der Bereich Sets bekommt Datenbank und Katalog übergeben (src/sets/bereich.ts):
 * Seine Dienste nehmen, was der Kontext ihnen gibt, nicht den Zugang des
 * Prozesses oder den Katalog einer anderen Verdrahtung.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln):
 *   A  in src/sets/repository/setDetail.ts setStamm() über `standardDb().get`
 *      statt über den übergebenen Zugang → rot: „Lesen geht über den
 *      übergebenen Zugang“ (keine Abfrage auf rb_sets gezählt)
 *   B  in partListWithRework() wieder `nacharbeit().setTeileAnreichern(sn)` →
 *      rot: „die Anreicherung kommt aus dem Kontext“ (Prozess-Nacharbeit gerufen)
 *   C  (15.11.2026) dort `sn => sk.katalog.enrichSetPartsAn(sn)` durch `async () => {}`
 *      ersetzt → rot: „die Anreicherung kommt aus dem Kontext“ (nichts angestossen)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

const SN = '99871-1';
const INVENTORY = 987654;

/** Ein Zugang, der jede Abfrage mitschreibt und an den echten weitergibt. */
function countingAccess(echt, sql) {
  const remember = f => (text, p) => {
    sql.push(text);
    return f(text, p);
  };
  const huelle = z => ({ all: remember(z.all), get: remember(z.get), run: remember(z.run), exec: remember(z.exec) });
  return new Proxy(echt, {
    get(ziel, name) {
      if (name === 'transaction') return (fn, o) => ziel.transaction(tx => fn(huelle(tx)), o);
      if (['all', 'get', 'run', 'exec'].includes(String(name))) return huelle(ziel)[name];
      return Reflect.get(ziel, name);
    },
  });
}

/** Ein Katalog, der mitschreibt, welche Anreicherung angestossen wurde. */
const recording = notiz => ({
  enrichSetPartsAn: async sn => {
    notiz.push(['enrichSetPartsAn', sn]);
  },
});

test('Sets mit eigenem Kontext', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(async () => {
    await db.run('DELETE FROM rb_inventory_parts WHERE inventory_id = $1', [INVENTORY]);
    await db.run('DELETE FROM rb_inventories WHERE id = $1', [INVENTORY]);
    quellen.buildAndRequire();
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
    notiz = [],
    processNote = [];
  const zugang = countingAccess(quellen.testAccess(), sql);
  const { buildServices } = _req('startup/verdrahtung.js');
  const alle = buildServices(zugang);
  Object.assign(alle.katalog, recording(notiz));
  const sets = alle.sets;
  quellen.replaceServices('katalog', recording(processNote));

  await t.test('Lesen geht über den übergebenen Zugang', async () => {
    assert.equal(await sets.setInfo(SN), null);
    assert.ok(
      sql.some(s => /LEFT JOIN rb_sets rs/.test(s)),
      `gezählt: ${sql.join(' | ').slice(0, 300)}`,
    );
  });

  await t.test('die Anreicherung kommt aus dem Kontext', async () => {
    const r = await sets.partListWithRework(SN);
    assert.equal(r.parts.length, 1);
    assert.ok(sql.some(s => /FROM rb_inventory_parts/.test(s)));
    assert.deepEqual(notiz, [['enrichSetPartsAn', SN]]);
    assert.deepEqual(processNote, []);
  });
});
