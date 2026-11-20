/**
 * Eine Antwort aus Ersatzwerten sagt das: `degradiert` nennt die Teile, die
 * nach einem Fehler nur eine 0 oder null tragen (src/infra/ergebnis.ts, Abstriche).
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in cacheStatistics() `...ab.angabe()` gestrichen → rot: „die Cache-Zahlen
 *      sagen, welcher Teil fehlt“ (degradiert undefined)
 *   B  in Abstriche.oder() den Eintrag in `teile` weggelassen → rot: beide Teiltests
 *   C  in changeSet() wieder `valueOr(versuche(…))` für den Kaufpreis → rot:
 *      „eine Mengenerhöhung ohne Marktpreis sagt es“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

let cacheKaputt = false,
  priceBroken = false;
const Module = require('node:module');
const _echt = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = _echt.call(this, name, ...rest);
  if (typeof name !== 'string') return m;
  if (/(?:katalog[/\\]|^\.\/)bricklinkPreise(\.js)?$/.test(name))
    return new Proxy(m, {
      get: (t, k) =>
        k === 'getCacheStats'
          ? async (...a) => {
              if (cacheKaputt) throw new Error('Cache nicht lesbar');
              return t[k](...a);
            }
          : t[k],
    });
  if (/(?:finanzen[/\\]|^\.\/)financeCalc(\.js)?$/.test(name))
    return new Proxy(m, {
      get: (t, k) =>
        k === 'setState'
          ? async (...a) => {
              if (priceBroken) throw new Error('Zustand nicht lesbar');
              return t[k](...a);
            }
          : t[k],
    });
  return m;
};

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/bestand');

test('Ersatzwerte stehen in der Antwort', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `degr-${process.pid}`,
    SN = `${60000 + (process.pid % 9000)}-1`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (await db.get("INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id", [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM set_acquisitions WHERE set_number = $1', [SN]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('die Cache-Zahlen sagen, welcher Teil fehlt', async () => {
    const { cacheStats: cacheStatistics } = _req('src/management/service.js');
    const heil = await cacheStatistics();
    assert.equal(heil.degradiert, undefined, 'ohne Fehler keine Angabe');
    cacheKaputt = true;
    try {
      const r = await cacheStatistics();
      assert.deepEqual(r.degradiert, ['cache']);
      assert.equal(r.prices, 0, 'der Ersatzwert bleibt — aber jetzt erkennbar');
      assert.equal(typeof r.price_stale, 'number');
    } finally {
      cacheKaputt = false;
    }
  });

  await t.test('eine Mengenerhöhung ohne Marktpreis sagt es', async () => {
    await holdsSet(db, uid, SN, 0);
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, purchase_price, condition, quantity)
                  VALUES ($1, $2, 10, 'N', 1)`,
      [uid, SN],
    );
    const { changeSet } = require('./helpers/sources').areaPage('sets');
    // Sets fragt den Zustand über die Finanzdienste seines Kontexts (sk.finances).
    const finanzen = require('./helpers/sources').testArea('finances');
    const stateReal = finanzen.setState;
    finanzen.setState = async (...a) => {
      if (priceBroken) throw new Error('Zustand nicht lesbar');
      return stateReal(...a);
    };
    t.after(() => {
      finanzen.setState = stateReal;
    });
    priceBroken = true;
    let r;
    try {
      r = await changeSet(uid, SN, { quantity: 2 });
    } finally {
      priceBroken = false;
    }
    assert.equal(r.quantity, 2, 'die Menge ist trotzdem geschrieben');
    assert.deepEqual(r.degradiert, ['kaufpreis']);
    const withoutPrice = await db.get(
      'SELECT COUNT(*)::int AS n FROM set_acquisitions WHERE user_id = $1 AND set_number = $2 AND purchase_price IS NULL',
      [uid, SN],
    );
    assert.equal(withoutPrice.n, 1, 'die neue Erfassung ohne Preis — der Nachtrag holt ihn');
    assert.equal((await changeSet(uid, SN, { quantity: 2 })).degradiert, undefined);
  });
});
