/**
 * The refilled market price applies to the condition of THIS entry.
 *
 * If the purchase price field is cleared, the entry service refills the market
 * price. Parts and minifigures used to drop the row's condition and
 * derived one from ALL entries; a used row thus got the
 * price of the aggregate condition.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  in src/collection/acquisitions.ts the condition passed to resolvePrice replaced by null
 *      → red for “set” (100 instead of 60)
 *   B  in ARTEN.part.resolvePrice cond not passed on → red for “part”
 *      (100 instead of 60); “set” stays green
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

test('a cleared purchase price is refilled in the condition of the row', { concurrency: 1 }, async t => {
  const db = testData();
  if (!(await dataOrSkip(t, _req))) return;
  const { changeAcquisition } = _req('src/collection/acquisitions.js');
  const P = process.pid;
  const NAME = `zustandpreis-${P}`,
    SN = `${P}9-1`,
    PN = `zp${P}`,
    FN = `fig-zp${P}`;
  const route = async () => {
    await db.run('DELETE FROM users WHERE username = $1', [NAME]);
    await db.run('DELETE FROM price_cache WHERE set_number = $1', [SN]);
    await db.run('DELETE FROM part_price_cache WHERE part_number = $1', [PN]);
    await db.run('DELETE FROM minifig_price_cache WHERE fig_number = $1', [FN]);
  };
  await route();
  t.after(async () => {
    await route().catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1,'currency','CHF')`, [uid]);
  // New 100, used 60 — in all three caches.
  for (const [z, price] of [
    ['N', 100],
    ['U', 60],
  ]) {
    await db.run(`INSERT INTO price_cache (set_number, condition, currency_code, avg_price) VALUES ($1,$2,'CHF',$3)`, [
      SN,
      z,
      price,
    ]);
    await db.run(
      `INSERT INTO part_price_cache (part_number, color_id, condition, currency_code, avg_price) VALUES ($1,77,$2,'CHF',$3)`,
      [PN, z, price],
    );
    await db.run(
      `INSERT INTO minifig_price_cache (fig_number, condition, currency_code, avg_price) VALUES ($1,$2,'CHF',$3)`,
      [FN, z, price],
    );
  }
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, SN]);
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,$2,77,'manual')`, [uid, PN]);
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, FN]);
  const row = async (sql, p) => (await db.get(sql + ` VALUES ($1,$2,1,10,'N','CHF') RETURNING id`, p)).id;
  const cases = [
    [
      'set',
      'set_acquisitions',
      'purchase_price',
      [SN],
      await row('INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency)', [
        uid,
        SN,
      ]),
    ],
    [
      'part',
      'part_acquisitions',
      'unit_price',
      [PN, 77],
      await db
        .get(
          `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, currency)
                    VALUES ($1,$2,77,1,10,'N','CHF') RETURNING id`,
          [uid, PN],
        )
        .then(r => r.id),
    ],
    [
      'fig',
      'minifig_acquisitions',
      'unit_price',
      [FN],
      await row('INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, currency)', [
        uid,
        FN,
      ]),
    ],
  ];
  for (const [kind, table, column, keys, id] of cases) {
    await changeAcquisition(kind, uid, id, keys, { [column]: '', condition: 'U' });
    const z = await db.get(`SELECT ${column}::float AS price, price_estimated, condition FROM ${table} WHERE id = $1`, [
      id,
    ]);
    assert.deepEqual(z, { price: 60, price_estimated: true, condition: 'U' }, kind);
  }
});

test('every market price fetch gets a condition', () => {
  // The same gap twice
  const fs = require('node:fs');
  const path = require('node:path');
  const { withoutComments } = require('./helpers/sources');
  const ROOT = path.join(__dirname, '..');

  const files = [];
  (function collect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) collect(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  })(path.join(ROOT, 'routes'));
  for (const d of ['src']) {
    (function collect(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collect(p);
        else if (e.name.endsWith('.ts')) files.push(p);
      }
    })(path.join(ROOT, d));
  }

  const hits = [];
  for (const file of files) {
    const code = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const fn of ['currentMinifigMarketPrice', 'currentPartMarketPrice']) {
      const re = new RegExp(String.raw`(?<!function )${fn}\(((?:[^()]|\([^()]*\))*)\)`, 'g');
      for (const m of code.matchAll(re)) {
        const args = m[1]
          .split(',')
          .map(a => a.trim())
          .filter(Boolean);
        if (args.length >= 4) continue; // …, condition
        const row = code.slice(0, m.index).split('\n').length;
        hits.push(`${path.relative(ROOT, file)}:${row} ${fn}(${m[1].slice(0, 40)})`);
      }
    }
  }
  assert.deepEqual(
    hits,
    [],
    `Market price fetched without condition:\n  ${hits.join('\n  ')}\nMarket prices apply PER CONDITION. Without one, it is derived from the existing acquisitions — and that is wrong as soon as an entry exists in both conditions.`,
  );
});
