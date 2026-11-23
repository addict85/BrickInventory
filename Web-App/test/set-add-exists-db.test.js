/**
 * A set that already stands in the scope is NOT increased when capturing.
 *
 * Counter-check (carried out): the findSetInScope branch removed from routes/api/sets.ts
 * → the first substep turns red (quantity 1 → 2).
 * Counter-check (15.11.2026): in setPresent() (src/sets/addSet.ts) the number returned without
 * normalizeSetNumber → red „exists: false, set_number“ (without -1).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (migrations for account_links).
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

test('existing set: adding reports exists and writes nothing', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = `ex-haupt-${process.pid}`,
    SUB = `ex-sub-${process.pid}`;
  // Suffix deliberately „-1": normalizeSetNumber() always appends „-1" to a number WITHOUT
  // a suffix. A set 97001-42 could thus not be found at all via the mere input „97001"
  // — that is the existing rule of the project and not
  // the subject of this test. Substep 2 therefore checks the normalization on
  // numbers for which it can apply at all.
  const basis = 97000 + (process.pid % 900);
  const OWN = `${basis}-1`; // belongs to the main account
  const KIND = `${basis + 1000}-1`; // belongs to the sub-account
  const NEW = `${basis + 2000}-1`; // exists nowhere

  const cleanUp = async () => {
    for (const sn of [OWN, KIND, NEW]) {
      await db.run(`DELETE FROM sets WHERE set_number=$1`, [sn]).catch(() => {});
      await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [sn]).catch(() => {});
    }
  };

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [MAIN, SUB]);
  const mainId = (await db.get(`SELECT id FROM users WHERE username=$1`, [MAIN])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    mainId,
    subId,
  ]);
  await cleanUp();

  const create = async (owner, sn) => {
    await holdsSet(db, owner, sn, 0); // quantity 0: the acquisition behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,10,'N',1)`,
      [owner, sn],
    );
  };
  await create(mainId, OWN);
  await create(subId, KIND);

  const state = async sn => ({
    // From the acquisitions (migration 0036), across ALL accounts — the test
    // asks „how many copies are there in total".
    quantity: (
      await db.get(
        `SELECT COALESCE(SUM(a.quantity),0)::int AS q
         FROM set_acquisitions a
         JOIN sets s ON s.user_id = a.user_id AND s.set_number = a.set_number
        WHERE a.set_number=$1`,
        [sn],
      )
    ).q,
    acqs: (await db.get(`SELECT COUNT(*)::int AS c FROM set_acquisitions WHERE set_number=$1`, [sn])).c,
    lines: (await db.get(`SELECT COUNT(*)::int AS c FROM sets WHERE set_number=$1`, [sn])).c,
  });

  const { base, srv } = testServer(_req, { session: { userId: mainId }, t });

  const record = async (path, sn) => {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set_number: sn, quantity: 1 }),
    });
    return { status: r.status, kind: r.headers.get('content-type') || '', body: await r.json().catch(() => null) };
  };

  try {
    // 1. OWN set and set of the SUB-ACCOUNT — both paths, both sets.
    for (const [who, sn] of [
      ['eigenes', OWN],
      ['Unterkonto', KIND],
    ]) {
      for (const [name, path] of [
        ['Android/Webapp (v1)', '/api/v2/sets'],
        ['Webapp (add-stream)', '/api/v2/sets/add-stream'],
      ]) {
        const ago = await state(sn);
        const r = await record(path, sn);
        assert.equal(r.status, 200, `${who}/${name}: ${r.status}`);
        assert.equal(r.body?.action, 'exists', `${who}/${name}: expected action=exists, was ${JSON.stringify(r.body)}`);
        assert.match(
          r.kind,
          /application\/json/,
          `${who}/${name}: the response must be ordinary JSON — there is nothing to follow`,
        );
        const nach = await state(sn);
        assert.deepEqual(nach, ago, `${who}/${name}: something was written although the set already exists`);
      }
    }

    // 2. The number is normalized BEFORE the check — otherwise "97001" would count
    //    as new although "97001-1" has long existed, and the whole rule
    //    hangs exactly on that.
    const withoutSuffix = OWN.replace(/-\d+$/, '');
    const ago = await state(OWN);
    const r = await record('/api/v2/sets', withoutSuffix);
    assert.equal(r.body?.action, 'exists', 'entered without a suffix, the same set must be recognised');
    assert.deepEqual(await state(OWN), ago);

    // 3. The pre-query says the same as the capture — otherwise the
    //    scanner could show an intermediate dialog for a set that is afterwards
    //    rejected as „already present".
    for (const [sn, expected] of [
      [OWN, true],
      [KIND, true],
      [NEW, false],
      [withoutSuffix, true],
    ]) {
      const e = await (await fetch(`${base}/api/v2/sets/exists/${encodeURIComponent(sn)}`)).json();
      assert.equal(e.exists, expected, `exists for ${sn}`);
      if (expected) assert.ok(e.owner_user_id > 0, `owner missing for ${sn}`);
    }
    // Without a hit the pre-query names the number as it would be created (with suffix).
    const newWithoutSuffix = NEW.replace(/-1$/, '');
    const none = await (await fetch(`${base}/api/v2/sets/exists/${newWithoutSuffix}`)).json();
    assert.deepEqual([none.exists, none.set_number], [false, NEW], 'exists: false, set_number');
    // The own account wins if both have the same set.
    await create(subId, OWN);
    const bothOnes = await (await fetch(`${base}/api/v2/sets/exists/${OWN}`)).json();
    assert.equal(
      bothOnes.owner_user_id,
      mainId,
      'with two owners the own row must win — the detail view should show the own one',
    );
    assert.equal(bothOnes.is_self, true);

    // 4. EXCEPTION: the CSV import tops up (ifPresent: 'aufstocken').
    const { acquireSet } = require('./helpers/sources').areaPage('sets');
    const vorImport = await state(KIND);
    const erg = await acquireSet({
      requester: subId,
      setNumber: KIND,
      quantity: 1,
      condition: 'N',
      ifPresent: 'aufstocken',
    });
    assert.equal(erg.action, 'updated', 'the import must top up — otherwise the CSV import stalls');
    assert.equal((await state(KIND)).quantity, vorImport.quantity + 1);
  } finally {
    await cleanUp();
    await db.run(`DELETE FROM account_links WHERE main_user_id=$1`, [mainId]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});

test('one rule for set numbers: normalizeSetNumber', () => {
  // Formerly three names (normalizeSetNumber, sanitizeSetNumber); now only the place where the rule stands.
  const { normalizeSetNumber } = _req('src/infra/setNumber.js');
  const sets = _req('src/sets/index.js');
  assert.equal(sets.normalizeSetNumber, undefined);
  assert.equal(sets.sanitizeSetNumber, undefined);
  for (const [input, expected] of [
    ['75192', '75192-1'],
    ['75192-1', '75192-1'],
    [' 75192 ', '75192-1'],
    ['75192; irgendwas', '75192-1'],
    ['75192 Falcon', '75192-1'],
    ['ab-12', 'ab-12'],
    ['4002!!', '4002-1'],
  ])
    assert.equal(normalizeSetNumber(input), expected, `for "${input}"`);
});
