/**
 * The version rule of the set number stands twice: withVersion() in src/infra/setNumber.ts and
 * set_number_with_version() in the database (migration 0074, trigger on set_number/set_num).
 * Both run here over the same inputs: the candidates of the shared corpus
 * (shared/setnummer-korpus.json), the same with a version suffix, and edge cases.
 *
 * Counter-checks (measured 15.11.2026, each on its own):
 *   A  withVersion checks `/-\d+/` without `$` → red: “both versions attach the same” ('10179-1b: SQL 10179-1b-1')
 *   B  in the test database set_number_with_version switched to `n ~ '-'` (CREATE OR REPLACE
 *      before the comparison) → red: the same check ('10179-', '10179-1b', 'a-b')
 *
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { withVersion } = _req('src/infra/setNumber.js');
const { setNumberCandidates } = _req('src/catalog/productTitle.js');

const CORPUS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'setnummer-korpus.json'), 'utf8'));
const RAND = ['10179-1', '10179-12', '10179-', '10179-1b', 'a-b', 'comcon001', 'sw0001a', '6', '-1', '--2', ''];

function inputs() {
  const kandidaten = CORPUS.faelle.flatMap(f => setNumberCandidates(f.text, 2026));
  return [...new Set([...kandidaten, ...kandidaten.map(k => `${k}-2`), ...RAND])];
}

test('both versions attach the same', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const alle = inputs();
  // Self-proof: the corpus delivers candidates, and both branches of the rule occur.
  assert.ok(alle.length >= 40, `only ${alle.length} inputs — does the test still read the corpus?`);
  assert.ok(alle.some(x => withVersion(x) === x) && alle.some(x => withVersion(x) !== x), 'both branches');
  const zeilen = await db.all(
    'SELECT e AS ein, set_number_with_version(e) AS aus FROM unnest($1::text[]) WITH ORDINALITY AS u(e, i) ORDER BY i',
    [alle],
  );
  assert.equal(zeilen.length, alle.length);
  const deviating = zeilen.filter(z => z.aus !== withVersion(z.ein)).map(z => `${z.ein}: SQL ${z.aus}`);
  assert.deepEqual(deviating, []);
});
