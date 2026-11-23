/**
 * A new copy gets the condition that the set REALLY has.
 *
 * Counter-checks: see at the respective substep.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const ROOT = path.join(__dirname, '..');
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

test('a new copy follows the acquisitions, not the stored value', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { runMigrate: false }))) return;
  // The daily rule stands as an index in migration 0047; without it the
  // ON CONFLICT does not apply when capturing.
  const mc = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(mc);
  } finally {
    mc.release();
  }

  const U = `neuzust-${process.pid}`,
    SET = '60445-1';
  const aufraeumen = async () => {
    await db.run('DELETE FROM set_acquisitions WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM sets WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM users WHERE username=$1', [U]).catch(() => {});
  };
  await aufraeumen();

  try {
    await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [U]);
    const uid = (await db.get('SELECT id FROM users WHERE username=$1', [U])).id;

    // The case effectiveCondition() was built for: the only
    // acquisition says 'U', and the user's default (DEFAULT_PRICE_CONDITION)
    // says 'N'. Until migration 0032 the 'N' additionally stood in
    // sets.condition — the column is gone, the possibility of confusion
    // between default and acquisition remains.
    await holdsSet(db, uid, SET, 0); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                  VALUES ($1,$2,1,10,'U', NOW() - INTERVAL '2 days')`,
      [uid, SET],
    );
    // Prices for BOTH conditions — otherwise the difference would be invisible.
    for (const [c, p] of [
      ['N', 100],
      ['U', 20],
    ])
      await db.run(
        `INSERT INTO price_cache (set_number,condition,currency_code,min_price,avg_price,max_price,qty_avg_price,total_quantity,fetched_at)
                    VALUES ($1,$2,'EUR',$3,$3,$3,$3,5,NOW())
                    ON CONFLICT (set_number,condition,currency_code) DO UPDATE SET avg_price=$3`,
        [SET, c, p],
      );

    const { changeSet } = require('./helpers/sources').areaPage('sets');
    await changeSet(uid, SET, { quantity: 2 });

    const erf = await db.all(
      `SELECT condition, purchase_price::float AS p FROM set_acquisitions
        WHERE user_id=$1 AND set_number=$2 ORDER BY created_at ASC, id ASC`,
      [uid, SET],
    );
    assert.equal(erf.length, 2, 'Increasing the quantity created no new acquisition');
    // Counter-check: in priceForNewEntry pin the condition to
    // DEFAULT_PRICE_CONDITION -> here stands 'N' and 100.
    assert.equal(
      erf[1].condition,
      'U',
      'The new copy carries the default instead of the condition of the acquisitions',
    );
    assert.equal(
      erf[1].p,
      20,
      'The new copy got the new price although the set is used — ' + 'that goes into the stock value and the P&L',
    );
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

/**
 * Why this rule was rewritten
 */
test('no source reads purchase price or condition from sets', () => {
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
  assert.ok(dateien.length >= 40, `Only ${dateien.length} source files found — the search no longer works`);

  // What is searched for are the forms in which the two columns actually
  // occurred in this tree — FOUND, not invented (git log of migration
  // 0032 names every place):
  const forbidden = [
    /\bs\.purchase_price\b/i,
    /\bs\.condition\b/i,
    /UPDATE sets SET (purchase_price|condition)\b/i,
    /SELECT\s+condition\s+FROM sets\b/i,
    /SELECT\s+purchase_price,\s*condition\s+FROM sets\b/i,
    /COALESCE\(condition,'N'\) AS c\s*\n?\s*FROM sets\b/i,
    /INSERT INTO sets \([^)]*\b(purchase_price|condition)\b/i,
  ];
  const treffer = [];
  let geprueft = 0;
  for (const f of dateien) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    geprueft++;
    for (const r of forbidden) {
      const m = code.match(r);
      if (m) treffer.push(`${path.relative(ROOT, f)}: ${m[0].replace(/\s+/g, ' ')}`);
    }
  }
  // Self-proof with a MEASURED number: the patterns must really trigger on a text that
  // contains them — otherwise the rule would be vacuously true.
  const probe = `SELECT s.condition, s.purchase_price FROM sets s
    INSERT INTO sets (user_id,purchase_price) VALUES ($1,$2)`;
  const damaged = forbidden.filter(r => r.test(probe)).length;
  assert.equal(
    damaged,
    3,
    `${damaged} of the patterns fired on the probe, expected 3 ` +
      '(s.condition, s.purchase_price, INSERT INTO sets with purchase_price)',
  );
  assert.ok(geprueft >= 40, `Only ${geprueft} files checked — the search no longer works`);
  assert.deepEqual(
    treffer,
    [],
    'These places read or write purchase price/condition on the sets row. ' +
      'Since migration 0032 both live only in set_acquisitions; exactly this ' +
      'coexistence produced the same bugs eight times in this tree.',
  );
});
