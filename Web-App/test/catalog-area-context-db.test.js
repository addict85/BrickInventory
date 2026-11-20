/**
 * Der Bereich Katalog bekommt seinen Datenbankzugang übergeben (src/catalog/area.ts,
 * gebaut von buildServices in startup/wiring.ts): Lesen, Schreiben und
 * Transaktionen der Dienste gehen über diesen Zugang. Einen Prozess-Speicher, auf
 * den sie fallen könnten, gibt es nicht mehr (Verbot in test/ratschen.test.js).
 *
 * Gegenproben (A, B am 10.11.2026 gemessen, je einzeln; C am 14.11.2026):
 *   A  in src/catalog/rbInventory.ts newestInventory() über das Repository mit
 *      standardDb() statt über den Kontext → rot: „Lesen geht über den übergebenen
 *      Zugang“ (gezählt: nichts)
 *   B  in src/externalSources/apiQuota.ts (damals src/catalog/) die Transaktion über standardDb() → rot:
 *      „die Transaktion geht über den übergebenen Zugang“
 *   C  in buildAreas (startup/wiring.ts) createCatalog mit { db: testAccess() }
 *      statt db → rot: „Lesen geht …“ (gezählt: nichts); das Kontingent zählen seit
 *      15.11.2026 die Fremdquellen selbst (kein Durchreichen im Katalog).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { buildServices } = _req('startup/wiring.js');

const SN = '99872-1';
const INVENTORY = 987655;

/** Ein Zugang, der jede Abfrage mitschreibt und an den echten weitergibt. */
function countingAccess(echt, sql) {
  const remember = f => (text, p) => {
    sql.push(text);
    return f(text, p);
  };
  const huelle = z => ({ all: remember(z.all), get: remember(z.get), run: remember(z.run), exec: remember(z.exec) });
  return new Proxy(echt, {
    get(ziel, name) {
      // Der Griff trägt seinen Zugang (tx.db), über den t entsteht: Auch er zählt mit.
      if (name === 'transaction')
        return (fn, o) => ziel.transaction(tx => fn({ ...huelle(tx), db: countingAccess(tx.db, sql) }), o);
      if (['all', 'get', 'run', 'exec'].includes(String(name))) return huelle(ziel)[name];
      return Reflect.get(ziel, name);
    },
  });
}

test('catalog with its own access', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const weg = async () => {
    await db.run('DELETE FROM rb_inventories WHERE id = $1', [INVENTORY]);
    await quellen.testServices().externalSources.setQuotaBack('brickset');
  };
  t.after(async () => {
    quellen.buildAndRequire();
    await weg();
    await db.pool.end();
  });
  await weg();
  await db.run('INSERT INTO rb_inventories (id, set_num, version) VALUES ($1, $2, 1)', [INVENTORY, SN]);

  const sql = [];
  const contexts = {};
  const { catalog: katalog } = buildServices(countingAccess(quellen.testAccess(), sql), { contexts });

  await t.test('reading goes via the passed access', async () => {
    assert.equal(await katalog.newestInventory(SN), INVENTORY);
    assert.ok(
      sql.some(s => /FROM rb_inventories/.test(s)),
      `gezählt: ${sql.join(' | ').slice(0, 300)}`,
    );
  });

  await t.test('the transaction goes via the passed access', async () => {
    sql.length = 0;
    const { kontingentPruefenUndZaehlen } = require(
      require('node:path').join(require('./helpers/sources').ROOT, 'dist/src/externalSources/apiQuota.js'),
    );
    const r = await kontingentPruefenUndZaehlen(contexts.externalSources, 'brickset');
    assert.equal(r.allowed, true);
    assert.ok(
      sql.some(s => /INSERT INTO api_calls/.test(s)),
      `gezählt: ${sql.join(' | ').slice(0, 300)}`,
    );
  });
});
