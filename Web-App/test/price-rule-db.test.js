/**
 * The rule „has a price" applies the same at EVERY place.
 *
 * Counter-checks (carried out):
 *   a) (13.11.2026) in fromRow() (src/finances/calculation/prices.ts) avg_price raw again
 *      instead of marketPriceFrom() → substep 2 red: avg_price 0 next to qty_avg_price 12.34,
 *      the clients showed „0.00“.
 *   b) in fetchPrice the cache hit set back to `parseFloat(avg_price) > 0`
 *      → substep 1 stays green (the rule is the same), but
 *      substep 3 turns red: the rule then stands there twice again.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { hasPrice } = _req('src/catalog/bricklinkPrices.js');

test('the price rule applies the same everywhere', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const SN = `preisregel-${process.pid}-1`;
  const aufraeumen = () => db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]).catch(() => {});
  await aufraeumen();

  try {
    // 1. The rule itself — four cases, one per corner.
    assert.equal(hasPrice({ avg_price: 12.34, qty_avg_price: 0 }), true);
    assert.equal(
      hasPrice({ avg_price: 0, qty_avg_price: 12.34 }),
      true,
      'Der Mengenschnitt ist der Rückfall: 0 ist kein Preis, 12.34 schon',
    );
    assert.equal(hasPrice({ avg_price: null, qty_avg_price: null }), false);
    assert.equal(hasPrice(null), false, 'kein Datensatz, kein Preis');
    // Depending on the path numeric comes as text — the rule must tolerate both.
    assert.equal(hasPrice({ avg_price: '12.34' }), true);
    assert.equal(
      hasPrice({ avg_price: '0.00' }),
      false,
      '"0.00" ist als Zeichenkette wahr — genau daran ist die Regel schon ' + 'einmal gescheitert',
    );

    // 2. The reader hands out no row that it does not itself recognize as a
    //    price. Otherwise the app would show „0.00" instead of „—".
    await db.run(
      `INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
       VALUES ($1,'N','EUR',10,0,20,12.34,5,NOW())`,
      [SN],
    );
    const { fetchPrice } = _req('src/finances/financeCalc.js');
    const pd = await fetchPrice(SN, 'N', 'sold', 'EUR', '24');
    assert.equal(pd.avg_price, 12.34, 'avg_price trägt den Marktpreis, hier den Mengenschnitt');
    assert.ok(
      pd.no_price === true || Number(pd.avg_price) > 0,
      'fetchPrice gibt eine Zeile heraus, die keinen anzeigbaren Preis trägt: ' + JSON.stringify(pd),
    );
    assert.ok(
      !(Number(pd.avg_price) === 0 && Number(pd.qty_avg_price) > 0),
      'avg_price = 0 neben qty_avg_price > 0 — genau die Form, die in der App ' +
        'als „0.00" erscheint: ' +
        JSON.stringify(pd),
    );

    // 3. A 0 entry blocks the refetch only SHORT.
    //
    // Counter-check that stayed green.
    for (const [alter, expectedFromCache] of [
      [0, true],
      [12, false],
    ]) {
      const S2 = `${SN}-alter${alter}`;
      await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [S2]).catch(() => {});
      await db.run(
        `INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
         VALUES ($1,'N','EUR',0,0,0,0,0, NOW() - make_interval(hours => $2))`,
        [S2, alter],
      );
      let erg;
      // If the entry falls through, fetchPrice tries a live fetch. Without
      // BrickLink access that one throws — and exactly that is the proof here that
      // the answer did NOT come from the cache.
      try {
        erg = await fetchPrice(S2, 'N', 'sold', 'EUR', '24');
      } catch (e) {
        erg = { attemptedFetch: true, message: e.message };
      }
      await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [S2]).catch(() => {});
      if (expectedFromCache) {
        assert.equal(
          erg.from_cache,
          true,
          'Ein FRISCHER 0-Eintrag muss aus dem Cache beantwortet werden — sonst ' +
            'fragt jede Ansicht eines preislosen Sets BrickLink erneut',
        );
        assert.equal(erg.no_price, true);
      } else {
        assert.notEqual(
          erg.from_cache,
          true,
          'Ein ALTER 0-Eintrag muss durchfallen und einen Neuabruf auslösen — ' +
            'sonst bleibt ein einmal preisloses Set dauerhaft preislos, und der ' +
            'sold→stock-Rückfall kommt nie zum Zug. Bekommen: ' +
            JSON.stringify(erg),
        );
      }
    }

    // 4. The quantity-weighted average is the quantity-weighted average.
    const PN = `probe-teil-${process.pid}`;
    await db.run(`DELETE FROM part_price_cache WHERE part_number=$1`, [PN]).catch(() => {});
    await db.run(
      `INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
       VALUES ($1,0,'N','EUR',5,7,NOW())`,
      [PN],
    );
    const { fetchPartPrice } = _req('src/finances/financeCalc.js');
    const teil = await fetchPartPrice(PN, 0, 'N', 'EUR', '24');
    await db.run(`DELETE FROM part_price_cache WHERE part_number=$1`, [PN]).catch(() => {});
    assert.equal(Number(teil.avg_price), 5);
    assert.equal(
      Number(teil.qty_avg_price),
      7,
      'qty_avg_price kommt aus avg_price statt aus der eigenen Spalte — der ' +
        'mengengewichtete Schnitt ist dann still der einfache. Bekommen: ' +
        JSON.stringify(teil),
    );

    // 5. And the rule stands at only ONE place. A second version would be
    //    exactly the state from which the error arose.
    const fs = require('node:fs');
    const path = require('node:path');
    const ROOT = path.join(__dirname, '..');
    for (const rel of ['src/finances/financeCalc.ts', 'clients/bricklink.ts']) {
      const src = fs
        .readFileSync(path.join(ROOT, rel), 'utf8')
        .split('\n')
        .filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*'))
        .join('\n');
      // Both notations. The first version of this rule only checked the
      // parseFloat form — and thereby overlooked five places that simply
      // wrote `pd.avg_price > 0`. That was not noticed through the rule
      // but through a search for verbatim repeated conditions. …
      assert.doesNotMatch(
        src,
        /(?:parseFloat\([^)]*avg_price[^)]*\)|[\w?.]*\.avg_price)\s*(?:>|<|===|==)\s*0/,
        `${rel} prüft den Preis wieder selbst statt über hatPrice() — und dann ` +
          'können die Fassungen erneut auseinanderlaufen',
      );
      // And the second operand of such a check must not be the same
      // as the first. Exactly that stood here eight times (`avg > 0 || avg > 0`) and
      // twice as `qty_avg_price: parseFloat(x.avg_price)`.
      assert.doesNotMatch(
        src,
        /(\w+)\.avg_price\)?[^\n]{0,20}\|\|[^\n]{0,20}\1\.avg_price/,
        `${rel} prüft zweimal denselben Wert — gemeint war sicher qty_avg_price`,
      );
      assert.doesNotMatch(
        src,
        /qty_avg_price:\s*parseFloat\((\w+)\.avg_price\)/,
        `${rel} füllt qty_avg_price aus avg_price — der mengengewichtete Schnitt ` + 'ist dann still der einfache',
      );
    }
  } finally {
    await aufraeumen();
    await db.pool.end().catch(() => {});
  }
});
