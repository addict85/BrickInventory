/**
 * Der Bereich Katalog bekommt seinen Datenbankzugang übergeben (src/katalog/bereich.ts,
 * verdrahtet in startup/verdrahtung.ts): Lesen, Schreiben und Transaktionen der
 * Dienste gehen über diesen Zugang. Ohne Verdrahtung wirft katalog(), statt still
 * auf den Prozesszugang zu fallen.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln):
 *   A  in src/katalog/rbInventar.ts neuestesInventar() über das Repository mit
 *      standardDb() statt über katalog() → rot: „Lesen geht über den übergebenen
 *      Zugang“ (gezählt: nichts) und „ohne Verdrahtung wirft katalog()“
 *   B  in src/katalog/apiKontingent.ts die Transaktion über standardDb() → rot:
 *      „die Transaktion geht über den übergebenen Zugang“
 *   C  in startup/verdrahtung.ts verdrahte() ohne verdrahteKatalog(…) → rot:
 *      „Lesen geht …“ und „die Transaktion geht …“ (gezählt: nichts)
 *   D  katalog() baut ohne Verdrahtung erzeugeKatalog({ db: standardDb() }) → rot:
 *      „ohne Verdrahtung wirft katalog()“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { verdrahte } = _req('startup/verdrahtung.js');
const { OHNE_NACHARBEIT } = _req('src/auftraege/nacharbeit.js');
const K = _req('src/katalog/prozess.js');
const { neuestesInventar } = _req('src/katalog/rbInventar.js');
const kontingent = _req('src/katalog/apiKontingent.js');

const SN = '99872-1';
const INVENTAR = 987655;

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

test('Katalog mit eigenem Zugang', { concurrency: 1 }, async t => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  const weg = async () => {
    await db.run('DELETE FROM rb_inventories WHERE id = $1', [INVENTAR]);
    await kontingent.setzeKontingentZurueck('brickset');
  };
  t.after(async () => {
    quellen.buildAndRequire();
    await weg();
    await db.pool.end();
  });
  await weg();
  await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1, $2, 1)', [INVENTAR, SN]);

  const sql = [];
  verdrahte({ nacharbeit: OHNE_NACHARBEIT, erststart: async () => {} }, zaehlenderZugang(db.standardDb(), sql));

  await t.test('Lesen geht über den übergebenen Zugang', async () => {
    assert.equal(await neuestesInventar(SN), INVENTAR);
    assert.ok(
      sql.some(s => /FROM rb_inventories/.test(s)),
      `gezählt: ${sql.join(' | ').slice(0, 300)}`,
    );
  });

  await t.test('die Transaktion geht über den übergebenen Zugang', async () => {
    sql.length = 0;
    const r = await kontingent.checkAndIncrementRateLimit('brickset');
    assert.equal(r.allowed, true);
    assert.ok(
      sql.some(s => /INSERT INTO api_aufrufe/.test(s)),
      `gezählt: ${sql.join(' | ').slice(0, 300)}`,
    );
  });

  await t.test('ohne Verdrahtung wirft katalog()', async () => {
    K.verdrahteKatalog(null);
    assert.throws(() => K.katalog(), /nicht verdrahtet/);
    await assert.rejects(neuestesInventar(SN), /nicht verdrahtet/);
  });
});
