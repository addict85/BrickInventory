/**
 * A set number is written the same everywhere.
 *
 * Counter-checks: see at the respective substep.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
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

// Set up BrickLink BEFORE the price paths pull out priceGuideQuery. The
// real client throws in exactly this situation — here it is only COUNTED how
// often it is asked at all.
const blPath = require.resolve(path.join(ROOT, 'dist', 'src/catalog/bricklinkPrices.js'));
const echt = require(blPath);
let fetches = [];
require.cache[blPath].exports = Object.assign({}, echt, {
  priceGuideQuery: async (_k, sn, cond) => {
    fetches.push(`${sn}|${cond}`);
    throw new Error(`${sn} — kein BrickLink-Preis verfuegbar`);
  },
});

test('the spelling of a set number is one rule', () => {
  const { withVersion, withoutVersion } = _req('src/infra/setNumber.js');
  assert.equal(withVersion('10179'), '10179-1');
  assert.equal(withVersion('10179-1'), '10179-1');
  assert.equal(withVersion('75192-2'), '75192-2');
  assert.equal(withoutVersion('10179'), '10179');
  assert.equal(withoutVersion('75192-2'), '75192');
});

test('the catalog answers the same no matter how the number is written', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;

  const BLANK = `g${process.pid}`; // this is how the caller asks
  const WITH_V = `${BLANK}-1`; // this is how clients/bricklink.ts stores it
  const aufraeumen = () =>
    db.run('DELETE FROM catalog_cache WHERE set_number = ANY($1)', [[BLANK, WITH_V]]).catch(() => {});
  await aufraeumen();

  try {
    // Write the marker exactly as clients/bricklink.ts writes it.
    await db.run(
      `INSERT INTO catalog_cache (set_number, bl_type, is_gear) VALUES ($1,'NONE',true)
       ON CONFLICT (set_number) DO UPDATE SET bl_type='NONE', is_gear=true`,
      [WITH_V],
    );

    const { fetchAndCachePrice } = _req('src/finances/priceRun.js');
    const { fetchPrice } = _req('src/finances/financeCalc.js');

    // Counter-check: in src/infra/setNumber.ts the withVersion() removed from catalogEntry()
    // -> the row with „without version suffix" turns red.
    for (const number of [BLANK, WITH_V]) {
      fetches = [];
      const r = await fetchAndCachePrice(number, 'N', 'sold', 'EUR', 24);
      assert.equal(
        r,
        'skipped_gear',
        `„${number}": the job asks BrickLink although the catalogue says there is ` +
          'no price — and counts the result as an error instead of as skipped',
      );
      assert.equal(fetches.length, 0, `„${number}": ${fetches.length} BrickLink-Abruf(e) umsonst`);

      fetches = [];
      const p = await fetchPrice(number, 'N', 'sold', 'EUR', 24);
      assert.equal(p.no_price, true, `„${number}": the request path reports no priceless entry`);
      assert.equal(fetches.length, 0, `„${number}": ${fetches.length} BrickLink-Abruf(e) umsonst`);
    }
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

test('the spelling is not computed again anywhere', () => {
  // Found, not enumerated.
  const dateien = [];
  const go = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test', 'scripts'].includes(e.name) || e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) go(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(abs);
    }
  };
  go(ROOT);
  // Self-proof: if the search found nothing, the rule would be vacuously true.
  assert.ok(dateien.length >= 40, `Only ${dateien.length} source files found — the search no longer works`);

  const eigene = [],
    prechecker = [];
  for (const f of dateien) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    const rel = path.relative(ROOT, f);
    // Why three patterns
    for (const m of [
      /\.includes\('-'\)\s*\?/, // the most common version
      /\/-\\d\+\$\/\.test\(/, // bricklinkLink, setAdd, setService
      /\?\s*[\w.]+\s*:\s*`\$\{[^}]+\}-1`/, // the addition itself
      /\.replace\(\/-(?:\\\\d|\[0-9\])\+\$\//,
    ]) // and the truncation
      if (m.test(code)) {
        eigene.push(rel);
        break;
      }
    if (/SELECT is_gear, bl_type(?:, fetched_at)? FROM catalog_cache/.test(code)) prechecker.push(rel);
  }
  // No exceptions: two places that compute the same notation drift apart.
  assert.deepEqual(
    eigene,
    ['src/infra/setNumber.ts'],
    'The spelling is computed once more elsewhere — that is exactly how ' +
      'two places that mean the same thing drift apart',
  );
  assert.deepEqual(
    prechecker,
    ['src/catalog/repository/catalogCache.ts'],
    'The catalogue is read in more than one place',
  );
});
