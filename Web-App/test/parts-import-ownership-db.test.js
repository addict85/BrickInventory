/**
 * POST /sets/:setNumber/parts only imports sets in the own scope, for
 * their owner, and is throttled per account; an empty response from
 * Rebrickable is remembered briefly instead of asking again on every attempt.
 *
 * Counter-checks (measured 01.11.2026):
 *   A  findSetInScope() removed from the route (import for the asking
 *      account as before) → red: “a foreign set is not imported” and
 *      “the main account imports the sub-account's set for its owner”
 *   B  throttle removed → red: “at most 30 imports per hour per account”
 *   C  the marker `_leer` not read in alleTeileDesSets() → red: “an
 *      empty response is remembered” (two fetches instead of one)
 *   D  (14.11.2026) in importPartsOfSets() again a catch that reports
 *      and delivers 0 (formerly importPartsForSet) → red: “a failed
 *      import is an error” (200 with count 0)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

// Before loading the route: record import and Rebrickable fetch instead of running them.
const importe = [];
const fetches = [];
const replace = (rel, zusatz) => {
  const pfad = require.resolve(path.join(quellen.DIST, rel));
  _req(rel);
  require.cache[pfad].exports = Object.assign({}, require.cache[pfad].exports, zusatz);
};
// Rebrickable set up at the wiring: every set of services asks via it.
quellen.testSources(null, {
  fetchSetParts: async n => {
    fetches.push(n);
    return { teile: [], verweigert: false };
  },
});
replace('src/sets/setContentImport.js', {
  importParts: async (_k, sn, uid) => {
    if (sn.startsWith('TIK')) throw new Error('Rebrickable antwortet nicht');
    importe.push([sn, uid]);
    return 3;
  },
});

const db = quellen.testData();
const P = process.pid;

test('parts import only in scope', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const namen = [`ti_haupt_${P}`, `ti_unter_${P}`, `ti_fremd_${P}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push(
      (
        await db.get(
          `INSERT INTO users (username, password_hash, is_active)
    VALUES ($1, 'x', true) RETURNING id`,
          [n],
        )
      ).id,
    );
  const [H, U, F] = ids;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [H, U]);
  const UNTER = `TIU${P}-1`,
    FREMD = `TIF${P}-1`,
    KAPUTT = `TIK${P}-1`;
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2), ($3, $4), ($1, $5)', [
    U,
    UNTER,
    F,
    FREMD,
    KAPUTT,
  ]);
  await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'teile-import|%'");
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'teile-import|%'").catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const sitzung = {};
  const { base } = testServer(_req, { sitzung, t });
  const importiere = async (als, sn) => {
    sitzung.userId = als;
    const r = await fetch(`${base}/api/v1/sets/${encodeURIComponent(sn)}/parts`, { method: 'POST' });
    return { status: r.status, body: await r.json() };
  };

  await t.test('a foreign set is not imported', async () => {
    const r = await importiere(H, FREMD);
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(r.body.code, 'set_nicht_gefunden');
    assert.deepEqual(importe, []);
  });

  await t.test("the main account imports the sub-account's set for its owner", async () => {
    const r = await importiere(H, UNTER);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { success: true, count: 3 });
    assert.deepEqual(importe, [[UNTER, U]]);
  });

  await t.test('a failed import is an error, not an empty list', async () => {
    const r = await importiere(H, KAPUTT);
    assert.equal(r.status, 500, JSON.stringify(r.body));
    assert.equal(r.body.success, false);
    assert.equal(r.body.count, undefined);
    await db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'teile-import|%'");
  });

  await t.test('at most 30 imports per hour per account', async () => {
    const status = [];
    for (let i = 0; i < 30; i++) status.push((await importiere(U, UNTER)).status);
    assert.deepEqual([...new Set(status)], [200], 'bis zur Grenze geht jeder durch');
    const toMuch = await importiere(U, UNTER);
    assert.equal(toMuch.status, 429);
    assert.equal(toMuch.body.code, 'zu_viele_anfragen');
    assert.equal((await importiere(F, FREMD)).status, 200, 'ein anderes Konto zählt für sich');
  });

  await t.test('an empty response is remembered', async () => {
    const { allPartsOfSet } = _req('src/catalog/rebrickableCatalog.js');
    const leer = `TIL${P}-1`;
    assert.deepEqual(await allPartsOfSet(leer), []);
    assert.deepEqual(await allPartsOfSet(leer), []);
    assert.deepEqual(fetches, [leer], 'die zweite Frage ging wieder an Rebrickable');
  });
});
