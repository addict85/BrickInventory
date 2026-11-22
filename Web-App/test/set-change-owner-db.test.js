/**
 * Purchase price and condition land in the owner's account, the quantity deliberately in the own one.
 * The services create accounts, household and acquisition (helpers/factory.js).
 *
 * Counter-checks: see at the respective substep. For “the quantity deliberately goes to the
 * own account” (14.11.2026): in setService.ts `const ziel = … ? uid :` replaced by
 * `ownerId` → red (the new acquisition landed at the sub-account).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (migrations for account_links).
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
const factory = require('./helpers/factory');
const db = testData();

test("purchase price and condition land in the owner's account", { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = `besitz-haupt-${process.pid}`,
    SUB = `besitz-sub-${process.pid}`;
  const SET = `60445-1`;
  const aufraeumen = async () => {
    await db.run('DELETE FROM set_acquisitions WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM sets WHERE set_number=$1', [SET]).catch(() => {});
    await db.run('DELETE FROM users WHERE username IN ($1,$2)', [MAIN, SUB]).catch(() => {});
  };
  await aufraeumen();

  try {
    const mainId = await factory.konto(MAIN);
    const subId = await factory.konto(SUB);
    await factory.subAccount(mainId, subId);
    // Set AND acquisition belong to the SUB-ACCOUNT.
    await factory.setRecorded(subId, SET, { preis: 10, condition: 'N' });

    const { changeSet } = require('./helpers/sources').areaPage('sets');
    // Purchase price and condition stand in the acquisition, the quantity is its sum.
    const state = async () => ({
      set: await db.get(
        `SELECT s.user_id,
                COALESCE((SELECT SUM(a.quantity) FROM set_acquisitions a
                           WHERE a.user_id = s.user_id
                             AND a.set_number = s.set_number), 0)::int AS quantity
           FROM sets s WHERE s.set_number=$1`,
        [SET],
      ),
      erf: await db.get(
        'SELECT user_id, condition, purchase_price::float AS p FROM set_acquisitions WHERE set_number=$1',
        [SET],
      ),
    });

    // 1. The price — the branch that was already right before.
    await changeSet(mainId, SET, { purchase_price: 99 });
    let s = await state();
    assert.equal(s.erf.p, 99, 'Die Erfassung traegt den neuen Preis nicht');

    // 2. The condition — exactly here the change disappeared.
    //    Counter-check: in writeInLastEntry ownerId replaced by the caller
    //    -> this substep red (carried out).
    await changeSet(mainId, SET, { condition: 'U' });
    s = await state();
    assert.equal(
      s.erf.condition,
      'U',
      'Die letzte Erfassung traegt den neuen Zustand nicht — die Aenderung hat ' +
        'keine Zeile getroffen und wurde trotzdem als Erfolg gemeldet',
    );
    assert.equal(s.erf.p, 99, 'Die Zustandsaenderung hat den Preis mitgenommen');

    // 3. And both still stand with the OWNER, not with the caller.
    assert.equal(s.set.user_id, subId, 'Die Aenderung hat eine Zeile im falschen Konto angelegt');
    assert.equal(s.erf.user_id, subId);
    const foreignOnes = await db.get('SELECT COUNT(*)::int n FROM sets WHERE set_number=$1 AND user_id=$2', [
      SET,
      mainId,
    ]);
    assert.equal(foreignOnes.n, 0, 'Eine Preis- oder Zustandsaenderung hat eine eigene Zeile erzeugt');

    // 4. The quantity, on the other hand, deliberately goes to the OWN account: whoever increases gets
    //    an own purchase price entry instead of changing the inventory of another account.
    await changeSet(mainId, SET, { quantity: 2 });
    const je = await db.all(
      'SELECT user_id, SUM(quantity)::int AS n FROM set_acquisitions WHERE set_number=$1 GROUP BY user_id ORDER BY user_id',
      [SET],
    );
    assert.deepEqual(
      je.map((/** @type {any} */ z) => [z.user_id, z.n]),
      [
        [mainId, 1],
        [subId, 1],
      ].sort((a, b) => a[0] - b[0]),
      'ohne Angabe eines Kontos landet die neue Menge beim Aufrufer',
    );
  } finally {
    await aufraeumen();
    await db.pool.end();
  }
});

// The name was „the mirroring onto set and last acquisition stands in one
// place". Since migration 0032 nothing is mirrored any more — only the last
// acquisition is written. The rule itself is still right and
// has even become more important: it is now the ONLY write path.
test('the last entry is written in exactly one place', () => {
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
  assert.ok(dateien.length >= 40, `Nur ${dateien.length} Quelldateien gefunden — die Suche greift nicht mehr`);

  const placeList = [];
  for (const f of dateien) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    // EVERY occurrence, not one per file: when counter-checking I inserted a
    // second copy into THE SAME file, and the rule stayed
    // green — it collected file names instead of occurrences.
    for (const _ of code.matchAll(
      /UPDATE set_acquisitions SET[\s\S]{0,260}?ORDER BY created_at DESC, id DESC LIMIT 1/g,
    ))
      placeList.push(path.relative(ROOT, f));
  }
  assert.deepEqual(
    placeList,
    ['src/inventory/repository/purchases.ts'],
    'Die letzte Erfassung wird an mehr als einer Stelle beschrieben — genau so ' +
      'sind Preis und Zustand mit verschiedenen Konten auseinandergelaufen',
  );
});
