/**
 * Die Kontobedingung der Lesebausteine (db/accounts.ts) ist nur ein Platzhalter: `= $n` oder
 * `= ANY($n)`. Ein Wert im SQL-Text liefe sonst ungeprüft in jede Unterabfrage.
 *
 * Gegenproben (15.11.2026 gemessen, je einzeln):
 *   A  die Prüfung `if (!FORM.test(konten)) throw …` in aufKonten gestrichen → rot: „ein Wert im
 *      Text wirft“, Missing expected exception: setBestand(= 1 OR TRUE)
 *   B  in db/stockQuantity.ts mengeJoin wieder `WHERE a.user_id ${konten}` → rot: dieselbe Prüfung,
 *      Missing expected exception: mengeJoin(= 1 OR TRUE)
 * Den Typ prüft test/types/accounts.typprobe.ts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const _req = require('./helpers/sources').buildAndRequire();

const sicht = _req('db/inventoryView.js');
const menge = _req('db/stockQuantity.js');

test('placeholders go through, at the right column', () => {
  assert.match(sicht.setBestand('= ANY($1)'), /FROM sets WHERE user_id = ANY\(\$1\)\)$/);
  assert.match(sicht.merkliste('= $2'), /FROM wanted WHERE user_id = \$2\)$/);
  assert.match(menge.mengeJoin('s', 'sm', '= ANY($3)'), /WHERE a\.user_id = ANY\(\$3\)/);
  assert.match(menge.teilmengeJoin('p', 'part', 'tm', '= $1'), /WHERE x\.user_id = \$1/);
  // Ohne Bedingung gelten alle Konten.
  assert.doesNotMatch(sicht.setBestand(), /WHERE/);
});

test('a value in the text throws', () => {
  const boese = ['= 1 OR TRUE', '= ANY($1) OR TRUE', "= ANY('{1}')", 'IS NOT NULL', '= $1; DROP TABLE sets'];
  for (const k of boese) {
    assert.throws(() => sicht.setBestand(k), /Kontobedingung/, `setBestand(${k})`);
    assert.throws(() => sicht.countedSets(k), /Kontobedingung/, `countedSets(${k})`);
    assert.throws(() => menge.mengeJoin('s', 'sm', k), /Kontobedingung/, `mengeJoin(${k})`);
    assert.throws(() => menge.teilmengeJoin('p', 'fig', 'tm', k), /Kontobedingung/, `teilmengeJoin(${k})`);
  }
});
