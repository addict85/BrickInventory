/**
 * Der Bereich Sets bekommt Datenbank und Katalog übergeben (src/sets/bereich.ts):
 * Seine Dienste nehmen, was der Kontext ihnen gibt, nicht den Zugang des
 * Prozesses oder den Katalog einer anderen Verdrahtung.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln):
 *   A  in src/sets/repository/setDetail.ts setStamm() über `standardDb().get`
 *      statt über den übergebenen Zugang → rot: „Lesen geht über den
 *      übergebenen Zugang“ (keine Abfrage auf rb_sets gezählt)
 *   B  in teilelisteMitNacharbeit() wieder `nacharbeit().setTeileAnreichern(sn)` →
 *      rot: „die Anreicherung kommt aus dem Kontext“ (Prozess-Nacharbeit gerufen)
 *   C  (15.11.2026) dort `sn => sk.katalog.enrichSetParts(sn)` durch `async () => {}`
 *      ersetzt → rot: „die Anreicherung kommt aus dem Kontext“ (nichts angestossen)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { datenOderSkip } = require('./helpers/db');

const SN = '99871-1';
const INVENTAR = 987654;

/** Ein Zugang, der jede Abfrage mitschreibt und an den echten weitergibt. */
function zaehlenderZugang(echt, sql) {
  const merke = f => (text, p) => {
    sql.push(text);
    return f(text, p);
  };
  const huelle = z => ({ all: merke(z.all), get: merke(z.get), run: merke(z.run), exec: merke(z.exec) });
  return new Proxy(echt, {
    get(ziel, name) {
      if (name === 'transaction') return (fn, o) => ziel.transaction(tx => fn(huelle(tx)), o);
      if (['all', 'get', 'run', 'exec'].includes(String(name))) return huelle(ziel)[name];
      return Reflect.get(ziel, name);
    },
  });
}

/** Ein Katalog, der mitschreibt, welche Anreicherung angestossen wurde. */
const aufzeichnend = notiz => ({
  enrichSetParts: async sn => {
    notiz.push(['enrichSetParts', sn]);
  },
});

test('Sets mit eigenem Kontext', { concurrency: 1 }, async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  t.after(async () => {
    await db.run('DELETE FROM rb_inventory_parts WHERE inventory_id = $1', [INVENTAR]);
    await db.run('DELETE FROM rb_inventories WHERE id = $1', [INVENTAR]);
    quellen.buildAndRequire();
    await db.pool.end();
  });
  await db.run('DELETE FROM rb_inventory_parts WHERE inventory_id = $1', [INVENTAR]);
  await db.run('DELETE FROM rb_inventories WHERE id = $1', [INVENTAR]);
  await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1, $2, 1)', [INVENTAR, SN]);
  await db.run(
    `INSERT INTO rb_inventory_parts (inventory_id, part_num, color_id, quantity, is_spare)
                VALUES ($1, '3001', 0, 4, false)`,
    [INVENTAR],
  );

  const sql = [],
    notiz = [],
    prozessNotiz = [];
  const zugang = zaehlenderZugang(quellen.testZugang(), sql);
  const { baueDienste } = _req('startup/verdrahtung.js');
  const alle = baueDienste(zugang);
  Object.assign(alle.katalog, aufzeichnend(notiz));
  const sets = alle.sets;
  quellen.ersetzeDienste('katalog', aufzeichnend(prozessNotiz));

  await t.test('Lesen geht über den übergebenen Zugang', async () => {
    assert.equal(await sets.setInfo(SN), null);
    assert.ok(
      sql.some(s => /LEFT JOIN rb_sets rs/.test(s)),
      `gezählt: ${sql.join(' | ').slice(0, 300)}`,
    );
  });

  await t.test('die Anreicherung kommt aus dem Kontext', async () => {
    const r = await sets.teilelisteMitNacharbeit(SN);
    assert.equal(r.parts.length, 1);
    assert.ok(sql.some(s => /FROM rb_inventory_parts/.test(s)));
    assert.deepEqual(notiz, [['enrichSetParts', SN]]);
    assert.deepEqual(prozessNotiz, []);
  });
});
