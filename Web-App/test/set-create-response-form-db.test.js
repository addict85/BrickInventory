/**
 * A NEWLY created set is answered the same in both capture routes.
 *
 * Counter-check: an extra field in the done event of routes/api/setsImport.ts → red “a newly created set is answered the same in both routes”.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// The follow-up after capturing hangs on a setTimeout and runs AFTER
// this test, against a pool that is closed by then. The same precaution
// as in set-add-exists-db.test.js.
let posedAddSet = null;
let positionCalled = 0;
const Module = require('node:module');
const _realRequire = Module.prototype.require;
Module.prototype.require = function (name, ...rest) {
  const m = _realRequire.call(this, name, ...rest);
  // The creation is set up; the completion in the stream without network.
  if (typeof name === 'string' && /[/\\]addSet(\.js)?$/.test(name))
    return new Proxy(m, {
      // The factory binds at build time (mit()): the replacement only checks the setting when called.
      get: (t, k) => {
        if (k === 'setSupplement')
          return (sk, ...a) => (posedAddSet !== null ? Promise.resolve({ name: 'Testset' }) : t[k](sk, ...a));
        if (k !== 'acquireSet') return t[k];
        return async (sk, ...args) => {
          if (posedAddSet === null) return t[k](sk, ...args);
          positionCalled++;
          return posedAddSet(...args);
        };
      },
    });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { testData } = require('./helpers/sources');
const { holdsSet } = require('./helpers/inventory');
const db = testData();

test('a newly created set is answered the same in both routes', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const USER = `neu-form-${process.pid}`;
  const basis = 96000 + (process.pid % 900);
  const DA = `${basis}-1`; // exists, for step 1
  const NEW_A = `${basis + 100}-1`; // does not exist, for the stream
  const NEW_B = `${basis + 200}-1`; // does not exist, for the token route

  const cleanUp = async () => {
    for (const sn of [DA, NEW_A, NEW_B]) {
      await db.run(`DELETE FROM sets WHERE set_number=$1`, [sn]).catch(() => {});
      await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [sn]).catch(() => {});
    }
  };

  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;
  await cleanUp();
  await holdsSet(db, uid, DA, 0); // quantity 0: the acquisition behind it carries it
  await db.run(
    `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,10,'N',1)`,
    [uid, DA],
  );

  const { base, srv } = testServer(_req, { session: { userId: uid }, t });

  try {
    // ── 1. The premise, with the REAL function ────────────────────────────
    //
    // If `success` already stood in the result of acquireSet(), everything further would check
    // nothing: the routes would then not have to add it in the first place. The
    // „exists" branch runs purely on the database and needs no network.
    const { acquireSet } = require('./helpers/sources').areaPage('sets');
    const original = await acquireSet({ requester: uid, setNumber: DA });
    assert.equal(original.action, 'exists', 'the setup of the test is no longer right');
    assert.equal(
      'success' in original,
      false,
      'acquireSet() now returns a success itself — then this test no longer says anything about the routes',
    );

    // ── 2. The stream: the `done` event ───────────────────────────────────
    //
    // What is set up is EXACTLY the form that acquireSet()
    // returns for a new set.
    posedAddSet = async e => ({
      action: 'added',
      set_number: e.setNumber,
      name: 'Testset',
      catalog_pending: true,
      supplement: 'pending',
      owner: e.requester,
    });
    const prior = positionCalled;

    const stream = await fetch(`${base}/api/v2/sets/add-stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set_number: NEW_A, quantity: 1 }),
    });
    assert.equal(stream.status, 200);
    assert.match(
      stream.headers.get('content-type') || '',
      /text\/event-stream/,
      'for a new set it must be the event stream, not the JSON form',
    );
    const raw = await stream.text();
    assert.ok(positionCalled > prior, 'acquireSet() was not called — the stub does not apply, the test checks nothing');

    const eventList = raw
      .split('\n')
      .filter(z => z.startsWith('data:'))
      .map(z => {
        try {
          return JSON.parse(z.slice(5).trim());
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const done = eventList.find(e => e.step === 'done');
    assert.ok(done, `no done event in the stream: ${raw}`);

    // THE assertion. `=== true` and not `.ok()`: a missing field is
    // `undefined` and would have slipped through with a soft check — exactly
    // the state that Marco reported.
    assert.equal(
      done.success,
      true,
      'the done event carries no success:true — the Android app then aborts ' +
        'when creating EVERY new set, although the set was created',
    );
    assert.equal(done.action, 'added');
    assert.equal(done.set_number, NEW_A);

    // ── 3. The token route with the same result ───────────────────────────
    const before2 = positionCalled;
    const token = await fetch(`${base}/api/v2/sets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ set_number: NEW_B, quantity: 1 }),
    });
    assert.equal(token.status, 200);
    const tb = await token.json();
    assert.ok(positionCalled > before2, 'acquireSet() was not called on the token route');
    assert.equal(tb.success, true);

    // ── 4. One response, one form ──────────────────────────────────────────
    //
    // Both paths pass THE SAME result through. If their forms
    // drift apart, it depends on the chosen path again whether a client can read the
    // response — and that was the error.
    const fields = o =>
      Object.keys(o)
        .filter(k => k !== 'step')
        .sort();
    assert.deepEqual(
      fields(done),
      fields(tb),
      `stream ${JSON.stringify(fields(done))} versus token route ` +
        `${JSON.stringify(fields(tb))} — the same information in two shapes`,
    );

    // 5. The app demands nothing that the server does not send: the required fields of its
    // model (shared/app-interface.json, generated from its source text).
    const model = require('./helpers/contract').appInterface().models.AddSetResponse;
    assert.ok(model && model.fields.length >= 5, 'model AddSetResponse not found — renamed?');
    const lines = model.fields.map(name => ({ name, required: model.required.includes(name) }));

    const delivered = new Set([...Object.keys(done), ...Object.keys(tb)]);
    const requiredAndMissing = lines.filter(f => f.required && !delivered.has(f.name)).map(f => f.name);
    assert.deepEqual(
      requiredAndMissing,
      [],
      'AddSetResponse requires fields that do not arrive when a new set is ' +
        'created:\n  ' +
        requiredAndMissing.join('\n  ') +
        '\nkotlinx.serialization then aborts, and the app reports an error ' +
        'for a set that was created. Either the server sends the field, ' +
        'or it gets a default value — „field missing" is not a statement.',
    );
  } finally {
    posedAddSet = null;
    await cleanUp();
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
