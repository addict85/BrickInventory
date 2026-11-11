/**
 * Der Bereich Sets bekommt Datenbank und Nacharbeit übergeben (src/sets/bereich.ts):
 * Seine Dienste nehmen, was der Kontext ihnen gibt, nicht den Zugang des
 * Prozesses. Ohne Verdrahtung werfen sets() und nacharbeit(), statt still
 * auf den Prozesszugang zu fallen oder nichts zu tun.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln):
 *   A  in src/sets/repository/setDetail.ts setStamm() über `standardDb().get`
 *      statt über den übergebenen Zugang → rot: „Lesen geht über den
 *      übergebenen Zugang“ (keine Abfrage auf rb_sets gezählt)
 *   B  in teilelisteMitNacharbeit() wieder `nacharbeit().setTeileAnreichern(sn)` →
 *      rot: „die Nacharbeit kommt aus dem Kontext“ (Prozess-Nacharbeit gerufen)
 *   C  nacharbeit() liefert ohne Verdrahtung wieder OHNE_NACHARBEIT → rot:
 *      „ohne Verdrahtung werfen nacharbeit() und sets()“
 *   D  sets() baut ohne Verdrahtung erzeugeSets({ db: standardDb(), … }) → rot:
 *      dieselbe Prüfung
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { erzeugeSets } = _req('src/sets/bereich.js');
const S = _req('src/sets/index.js');
const N = _req('src/auftraege/nacharbeit.js');

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

/** Schreibt mit, welche Nacharbeit angestossen wurde. */
function aufzeichnendeNacharbeit(notiz) {
  const n = {};
  for (const name of Object.keys(N.OHNE_NACHARBEIT))
    n[name] = async (...a) => {
      notiz.push([name, ...a]);
    };
  return n;
}

test('Sets mit eigenem Kontext', { concurrency: 1 }, async t => {
  const db = await dbOderSkip(t, _req);
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
  const sets = erzeugeSets({ db: zaehlenderZugang(db.standardDb(), sql), nacharbeit: aufzeichnendeNacharbeit(notiz) });
  N.verdrahteNacharbeit(aufzeichnendeNacharbeit(prozessNotiz));

  await t.test('Lesen geht über den übergebenen Zugang', async () => {
    assert.equal(await sets.setInfo(SN), null);
    assert.ok(
      sql.some(s => /LEFT JOIN rb_sets rs/.test(s)),
      `gezählt: ${sql.join(' | ').slice(0, 300)}`,
    );
  });

  await t.test('die Nacharbeit kommt aus dem Kontext', async () => {
    const r = await sets.teilelisteMitNacharbeit(SN);
    assert.equal(r.parts.length, 1);
    assert.ok(sql.some(s => /FROM rb_inventory_parts/.test(s)));
    assert.deepEqual(notiz, [['setTeileAnreichern', SN]]);
    assert.deepEqual(prozessNotiz, []);
  });

  await t.test('ohne Verdrahtung werfen nacharbeit() und sets()', () => {
    N.verdrahteNacharbeit(null);
    S.verdrahteSets(null);
    assert.throws(() => N.nacharbeit(), /nicht verdrahtet/);
    assert.throws(() => S.setInfo(SN), /nicht verdrahtet/);
  });
});
