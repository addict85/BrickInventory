/**
 * Die Regel „hat einen Preis" gilt an JEDER Stelle gleich.
 *
 * Gegenproben (durchgeführt):
 *   a) hatPreis() auf „avg > 0 || qty_avg > 0" geweitet → Teilschritt 2 rot:
 *      Der Leser gibt dann eine Zeile mit avg_price = 0 heraus, und die
 *      Clients zeigen „0.00" statt eines Preises.
 *   b) In fetchPrice den Cache-Treffer wieder auf `parseFloat(avg_price) > 0`
 *      gestellt → Teilschritt 1 bleibt grün (die Regel ist dieselbe), aber
 *      Teilschritt 3 wird rot: Die Regel steht dann wieder zweimal da.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const { hatPreis } = _req('src/katalog/bricklinkPreise.js');

test('die Preisregel gilt an jeder Stelle gleich', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req, { migrieren: false }))) return;

  const SN = `preisregel-${process.pid}-1`;
  const aufraeumen = () => db.run(`DELETE FROM price_cache WHERE set_number=$1`, [SN]).catch(() => {});
  await aufraeumen();

  try {
    // 1. Die Regel selbst — vier Fälle, einer je Ecke.
    assert.equal(hatPreis({ avg_price: 12.34, qty_avg_price: 0 }), true);
    assert.equal(
      hatPreis({ avg_price: 0, qty_avg_price: 12.34 }),
      false,
      'Ein Datensatz ohne avg_price hat keinen anzeigbaren Preis — die Clients ' +
        'lesen genau dieses Feld, und 0 ist nicht null',
    );
    assert.equal(hatPreis({ avg_price: null, qty_avg_price: null }), false);
    assert.equal(hatPreis(null), false, 'kein Datensatz, kein Preis');
    // numeric kommt je nach Weg als Text — die Regel muss beides vertragen.
    assert.equal(hatPreis({ avg_price: '12.34' }), true);
    assert.equal(
      hatPreis({ avg_price: '0.00' }),
      false,
      '"0.00" ist als Zeichenkette wahr — genau daran ist die Regel schon ' + 'einmal gescheitert',
    );

    // 2. Der Leser gibt keine Zeile heraus, die er selbst nicht als Preis
    //    anerkennt. Sonst stünde in der App „0.00" statt „—".
    await db.run(
      `INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
       VALUES ($1,'N','EUR',10,0,20,12.34,5,NOW())`,
      [SN],
    );
    const { fetchPrice } = _req('src/finanzen/financeCalc.js');
    const pd = await fetchPrice(SN, 'N', 'sold', 'EUR', '24');
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

    // 3. Ein 0-Eintrag blockiert den Neuabruf nur KURZ.
    //
    // Gegenprobe, die grün blieb.
    for (const [alter, erwartetAusCache] of [
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
      // Faellt der Eintrag durch, versucht fetchPrice einen Live-Abruf. Ohne
      // BrickLink-Zugang wirft der — und genau das ist hier der Beleg, dass
      // NICHT aus dem Cache geantwortet wurde.
      try {
        erg = await fetchPrice(S2, 'N', 'sold', 'EUR', '24');
      } catch (e) {
        erg = { versuchteAbruf: true, message: e.message };
      }
      await db.run(`DELETE FROM price_cache WHERE set_number=$1`, [S2]).catch(() => {});
      if (erwartetAusCache) {
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

    // 4. Der mengengewichtete Schnitt ist der mengengewichtete Schnitt.
    const PN = `probe-teil-${process.pid}`;
    await db.run(`DELETE FROM part_price_cache WHERE part_number=$1`, [PN]).catch(() => {});
    await db.run(
      `INSERT INTO part_price_cache (part_number,color_id,condition,currency_code,avg_price,qty_avg_price,fetched_at)
       VALUES ($1,0,'N','EUR',5,7,NOW())`,
      [PN],
    );
    const { fetchPartPrice } = _req('src/finanzen/financeCalc.js');
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

    // 5. Und die Regel steht nur an EINER Stelle. Eine zweite Fassung wäre
    //    genau der Zustand, aus dem der Fehler entstanden ist.
    const fs = require('node:fs');
    const path = require('node:path');
    const ROOT = path.join(__dirname, '..');
    for (const rel of ['src/finanzen/financeCalc.ts', 'clients/bricklink.ts']) {
      const src = fs
        .readFileSync(path.join(ROOT, rel), 'utf8')
        .split('\n')
        .filter(z => !z.trim().startsWith('//') && !z.trim().startsWith('*'))
        .join('\n');
      // Beide Schreibweisen. Die erste Fassung dieser Regel prüfte nur die
      // parseFloat-Form — und übersah damit fünf Stellen, die schlicht
      // `pd.avg_price > 0` schrieben. Aufgefallen ist das nicht an der Regel,
      // sondern an einer Suche nach wortgleich wiederholten Bedingungen. …
      assert.doesNotMatch(
        src,
        /(?:parseFloat\([^)]*avg_price[^)]*\)|[\w?.]*\.avg_price)\s*(?:>|<|===|==)\s*0/,
        `${rel} prüft den Preis wieder selbst statt über hatPreis() — und dann ` +
          'können die Fassungen erneut auseinanderlaufen',
      );
      // Und der zweite Operand einer solchen Prüfung darf nicht derselbe sein
      // wie der erste. Genau das stand hier achtmal (`avg > 0 || avg > 0`) und
      // zweimal als `qty_avg_price: parseFloat(x.avg_price)`.
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
