/**
 * The account condition of the read building blocks (db/accounts.ts) is only a placeholder: `= $n` or
 * `= ANY($n)`. A value in the SQL text would otherwise run unchecked into every subquery.
 *
 * Counter-checks (measured 15.11.2026, each alone):
 *   A  the check `if (!FORM.test(konten)) throw …` deleted in onAccounts → red: “a value in the
 *      text throws”, Missing expected exception: setHoldings(= 1 OR TRUE)
 *   B  in db/stockQuantity.ts setQuantityJoin back to `WHERE a.user_id ${accounts}` → red: the same check,
 *      Missing expected exception: setQuantityJoin(= 1 OR TRUE)
 * The type is checked by test/types/accounts.typprobe.ts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const _req = require('./helpers/sources').buildAndRequire();

const view = _req('db/inventoryView.js');
const quantity = _req('db/stockQuantity.js');

test('placeholders go through, at the right column', () => {
  assert.match(view.setHoldings('= ANY($1)'), /FROM sets WHERE user_id = ANY\(\$1\)\)$/);
  assert.match(view.wantedList('= $2'), /FROM wanted WHERE user_id = \$2\)$/);
  assert.match(quantity.setQuantityJoin('s', 'sm', '= ANY($3)'), /WHERE a\.user_id = ANY\(\$3\)/);
  assert.match(quantity.quantityJoin('p', 'part', 'tm', '= $1'), /WHERE x\.user_id = \$1/);
  // Without a condition all accounts apply.
  assert.doesNotMatch(view.setHoldings(), /WHERE/);
});

test('a value in the text throws', () => {
  const evil = ['= 1 OR TRUE', '= ANY($1) OR TRUE', "= ANY('{1}')", 'IS NOT NULL', '= $1; DROP TABLE sets'];
  for (const k of evil) {
    assert.throws(() => view.setHoldings(k), /Kontobedingung/, `setBestand(${k})`);
    assert.throws(() => view.countedSets(k), /Kontobedingung/, `countedSets(${k})`);
    assert.throws(() => quantity.setQuantityJoin('s', 'sm', k), /Kontobedingung/, `setQuantityJoin(${k})`);
    assert.throws(() => quantity.quantityJoin('p', 'fig', 'tm', k), /Kontobedingung/, `quantityJoin(${k})`);
  }
});
