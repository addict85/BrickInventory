/**
 * Ein BrickLink-Preis wird auf EINEM Weg weggeschrieben.
 *
 * Gegenproben (durchgefuehrt):
 *   a) In savePrice() den price_history-Schreibvorgang entfernt
 *      → beide Teilschritte rot. Der Vergleich Job/Anfrageweg allein haette
 *        das NICHT gemerkt (beide verlieren den Punkt gleichermassen) —
 *        deshalb steht darunter zusaetzlich, was herauskommen soll.
 *   b) Nur das alte `return 'updated'` im Rueckfall wieder eingesetzt
 *      → blieb GRUEN, und zu Recht: Die Null-Zeile steht jetzt schon davor,
 *        der fruehe Ausstieg verliert nichts mehr.
 *      Die wirksame Gegenprobe ist die alte REIHENFOLGE — Null-Zeile erst
 *      nach dem Rueckfall, Rueckfall springt heraus. Damit ist Teilschritt 1
 *      rot: zweiter Lauf 'updated' statt 'skipped'.
 *   c) Einen zweiten INSERT INTO price_cache in src/finances/priceRun.ts gesetzt
 *      → Teilschritt 2 rot.
 *   d) (13.11.2026) in savePrice() der Verlauf wieder mit logAndContinue
 *      und ohne Transaktion → Teilschritt 3 rot (keine Absage); nur die
 *      Transaktion weggelassen → rot (die Cache-Zeile stand ohne Verlaufspunkt da).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

// BrickLink vorgeben, BEVOR financeCalc/priceJob priceGuideQuery herausziehen.
// esbuild exportiert ueber Getter, ein `bl.priceGuideQuery = …` liefe ins
// Leere — deshalb wird der Eintrag im require-Zwischenspeicher ersetzt.
const blPath = require.resolve(path.join(ROOT, 'dist', 'src/catalog/bricklinkPrices.js'));
const echt = require(blPath);
let fetches = [];
require.cache[blPath].exports = Object.assign({}, echt, {
  priceGuideQuery: async (_k, _sn, cond) => {
    fetches.push(cond);
    // 'N' ohne Preis, 'U' mit — genau die Lage, in der der Rueckfall greift.
    return cond === 'U'
      ? { min_price: '8', avg_price: '10', max_price: '12', qty_avg_price: '9', total_quantity: '4' }
      : { min_price: '0', avg_price: '0', max_price: '0', qty_avg_price: '0', total_quantity: '0' };
  },
});

/** price_cache und price_history eines Sets, vergleichbar aufbereitet. */
async function traces(sn) {
  const cache = await db.all(
    'SELECT condition, avg_price::float AS avg FROM price_cache WHERE set_number=$1 ORDER BY condition',
    [sn],
  );
  const hist = await db.all(
    'SELECT condition, avg_price::float AS avg FROM price_history WHERE set_number=$1 ORDER BY condition',
    [sn],
  );
  return { cache, hist };
}

