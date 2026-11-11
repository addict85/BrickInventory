/**
 * Die Figurenschätzung und der Setpreis, ausgeführt statt am Quelltext gelesen:
 * Die Schätzung legt je Zustand einen eigenen Eintrag in Cache und Verlauf ab,
 * und ein ausdrücklich angefragter Zustand hat beim Setpreis Vorrang.
 * Die Teile der Figur und ihre Preise liegen im Cache — kein Abruf übers Netz.
 *
 * Gegenproben (31.10.2026, gemessen):
 *   a) in src/finanzen/repository/marktpreise.ts beim Schreiben der Schätzung
 *      `condition` durch 'N' ersetzt → Teil 1 rot (der Eintrag „U" fehlt).
 *   b) in schaetzeFigurenpreis() fetchPartPrice mit DEFAULT_PRICE_CONDITION statt
 *      `cond` → Teil 1 rot (beide Zustände 2 × 3 = 6, nicht 4 und 6).
 *   c) merkeGeschaetztenFigurenverlauf() nicht aufgerufen → Teil 1 rot (Verlauf leer).
 *   d) in setPreisAusCache() `ORDER BY (condition = $2) DESC` → `ASC` → Teil 2 rot.
 *   e) in getCurrentMarketPrice() die Wache `if (!condition)` entfernt → Teil 2 rot
 *      (die Erfassung „Neu“ überstimmt den angefragten Zustand: 10 statt 20).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { keineDb } = require('./helpers/db');

test('Figurenschätzung und Setpreis je Zustand', async (t) => {
  const db = _req('db/database.js');
  try { await db.initSchemaOnce(); }
  catch (e) {
    keineDb(t, e); return;
  }
  const mf = _req('src/finanzen/marketPrice.js');
  const fc = _req('src/finanzen/financeCalc.js');
  const u = await db.get(`INSERT INTO users (username, password_hash) VALUES ('schaetz_'||floor(random()*1e9),'x') RETURNING id`);
  const FIG = 'fig-ablage-01';
  try {
    await t.test('je Zustand ein Eintrag in Cache und Verlauf', async () => {
      await db.run('INSERT INTO minifig_parts_cache (fig_number, data) VALUES ($1, $2)', [FIG,
        JSON.stringify([{ part_num: 'abl-1', bl_part_num: 'abl-1', color_id: 5, quantity: 2 }])]);
      const farbe = Number(await fc.resolveBlColorId(5)) || 0;
      for (const [zustand, preis] of [['N', 2], ['U', 3]])
        await db.run(`INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price, qty_avg_price)
                      VALUES ('abl-1', $1, $2, 'EUR', $3, $3)`, [farbe, zustand, preis]);

      assert.deepEqual(await mf.schaetzeFigurenpreis(FIG, u.id, 'N'), { preis: 4, abdeckung: 1 });
      assert.deepEqual(await mf.schaetzeFigurenpreis(FIG, u.id, 'U'), { preis: 6, abdeckung: 1 });
      const cache = await db.all(`SELECT condition, avg_price::float AS preis, geschaetzt FROM minifig_price_cache
                                   WHERE fig_number = $1 ORDER BY condition`, [FIG]);
      assert.deepEqual(cache, [{ condition: 'N', preis: 4, geschaetzt: true }, { condition: 'U', preis: 6, geschaetzt: true }]);
      const verlauf = await db.all(`SELECT condition, avg_price::float AS preis FROM minifig_price_history
                                     WHERE fig_number = $1 AND geschaetzt ORDER BY condition`, [FIG]);
      assert.deepEqual(verlauf, [{ condition: 'N', preis: 4 }, { condition: 'U', preis: 6 }]);
    });

    await t.test('ein angefragter Zustand schlägt den anderen', async () => {
      const SN = 'abl-77-1';
      await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, avg_price) VALUES
                    ($1, 'N', 'EUR', 10), ($1, 'U', 'EUR', 20)`, [SN]);
      // Eine Neu-Erfassung: Ohne Wunsch bewertet die Erfassung mit dem Neupreis.
      await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2)', [u.id, SN]);
      await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, condition, currency)
                    VALUES ($1, $2, 1, 'N', 'EUR')`, [u.id, SN]);
      assert.equal(await mf.getCurrentMarketPrice(SN, u.id), 10);
      assert.equal(await mf.getCurrentMarketPrice(SN, u.id, 'U'), 20);
      assert.equal(await mf.getCurrentMarketPrice(SN, u.id, 'N'), 10);
      await db.run(`DELETE FROM price_cache WHERE set_number = $1 AND condition = 'U'`, [SN]);
      assert.equal(await mf.getCurrentMarketPrice(SN, u.id, 'U'), 10, 'ohne Preis im Wunschzustand der andere');
    });
  } finally {
    await db.run('DELETE FROM users WHERE id = $1', [u.id]);
    await db.pool.end();
  }
});
