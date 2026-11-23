/**
 * Household against a REAL database.
 *
 * Counter-checks for the household with several parent accounts (measured on 28.10.):
 *   A  mayWriteFor() again over all descendants → red: “rights only apply
 *      along a direct link"
 *   B  the check for a reverse link removed → red:
 *      “linking mutually is rejected"
 *   C  unlinkAccounts() ignores main_user_id → red: “an account can belong to several
 *      main accounts"
 *   D  the hint not deleted on redeeming → red: “the conversion separates
 *      chains and leaves a hint"
 *   E  (31.10.2026) the view filter applied in storageAccounts()
 *      (`scopeIds(uid, scopeKind(req.query.accounts))`) → red: “the
 *      storage locations of a sub-account follow the right …”
 *
 * Prerequisite: test DB (content is emptied!) via TEST_DATABASE_URL,
 * default postgres://tester:test@localhost/cattest. Without DB: skip.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));
const { holdsMinifig, holdsSet, holdsPart, quantityOf, catalogSet } = require('./helpers/inventory');

/**
 * Call the REAL move route — with an injected session, as in
 * test/api-parity.test.js. The path via the route is the point: rights check,
 * lock and merging only come together there; rebuilding them in the test
 * would mean checking something other than what runs in production.
 */
let _srv, _base;
async function startApi() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: _actingAs };
    next();
  });
  // Since an earlier round the entry routes only live in the shared
  // factory — one address for web app AND app.
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  _srv = app.listen(0);
  _base = `http://localhost:${_srv.address().port}`;
}
let _actingAs = null;
async function apiGet(actor, path) {
  _actingAs = actor;
  const r = await fetch(_base + path);
  return { status: r.status, body: await r.json().catch(() => null) };
}
/**
 * Moving ONLY goes via the purchase prices: acquisition_ids is required.
 * Without input this helper fetches all rows of the sender — “the whole set"
 * now means “all its purchase prices", and that is exactly how it should look in the
 * UI too.
 */
