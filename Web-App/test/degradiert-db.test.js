/**
 * Eine Antwort aus Ersatzwerten sagt das: `degradiert` nennt die Teile, die
 * nach einem Fehler nur eine 0 oder null tragen (src/infra/ergebnis.ts, Abstriche).
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in cacheStatistik() `...ab.angabe()` gestrichen → rot: „die Cache-Zahlen
 *      sagen, welcher Teil fehlt“ (degradiert undefined)
 *   B  in Abstriche.oder() den Eintrag in `teile` weggelassen → rot: beide Teiltests
 *   C  in updateSet() wieder `wertOder(versuche(…))` für den Kaufpreis → rot:
 *      „eine Mengenerhöhung ohne Marktpreis sagt es“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

let cacheKaputt = false,
  preisKaputt = false;
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
        k === 'resolveSetCondition'
          ? async (...a) => {
              if (preisKaputt) throw new Error('Zustand nicht lesbar');
              return t[k](...a);
            }
          : t[k],
    });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { haeltSet } = require('./helpers/bestand');

test('Ersatzwerte stehen in der Antwort', { concurrency: 1 }, async t => {
  const db = await dbOderSkip(t, _req);
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
    const { cacheStatistik } = _req('src/verwaltung/dienst.js');
    const heil = await cacheStatistik();
    assert.equal(heil.degradiert, undefined, 'ohne Fehler keine Angabe');
    cacheKaputt = true;
    try {
      const r = await cacheStatistik();
      assert.deepEqual(r.degradiert, ['cache']);
      assert.equal(r.prices, 0, 'der Ersatzwert bleibt — aber jetzt erkennbar');
      assert.equal(typeof r.price_stale, 'number');
    } finally {
      cacheKaputt = false;
    }
  });

  await t.test('eine Mengenerhöhung ohne Marktpreis sagt es', async () => {
    await haeltSet(db, uid, SN, 0);
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, purchase_price, condition, quantity)
                  VALUES ($1, $2, 10, 'N', 1)`,
      [uid, SN],
    );
    const { updateSet } = _req('src/sets/index.js');
    // Sets fragt den Zustand über die Finanzdienste seines Kontexts (sk.finanzen).
    const finanzen = _req('src/infra/bereich.js').prozessDienste().finanzen;
    const zustandEcht = finanzen.resolveSetCondition;
    finanzen.resolveSetCondition = async (...a) => {
      if (preisKaputt) throw new Error('Zustand nicht lesbar');
      return zustandEcht(...a);
    };
    t.after(() => {
      finanzen.resolveSetCondition = zustandEcht;
    });
    preisKaputt = true;
    let r;
    try {
      r = await updateSet(uid, SN, { quantity: 2 });
    } finally {
      preisKaputt = false;
    }
    assert.equal(r.quantity, 2, 'die Menge ist trotzdem geschrieben');
    assert.deepEqual(r.degradiert, ['kaufpreis']);
    const ohnePreis = await db.get(
      'SELECT COUNT(*)::int AS n FROM set_acquisitions WHERE user_id = $1 AND set_number = $2 AND purchase_price IS NULL',
      [uid, SN],
    );
    assert.equal(ohnePreis.n, 1, 'die neue Erfassung ohne Preis — der Nachtrag holt ihn');
    assert.equal((await updateSet(uid, SN, { quantity: 2 })).degradiert, undefined);
  });
});