test('a BrickLink price is written away on one path', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;

  const JOB = `schreibweg-${process.pid}-job`;
  const ROUTE = `schreibweg-${process.pid}-weg`;
  const FAIL = `schreibweg-${process.pid}-fehl`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM price_cache   WHERE set_number = ANY($1)', [[JOB, ROUTE, FAIL]]).catch(() => {});
    await db.run('DELETE FROM price_history WHERE set_number = ANY($1)', [[JOB, ROUTE, FAIL]]).catch(() => {});
  };
  await aufraeumen();

  try {
    // 1. Der Job schreibt die Null-Zeile mit — sonst kostet dasselbe Set
    //    jeden Lauf erneut zwei Abrufe.
    const { fetchAndCachePrice } = _req('src/finances/priceRun.js');
    fetches = [];
    assert.equal(await fetchAndCachePrice(JOB, 'N', 'sold', 'EUR', 24), 'updated');
    const nachLauf1 = fetches.length;
    assert.equal(
      await fetchAndCachePrice(JOB, 'N', 'sold', 'EUR', 24),
      'skipped',
      'Der zweite Lauf darf BrickLink nicht erneut fragen — die Antwort steht im Cache, ' +
        'auch wenn sie „kein Preis" lautet',
    );
    assert.equal(
      fetches.length,
      nachLauf1,
      `Zweiter Lauf hat ${fetches.length - nachLauf1} zusaetzliche BrickLink-Abrufe gekostet`,
    );

    // 2. Derselbe Fall ueber den Anfrageweg hinterlaesst dasselbe.
    const { fetchPrice } = _req('src/finances/financeCalc.js');
    fetches = [];
    await fetchPrice(ROUTE, 'N', 'sold', 'EUR', 24);
    const fetchesRoute = fetches.length;

    const j = await traces(JOB),
      w = await traces(ROUTE);
    assert.deepEqual(j.cache, w.cache, 'Job und Anfrageweg hinterlassen unterschiedliche price_cache-Zeilen');
    assert.deepEqual(j.hist, w.hist, 'Job und Anfrageweg hinterlassen unterschiedliche price_history-Punkte');
    assert.equal(
      nachLauf1,
      fetchesRoute,
      `Job braucht ${nachLauf1} Abrufe, der Anfrageweg ${fetchesRoute} — fuer dieselbe Auskunft`,
    );

    // Und das Hinterlassene ist auch das Richtige: die Null-Zeile fuer den
    // angefragten Zustand, der Preis fuer den Rueckfall, ein Verlaufspunkt
    // fuer den Preis und keiner fuer die Null.
    assert.deepEqual(j.cache, [
      { condition: 'N', avg: 0 },
      { condition: 'U', avg: 10 },
    ]);
    assert.deepEqual(j.hist, [{ condition: 'U', avg: 10 }]);

    // 3. Scheitert der Verlaufspunkt, gilt auch der Cache nicht: Sonst hielte er den
    //    nächsten Abruf zurück, und die Lücke im Verlauf füllte niemand mehr.
    const fk = require('./helpers/sources').testContext('finances');
    /** Derselbe Kontext, dessen Verlauf nicht schreibbar ist — ausserhalb und in der Transaktion. */
    const kaputt = z => ({
      ...z,
      preisCache: {
        ...z.preisCache,
        rememberSetHistory: async () => {
          throw new Error('Verlauf nicht schreibbar (Probe)');
        },
      },
      transaktion: fn => z.transaktion(t => fn(kaputt(t))),
    });
    const k = kaputt(fk);
    const guide = { min_price: '8', avg_price: '10', max_price: '12', qty_avg_price: '9', total_quantity: '4' };
    await assert.rejects(
      require(path.join(ROOT, 'dist', 'src/finances/calculation/prices.js')).savePrice(k, FAIL, 'U', 'EUR', guide),
      /Verlauf nicht schreibbar/,
    );
    assert.deepEqual(await traces(FAIL), { cache: [], hist: [] });
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

test('the write rule exists in only one place', () => {
  // Gefunden, nicht aufgezaehlt: alle .ts des Baums ausser Tests und Werkzeug.
  const dateien = [];
  const gehen = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (
        e.name === 'node_modules' ||
        e.name === 'dist' ||
        e.name === 'test' ||
        e.name === 'scripts' ||
        e.name.startsWith('.')
      )
        continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) gehen(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(abs);
    }
  };
  gehen(ROOT);
  // Selbstnachweis: Faende die Suche nichts, waere die Regel unten leer wahr.
  assert.ok(dateien.length >= 40, `Nur ${dateien.length} Quelldateien gefunden — die Suche greift nicht mehr`);

  const cacheWriter = [],
    historyWriter = [];
  for (const f of dateien) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    const rel = path.relative(ROOT, f);
    for (const _ of code.matchAll(/INSERT INTO price_cache/g)) cacheWriter.push(rel);
    // Nur der zeilenweise Schreibvorgang. Der Tages-Schnappschuss im Job
    // kopiert per SELECT und ist etwas anderes als „einen Punkt setzen".
    for (const m of code.matchAll(/INSERT INTO price_history[\s\S]{0,220}?(VALUES|SELECT)/g))
      if (m[1] === 'VALUES') historyWriter.push(rel);
  }
  assert.deepEqual(
    cacheWriter,
    ['src/finances/repository/priceCache.ts'],
    'price_cache wird an mehr als einer Stelle beschrieben — genau daran sind die ' + 'beiden Wege auseinandergelaufen',
  );
  assert.deepEqual(
    historyWriter,
    ['src/finances/repository/priceCache.ts'],
    'Ein Verlaufspunkt wird an mehr als einer Stelle gesetzt',
  );
});