async function moveSet(actor, sn, fromId, toId, acquisitionIds) {
  _actingAs = actor;
  const ids =
    acquisitionIds ??
    (await db.all('SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [fromId, sn])).map(r => r.id);
  const r = await fetch(`${_base}/api/v2/sets/${sn}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from_user_id: fromId, to_user_id: toId, acquisition_ids: ids }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

const U = {}; // eltern, kindA, kindB, fremd

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  // initSchema() only creates the base tables; account_links and
  // account_link_invites come from db/migrations/0005. Without this step
  // the test would run against a schema that does not exist in production.
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }

  // 'enkel' (U.grandchild) hangs on kindA: this allows checking that rights are not
  // passed on along a chain. The user names are data the messages and the sorting show.
  for (const [key, name] of [
    ['parents', 'eltern'],
    ['kindA', 'kindA'],
    ['kindB', 'kindB'],
    ['fremd', 'fremd'],
    ['grandchild', 'enkel'],
  ]) {
    await db.run(`INSERT INTO users (username, password_hash) VALUES ($1,'x')`, [name]);
    U[key] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
  // All in the same currency — otherwise linking rejects (own test).
  for (const id of Object.values(U)) {
    await db.run(
      `INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency','CHF')
                  ON CONFLICT (user_id,key) DO UPDATE SET value='CHF'`,
      [id],
    );
  }
}

/** Create set + entry for an account. */
async function giveSet(uid, sn, qty, price, cond = 'N', day = null) {
  // Only the stock row. The quantity is carried by the entry further below
  // (addPurchaseAtTag) — since migration 0036 the only place. The
  // formerly needed `DO UPDATE SET quantity = sets.quantity + $3` is thus
  // dropped: two calls for the same set now add up because
  // TWO entries are created.
  await holdsSet(db, uid, sn, 0, { anywayIfDa: true });
  // Since migration 0033 the name belongs in the catalog, and for every set in the
  // stock a row MUST stand there (the migration fills it in and
  // checks that). So the template creates the situation that really exists.
  await catalogSet(db, sn, { name: 'Set ' + sn, year: 2020 });
  // `cond` only goes into the entry — the sets row has had no condition column
  // since migration 0032.
  await _req('src/inventory/acquisitions.js').addPurchaseAtTag('set', uid, [sn], {
    quantity: qty,
    price,
    condition: cond,
    createdAt: day,
  });
}

test('household against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }
  await seed();
  await startApi();

  const household = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const handlers = require('./helpers/sources').handlerModule(_req);

  await t.test('linking needs both sides and the same currency', async () => {
    const inv = await household.createInvitation(U.parents);
    assert.ok(inv.code, 'no code created');

    // Other currency → rejection, and the code stays usable.
    await db.run(`UPDATE user_settings SET value='EUR' WHERE user_id=$1 AND key='currency'`, [U.kindA]);
    // On the CODE instead of the German sentence: only the response builds the sentence.
    await assert.rejects(household.redeemInvitation(U.kindA, inv.code), { code: 'currency_mismatch' });

    await db.run(`UPDATE user_settings SET value='CHF' WHERE user_id=$1 AND key='currency'`, [U.kindA]);
    const ok = await household.redeemInvitation(U.kindA, inv.code);
    assert.equal(ok.linked_to.id, U.parents);

    // A second redemption of the same code must fail.
    await assert.rejects(household.redeemInvitation(U.kindB, inv.code), { code: /invite_code/ });

    const inv2 = await household.createInvitation(U.parents);
    assert.ok((await household.redeemInvitation(U.kindB, inv2.code)).linked_to);
  });

  await t.test('scope and account filter', async () => {
    const all = await household.scopeIds(U.parents, 'all');
    const own = await household.scopeIds(U.parents, 'own');
    const subs = await household.scopeIds(U.parents, 'subs');
    assert.deepEqual(
      [...all].sort((a, b) => a - b),
      [U.parents, U.kindA, U.kindB].sort((a, b) => a - b),
    );
    assert.deepEqual(own, [U.parents]);
    assert.deepEqual(
      [...subs].sort((a, b) => a - b),
      [U.kindA, U.kindB].sort((a, b) => a - b),
    );

    // A child only sees itself — even if it asks for 'all'.
    assert.deepEqual(await household.scopeIds(U.kindA, 'all'), [U.kindA]);
    assert.deepEqual(await household.scopeIds(U.kindA, 'subs'), [U.kindA]);

    // Writing: only the direction parent → own child.
    assert.equal(await household.mayWriteFor(U.parents, U.kindA), true);
    assert.equal(await household.mayWriteFor(U.kindA, U.kindB), false, 'Siblings may not');
    assert.equal(await household.mayWriteFor(U.kindA, U.parents), false, 'Child may not go into the parent account');
    assert.equal(await household.mayWriteFor(U.parents, U.fremd), false);
  });

  await t.test('rights only apply along a direct link', async () => {
    // After this block: eltern → kindA → enkel.
    const inv = await household.createInvitation(U.kindA);
    assert.ok(inv.code, 'A sub-account must be allowed to invite itself');
    await household.redeemInvitation(U.grandchild, inv.code);

    assert.deepEqual(await household.scopeIds(U.kindA, 'all'), [U.kindA, U.grandchild]);
    assert.ok(
      !(await household.scopeIds(U.parents, 'all')).includes(U.grandchild),
      'Via a chain „eltern“ must not see the account „enkel“ — „enkel“ only agreed to „kindA“',
    );
    assert.equal(
      await household.mayWriteFor(U.parents, U.grandchild),
      false,
      'Via a chain „eltern“ must not write at „enkel“',
    );
    assert.ok(!(await household.writeScope(U.parents)).includes(U.grandchild));
    assert.equal(await household.mayWriteFor(U.kindA, U.grandchild), true);
    assert.equal(await household.mayWriteFor(U.grandchild, U.kindA), false);
  });

  await t.test('the storage locations of a sub-account follow the right, not the view filter', async () => {
    _actingAs = U.kindA;
    const fresh = await fetch(`${_base}/api/v2/storage/locations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Kiste kindA' }),
    });
    assert.equal(fresh.status, 200, await fresh.text());
    const names = async accounts =>
      (await apiGet(U.parents, `/api/v2/storage/locations?owner=${U.kindA}&accounts=${accounts}`)).body.locations.map(
        o => o.name,
      );
    assert.deepEqual(await names('all'), ['Kiste kindA']);
    assert.deepEqual(
      await names('own'),
      ['Kiste kindA'],
      'The gallery on „nur eigene“ does not clear the selection for the child set',
    );
    assert.deepEqual(
      (await apiGet(U.parents, `/api/v2/storage/locations?owner=${U.grandchild}`)).body.locations,
      [],
      'No locations without the right, not via a chain either',
    );
  });

  await t.test('an account can belong to several main accounts', async () => {
    // enkel additionally accepts eltern's invitation: now eltern sees
    // it directly, with its own consent.
    const inv = await household.createInvitation(U.parents);
    await household.redeemInvitation(U.grandchild, inv.code);
    assert.ok((await household.scopeIds(U.parents, 'all')).includes(U.grandchild));
    assert.equal(await household.mayWriteFor(U.parents, U.grandchild), true);

    const st = await household.householdStatus(U.grandchild);
    assert.deepEqual(st.parents.map(p => p.username).sort(), ['eltern', 'kindA']);
    assert.equal(st.is_sub, true);
    assert.ok(st.linked_to, 'Older apps still need linked_to');

    // The same link a second time yields an understandable refusal.
    const again = (await household.createInvitation(U.parents)).code;
    await assert.rejects(household.redeemInvitation(U.grandchild, again), { code: 'account_already_linked' });

    // Unlinking from ONE parent account leaves the other in place.
    await household.unlinkAccounts(U.grandchild, null, U.parents);
    assert.deepEqual(
      (await household.householdStatus(U.grandchild)).parents.map(p => p.username),
      ['kindA'],
    );
    assert.equal(
      await household.mayWriteFor(U.parents, U.grandchild),
      false,
      'After unlinking the former parent account must no longer write',
    );
    assert.equal(await household.mayWriteFor(U.kindA, U.grandchild), true);
  });

  await t.test('linking mutually is rejected', async () => {
    // kindA is a sub-account of eltern. If eltern accepted an invitation from kindA,
    // both could write at the other.
    const inv = await household.createInvitation(U.kindA);
    await assert.rejects(household.redeemInvitation(U.parents, inv.code), { code: 'link_creates_cycle' });
    // The code is free again after the refusal.
    // The refusal did not use up the code.
    await household.redeemInvitation(U.fremd, inv.code);
    await household.unlinkAccounts(U.fremd);
  });

  await t.test('the conversion separates chains and leaves a hint', async () => {
    // eltern → kindA → enkel stands. Run the migration again as
    // it would run on an existing installation.
    const fs = require('node:fs');
    const sql = fs.readFileSync(path.join(ROOT, 'db/migrations/0046-haushalt-mehrere-eltern.sql'), 'utf8');
    await db.run('DELETE FROM household_former_links');
    await db.exec(sql);
    household.reportHouseholdChange();

    const st = await household.householdStatus(U.parents);
    assert.deepEqual(
      st.former_links.map(f => [f.username, f.via]),
      [['enkel', 'kindA']],
      '„eltern“ must learn that „enkel“ is no longer visible and through whom it went',
    );
    assert.ok(!st.view.some(m => m.username === 'enkel'));
    assert.deepEqual(
      (await household.householdStatus(U.kindA)).former_links,
      [],
      'Direct links are not separate chains',
    );

    // If enkel accepts the invitation, the hint disappears by itself.
    await household.redeemInvitation(U.grandchild, (await household.createInvitation(U.parents)).code);
    assert.deepEqual((await household.householdStatus(U.parents)).former_links, []);
    await household.unlinkAccounts(U.grandchild, null, U.parents);

    // Discarding only deletes the own hint.
    await db.exec(sql);
    assert.equal((await household.discardSeparated(U.kindB, U.grandchild)).removed, 0);
    assert.equal((await household.discardSeparated(U.parents, U.grandchild)).removed, 1);
    assert.deepEqual((await household.householdStatus(U.parents)).former_links, []);
  });

  await t.test('the same set in two accounts becomes ONE row', async () => {
    await giveSet(U.kindA, '75192-1', 1, 100);
    await giveSet(U.kindB, '75192-1', 2, 160);
    await giveSet(U.kindA, '10290-1', 1, 50);

    const r = await handlers.readSets(await household.scopeIds(U.parents, 'all'), {});
    const falcon = r.sets.filter(s => s.set_number === '75192-1');
    assert.equal(falcon.length, 1, 'Set appears several times');
    assert.equal(falcon[0].quantity, 3, 'Quantities not added');
    assert.equal(r.total, 2, 'Total counts accounts instead of sets');

    // Owner with names — otherwise only a number stands there.
    const owners = (falcon[0].owners || []).map(o => o.username).sort();
    assert.deepEqual(owners, ['kindA', 'kindB']);

    // Purchase price quantity-weighted: (1x100 + 2x160)/3 = 140
    assert.equal(Math.round(falcon[0].avg_purchase_price), 140);

    // Filter: the parent account's own view is empty, 'subs' shows both sets.
    assert.equal((await handlers.readSets(await household.scopeIds(U.parents, 'own'), {})).sets.length, 0);
    assert.equal((await handlers.readSets(await household.scopeIds(U.parents, 'subs'), {})).sets.length, 2);

    // And a child only sees its own.
    const kindB = await handlers.readSets(await household.scopeIds(U.kindB, 'all'), {});
    assert.deepEqual(
      kindB.sets.map(s => s.set_number),
      ['75192-1'],
    );
    assert.equal(kindB.sets[0].quantity, 2, 'Child sees the quantity of the sibling too');
    assert.equal(kindB.sets[0].owners, undefined, 'Owner badge does not belong in a single account');
  });

  await t.test('metrics follow the filter', async () => {
    const all = await handlers.getStats(await household.scopeIds(U.parents, 'all'));
    const own = await handlers.getStats(await household.scopeIds(U.parents, 'own'));

    // Why 2 stands here now and 3 before
    assert.equal(parseInt(all.total_sets, 10), 2, 'different sets in the household — as the gallery shows them');
    assert.equal(parseInt(all.total_quantity, 10), 4, 'Exemplare: 1 + 2 + 1');
    assert.equal(parseInt(own.total_sets, 10), 0);
  });

  await t.test('moving takes parts, minifigures and instructions along', async () => {
    // Create contents for kindA's set — plus a manually entered part
    // that explicitly must NOT move along.
    await holdsPart(db, U.kindA, '3001', { setNumber: '75192-1', quantity: 10, colorId: 4 });
    await holdsPart(db, U.kindA, '3002', { setNumber: '75192-1', quantity: 5, colorId: 1 });
    await holdsPart(db, U.kindA, '9999', { quantity: 3, colorId: 0 });
    await holdsMinifig(db, U.kindA, 'sw0001', { setNumber: '75192-1', quantity: 2 });
    await db.run(`INSERT INTO instructions (user_id,set_number,url) VALUES ($1,'75192-1','http://x/1.pdf')`, [U.kindA]);

    const r = await moveSet(U.parents, '75192-1', U.kindA, U.kindB);
    assert.equal(r.status, 200, `Move failed: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.merged, true, 'kindB already owned the set — merge expected');
    assert.equal(r.body.parts, 2);
    assert.equal(r.body.minifigs, 1);
    assert.equal(r.body.instructions, 1);

    // Arrived at the target …
    const atB = await db.get(`SELECT COUNT(*)::int AS n FROM parts WHERE user_id=$1 AND set_number='75192-1'`, [
      U.kindB,
    ]);
    assert.equal(atB.n, 2);
    // … gone from the source …
    const atA = await db.get(`SELECT COUNT(*)::int AS n FROM parts WHERE user_id=$1 AND set_number='75192-1'`, [
      U.kindA,
    ]);
    assert.equal(atA.n, 0, 'Parts stayed behind in the source account');
    // … and the manual part stayed.
    const manual = await db.get(`SELECT COUNT(*)::int AS n FROM parts WHERE user_id=$1 AND source='manual'`, [U.kindA]);
    assert.equal(manual.n, 1, 'a manually recorded part was moved along');

    // Since migration 0047 different prices stay separate rows: 2×160
    // from kindB and 1×100 from kindA — no mixed price 140.
    const rows = await db.all(
      `SELECT quantity, purchase_price FROM set_acquisitions
        WHERE user_id=$1 AND set_number='75192-1' ORDER BY purchase_price`,
      [U.kindB],
    );
    assert.deepEqual(
      rows.map(r => [parseInt(r.quantity, 10), Math.round(parseFloat(r.purchase_price))]),
      [
        [1, 100],
        [2, 160],
      ],
      'The single purchases must be kept when moving',
    );

    // In the household the set still stands once, now with one owner.
    const list = await handlers.readSets(await household.scopeIds(U.parents, 'all'), {});
    const falcon = list.sets.find(s => s.set_number === '75192-1');
    assert.equal(falcon.quantity, 3);
    assert.deepEqual(
      (falcon.owners || []).map(o => o.username),
      ['kindB'],
    );
  });

  await t.test('only whoever may write for both accounts may move', async () => {
    // A child into the neighboring account: forbidden although both are in the same household.
    const bad = await moveSet(U.kindB, '10290-1', U.kindA, U.kindB, [1]);
    assert.equal(bad.status, 403, `expected 403, was ${bad.status}`);
    // And the stock is untouched.
    const still = await db.get('SELECT COUNT(*)::int AS n FROM sets WHERE user_id=$1 AND set_number=$2', [
      U.kindA,
      '10290-1',
    ]);
    assert.equal(still.n, 1);
  });

  await t.test('the finance endpoints answer in EVERY account filter', async () => {
    // This check exists because exactly here a bug slipped through:
    // After switching to user_id = ANY($1) getSetting() got the
    // ID LIST instead of one ID, and all four endpoints answered with
    //   500 invalid input syntax for type integer: "{"2"}" …
    for (const mode of ['all', 'own', 'subs']) {
      const q = mode === 'all' ? '' : `?accounts=${mode}`;
      // Addresses under /api/v1 since stage 5 (merged) — the statement
      // of this test is unchanged: every endpoint answers in EVERY
      // account filter, and the currency comes from the asking account.
      for (const ep of [
        '/api/v2/finance/valuation',
        '/api/v2/finance/parts-valuation',
        '/api/v2/finance/minifigs-valuation',
        '/api/v2/finance/pnl',
        '/api/v2/finance/portfolio-history?period=month',
      ]) {
        const path = ep.includes('?') ? ep + q.replace('?', '&') : ep + q;
        const r = await apiGet(U.parents, path);
        assert.equal(r.status, 200, `${path} → ${r.status}: ${JSON.stringify(r.body)}`);
        assert.equal(r.body.success, true, `${path} reports no success`);
      }
    }
    // And the currency ALWAYS comes from the asking account, even if it does not
    // occur in the ID list at all (accounts=subs).
    await db.run(`UPDATE user_settings SET value='SEK' WHERE user_id=$1 AND key='currency'`, [U.parents]);
    const subs = await apiGet(U.parents, '/api/v2/finance/valuation?accounts=subs');
    assert.equal(subs.body.currency, 'SEK', 'The currency came from a sub-account instead of the asking account');
    await db.run(`UPDATE user_settings SET value='CHF' WHERE user_id=$1 AND key='currency'`, [U.parents]);
  });

  await t.test('unlinking leaves the data with the owner', async () => {
    await household.unlinkAccounts(U.parents, U.kindA);
    assert.deepEqual(await household.scopeIds(U.parents, 'all'), [U.parents, U.kindB]);
    // The child keeps its stock.
    const kindA = await handlers.readSets(await household.scopeIds(U.kindA, 'all'), {});
    assert.deepEqual(
      kindA.sets.map(s => s.set_number),
      ['10290-1'],
    );
    // And may be linked again afterwards.
    const inv = await household.createInvitation(U.parents);
    await household.redeemInvitation(U.kindA, inv.code);
  });

  await t.test('a single purchase price changes its owner', async () => {
    // The purchase price is the level at which a copy exists: a set with
    // three entries is three purchases that may belong to different children.
    // Here ONE row moves — the source keeps the rest including parts.
    await giveSet(U.kindA, '21318-1', 1, 200, 'N', '2026-01-05');
    await giveSet(U.kindA, '21318-1', 1, 240, 'N', '2026-02-05');
    await holdsPart(db, U.kindA, '3020', { setNumber: '21318-1', quantity: 4, colorId: 2 });
    await holdsMinifig(db, U.kindA, 'fig-tree', { setNumber: '21318-1', quantity: 1 });
    await db.run(
      `INSERT INTO instructions (user_id,set_number,url)
                  VALUES ($1,'21318-1','http://x/tree.pdf')`,
      [U.kindA],
    );

    const acqs = await db.all(
      `SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number='21318-1'
        ORDER BY created_at ASC`,
      [U.kindA],
    );
    assert.equal(acqs.length, 2);

    _actingAs = U.parents;
    const r = await fetch(`${_base}/api/v2/sets/21318-1/acquisitions/${acqs[0].id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: U.parents, from_user_id: U.kindA }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, JSON.stringify(body));
    assert.equal(body.source_emptied, false, 'the source keeps a copy');

    // Quantities match on both sides …
    // From the entries (migration 0036) — the column no longer exists.
    const qty = async uid => await quantityOf(db, uid, '21318-1');
    assert.equal(await qty(U.kindA), 1, 'Source not counted down');
    assert.equal(await qty(U.parents), 1);

    // … the purchase prices are one per account …
    const links = await db.all(
      `SELECT user_id, purchase_price FROM set_acquisitions WHERE set_number='21318-1'
        ORDER BY user_id`,
    );
    assert.equal(links.length, 2, 'Acquisition was duplicated instead of moved');

    // … and the parts now stand at BOTH: the source keeps its copy,
    // the target gets a copy. Re-hanging would have left the source with a
    // copy without parts.
    // If ONE purchase price of two is re-hung, EVERYTHING in both accounts must …
    const inBoth = async table => {
      const n = async uid =>
        (await db.get(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id=$1 AND set_number='21318-1'`, [uid])).n;
      return { source: await n(U.kindA), target: await n(U.parents) };
    };
    for (const table of ['sets', 'parts', 'minifigs', 'instructions']) {
      const r = await inBoth(table);
      assert.equal(r.source, 1, `${table}: source lost the entry despite a remaining copy`);
      assert.equal(r.target, 1, `${table}: target got no entry`);
    }
    // And EXACTLY once per account — duplicate rows were counted twice by the
    // parts summary, the quantity is in sets.quantity.
    const twice = await db.get(
      `SELECT COUNT(*)::int AS n FROM parts
        WHERE set_number='21318-1' AND user_id=$1 AND part_number='3020'`,
      [U.parents],
    );
    assert.equal(twice.n, 1, 'Parts were copied several times');
  });

  await t.test('a sub-account may not reassign a purchase price', async () => {
    const acq = await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number='21318-1' LIMIT 1`, [
      U.kindA,
    ]);
    _actingAs = U.kindA;
    const r = await fetch(`${_base}/api/v2/sets/21318-1/acquisitions/${acq.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: U.kindB, from_user_id: U.kindA }),
    });
    assert.equal(r.status, 403, 'Sibling move was allowed');
  });

  await t.test('the owner change takes the ROW, not the viewer', async () => {
    // Where this test comes from
    await giveSet(U.kindB, '31120-1', 1, 80);
    const acq = await db.get(`SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number='31120-1'`, [U.kindB]);

    // EXACTLY the old web app request: viewer (eltern) as from_user_id,
    // although the row belongs to kindB. Must arrive anyway now.
    _actingAs = U.parents;
    const r = await fetch(`${_base}/api/v2/sets/31120-1/acquisitions/${acq.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: U.parents, from_user_id: U.parents }),
    });
    const body = await r.json();
    assert.equal(r.status, 200, `Row of a sub-account was not reachable: ${JSON.stringify(body)}`);
    assert.equal(body.from_user_id, U.kindB, 'The sender must come from the row, not from the request');
    const owner = await db.get(`SELECT user_id FROM set_acquisitions WHERE set_number='31120-1'`);
    assert.equal(parseInt(owner.user_id, 10), U.parents, 'The row did not arrive');

    // The direction check stays: the row now belongs to eltern — kindB may
    // NOT fetch it back, not even with a brazenly matching from_user_id.
    _actingAs = U.kindB;
    const back = await fetch(`${_base}/api/v2/sets/31120-1/acquisitions/${acq.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: U.kindB, from_user_id: U.parents }),
    });
    // 403 (foreign row) or 404 (the row ID may have been reassigned in the
    // target on merging) — the main thing: no success.
    assert.ok(
      [403, 404].includes(back.status),
      `A sub-account could pull from the main account (status ${back.status})`,
    );
    const later = await db.get(`SELECT user_id FROM set_acquisitions WHERE set_number='31120-1'`);
    assert.equal(parseInt(later.user_id, 10), U.parents, 'The row moved back');
  });

  await t.test('the filter knows individual accounts — and also applies to manual entries', async () => {
    // The filter lists every sub-account by name. On the server that means:
    // accounts=<id>. A FOREIGN ID must not get through — otherwise the
    // filter would be an access path instead of a view aid.
    assert.deepEqual(await household.scopeIds(U.parents, U.kindA), [U.kindA]);
    assert.deepEqual(
      await household.scopeIds(U.parents, U.fremd),
      await household.scopeIds(U.parents, 'all'),
      'an ID outside the accounts must fall back to the whole view',
    );
    // A sub-account thus cannot look into the sibling account: kindB
    // is not in its view, so the foreign ID falls back — to
    // kindA's OWN view, which contains its sub-account enkel.
    // What is checked is the statement, not the list: what matters is that kindB
    // does not occur in it.
    const fromViewKindA = await household.scopeIds(U.kindA, U.kindB);
    assert.ok(!fromViewKindA.includes(U.kindB), 'The filter must not open a sibling account');
    assert.deepEqual(
      fromViewKindA,
      await household.scopeIds(U.kindA, 'all'),
      'A foreign ID must fall back to the own view',
    );

    // Manually entered parts and minifigures hang on their own endpoints —
    // it was reported that the filter does not apply there.
    await holdsPart(db, U.kindA, 'm-A', { quantity: 1, colorId: 0 });
    await holdsPart(db, U.kindB, 'm-B', { quantity: 1, colorId: 0 });
    await holdsMinifig(db, U.kindA, 'mf-A', { quantity: 1 });
    await holdsMinifig(db, U.kindB, 'mf-B', { quantity: 1 });

    const numbers = rows => rows.map(r => r.part_number ?? r.fig_number);
    const onlyA = numbers(await handlers.manualPartsList(await household.scopeIds(U.parents, U.kindA)));
    const everyone = numbers(await handlers.manualPartsList(await household.scopeIds(U.parents, 'all')));
    // kindA still has a manual part ('9999') from an earlier test —
    // hence check for containment instead of the exact list.
    assert.ok(onlyA.includes('m-A'), 'own part is missing');
    assert.ok(!onlyA.includes('m-B'), 'the filter shows the part of the sibling account');
    assert.ok(everyone.includes('m-A') && everyone.includes('m-B'), 'without a filter both must appear');

    const figsA = numbers(await handlers.readManualMinifigs(await household.scopeIds(U.parents, U.kindA)));
    assert.ok(figsA.includes('mf-A'));
    assert.ok(!figsA.includes('mf-B'), 'the filter shows the minifig of the sibling account');
  });

  await t.test('a set can NOT be moved as a whole', async () => {
    // Moving goes via the purchase price. Without acquisition_ids the route answers
    // with 400 — the rule does not depend on the UI but on the
    // server: a client that bypasses it gets no exception.
    _actingAs = U.parents;
    const r = await fetch(`${_base}/api/v2/sets/10290-1/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from_user_id: U.kindA, to_user_id: U.parents }),
    });
    assert.equal(r.status, 400, 'Moving without purchase prices was allowed');
    const body = await r.json();
    assert.equal(body.code, 'purchase_prices_required');
  });

  await t.test('writing into a foreign account — the direction decides', async () => {
    // Why this check stands here

    /** Create via the v1 factory, with a chosen target account. */
    async function create(actor, path, payload) {
      _actingAs = actor;
      const r = await fetch(_base + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    }

    // Own numbers not used anywhere else: the previous checks create
    // 3001/3002/sw0001 for kindA. With the same numbers this check would count
    // foreign rows and would have turned red for the wrong reason.
    const cases = [
      {
        name: 'Teile',
        path: '/api/v2/parts',
        payload: { part_number: '99991', color_id: 4, quantity: 1 },
        table: 'parts',
        where: `part_number='99991'`,
      },
      {
        name: 'Minifiguren',
        path: '/api/v2/minifigs',
        payload: { fig_number: 'zz9999', quantity: 1 },
        table: 'minifigs',
        where: `fig_number='zz9999'`,
      },
    ];

    const count = (tableName, where, uid) =>
      db.get(`SELECT COUNT(*)::int AS c FROM ${tableName} WHERE ${where} AND user_id=$1`, [uid]).then(r => r.c);

    for (const f of cases) {
      // 1. Main account → own sub-account: allowed, and it lands THERE.
      const hin = await create(U.parents, f.path, { ...f.payload, owner_user_id: U.kindA });
      assert.equal(hin.status, 200, `${f.name}: main account was not allowed to write into its own sub-account`);
      assert.equal(await count(f.table, f.where, U.kindA), 1, `${f.name}: it did not land at the chosen account`);
      assert.equal(
        await count(f.table, f.where, U.parents),
        0,
        `${f.name}: it landed at the sender instead of the target account`,
      );

      // 2. Sub-account → sibling account: forbidden. “Is in the view"
      //    does NOT suffice — kindA and kindB do not even see each other.
      const landscape = await create(U.kindA, f.path, { ...f.payload, owner_user_id: U.kindB });
      assert.equal(landscape.status, 403, `${f.name}: sub-account wrote into the sibling account`);

      // 3. Sub-account → main account: forbidden. The direction is ONE.
      const backward = await create(U.kindA, f.path, { ...f.payload, owner_user_id: U.parents });
      assert.equal(backward.status, 403, `${f.name}: sub-account wrote into the main account`);

      // 4. Account from outside the household: forbidden.
      const fremd = await create(U.fremd, f.path, { ...f.payload, owner_user_id: U.parents });
      assert.equal(fremd.status, 403, `${f.name}: a foreign account wrote into the household`);

      // 5. And in NONE of the three rejected cases may something silently be created —
      //    neither at the target nor at the sender. Exactly that is the difference
      //    between “403" and “secretly writes into the own account".
      assert.equal(
        await count(f.table, f.where, U.kindB),
        0,
        `${f.name}: despite 403 something was created at the target account`,
      );
      assert.equal(
        await count(f.table, f.where, U.fremd),
        0,
        `${f.name}: despite 403 something was created at the foreign account`,
      );

      await db.run(`DELETE FROM ${f.table} WHERE ${f.where}`);
    }

    // Without input it stays with the own account — the normal case must not
    // change through the check.
    const without = await create(U.kindA, '/api/v2/parts', { part_number: '99992', color_id: 4, quantity: 1 });
    assert.equal(without.status, 200);
    assert.equal(
      await count('parts', `part_number='99992'`, U.kindA),
      1,
      'Without owner_user_id it must land at the recorder',
    );
    await db.run(`DELETE FROM parts WHERE part_number='99992'`);
  });

  await t.test('clean up', async () => {
    _srv?.close();
    await db.pool.end().catch(() => {});
  });
});
