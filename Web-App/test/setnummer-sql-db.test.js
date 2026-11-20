/**
 * Die Versionsregel der Setnummer steht zweimal: withVersion() in src/infra/setNummer.ts und
 * set_nummer_mit_version() in der Datenbank (Migration 0074, Trigger auf set_number/set_num).
 * Beide laufen hier über dieselben Eingaben: die Kandidaten des gemeinsamen Korpus
 * (shared/setnummer-korpus.json), dieselben mit Versionsanhang, und Randfälle.
 *
 * Gegenproben (15.11.2026 gemessen, je einzeln):
 *   A  withVersion prüft `/-\d+/` ohne `$` → rot: „beide Fassungen hängen gleich an“ ('10179-1b: SQL 10179-1b-1')
 *   B  in der Testdatenbank set_nummer_mit_version auf `n ~ '-'` umgestellt (CREATE OR REPLACE
 *      vor dem Vergleich) → rot: dieselbe Prüfung ('10179-', '10179-1b', 'a-b')
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
const { withVersion } = _req('src/infra/setNummer.js');
const { setnummerCandidates } = _req('src/catalog/productTitle.js');

const CORPUS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'setnummer-korpus.json'), 'utf8'));
const RAND = ['10179-1', '10179-12', '10179-', '10179-1b', 'a-b', 'comcon001', 'sw0001a', '6', '-1', '--2', ''];

function inputs() {
  const kandidaten = CORPUS.faelle.flatMap(f => setnummerCandidates(f.text, 2026));
  return [...new Set([...kandidaten, ...kandidaten.map(k => `${k}-2`), ...RAND])];
}

test('beide Fassungen hängen gleich an', { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const alle = inputs();
  // Selbstbeweis: Der Korpus liefert Kandidaten, und beide Zweige der Regel kommen vor.
  assert.ok(alle.length >= 40, `nur ${alle.length} Eingaben — liest der Test den Korpus noch?`);
  assert.ok(alle.some(x => withVersion(x) === x) && alle.some(x => withVersion(x) !== x), 'beide Zweige');
  const zeilen = await db.all(
    'SELECT e AS ein, set_nummer_mit_version(e) AS aus FROM unnest($1::text[]) WITH ORDINALITY AS u(e, i) ORDER BY i',
    [alle],
  );
  assert.equal(zeilen.length, alle.length);
  const abweichend = zeilen.filter(z => z.aus !== withVersion(z.ein)).map(z => `${z.ein}: SQL ${z.aus}`);
  assert.deepEqual(abweichend, []);
});
