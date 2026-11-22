/**
 * Household — link accounts.
 *
 * The rules in code and schema; what can be executed runs against the
 * database here or in household-db.test.js.
 *
 * Counter-checks (measured 08.11.2026, each reverted):
 *   A  createInvitation stores the code instead of its hash → red “the
 *      invitation code is only stored as a hash …”
 *   B  mayWriteFor asks householdOf() instead of the link → red
 *      “write rights never come from memory”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('invitation and write right against the database', { concurrency: 1 }, async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dataOrSkip(t, _req);
  if (!db) return;
  const hh = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const namen = [`hh_haupt_${process.pid}`, `hh_unter_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [n])).id);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    hh.reportHouseholdChange();
    await db.pool.end().catch(() => {});
  });

  await t.test('an account does not link with itself', async () => {
    // Several parent accounts are allowed (migration 0046); the schema forbids linking
    // with oneself. Counter-check (09.11.2026): rule account_links_no_self removed → red.
    await assert.rejects(
      db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $1)', [ids[0]]),
      (/** @type {any} */ e) => e.code === '23514',
    );
  });

  await t.test('the invitation code is only stored as a hash in the database', async () => {
    // As with API tokens: whoever reads the database should not be able to redeem an invitation.
    // Like a request of the account: invitations stand under its row security.
    const { code } = await require('./helpers/sources').asAccount(ids[0], () => hh.createInvitation(ids[0]));
    assert.ok(code, 'kein Code erzeugt');
    const zeilen = await db.all('SELECT token_hash FROM account_link_invites WHERE main_user_id = $1', [ids[0]]);
    assert.equal(zeilen.length, 1);
    assert.notEqual(zeilen[0].token_hash, code, 'Der Code steht im Klartext in der Datenbank');
    const roh = code.replace(/[\s-]/g, '').toUpperCase();
    assert.ok(!zeilen[0].token_hash.toUpperCase().includes(roh), 'Der Code steht (umformatiert) in der Datenbank');
    assert.match(zeilen[0].token_hash, /^[0-9a-f]{64}$/, 'Gespeichert wird ein SHA-256-Hash');
  });

  await t.test('write rights never come from memory', async () => {
    // The view is remembered (household-memory-db.test.js); about a
    // write access only the state of the database may decide.
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [ids[0], ids[1]]);
    hh.reportHouseholdChange();
    // Under the main account's row security: the runtime role does not see foreign links (0121).
    const als = (uid, f) => require('./helpers/sources').asAccount(uid, f);
    assert.deepEqual(
      (await als(ids[0], () => hh.householdOf(ids[0]))).memberIds,
      ids,
      'Vorbedingung: das Unterkonto ist gemerkt',
    );
    assert.equal(await als(ids[0], () => hh.mayWriteFor(ids[0], ids[1])), true);
    // Unlinked from outside without this process hearing of it.
    await db.run('DELETE FROM account_links WHERE main_user_id = $1', [ids[0]]);
    assert.deepEqual(
      (await als(ids[0], () => hh.householdOf(ids[0]))).memberIds,
      ids,
      'Vorbedingung: das Gedächtnis ist noch alt',
    );
    assert.equal(
      await als(ids[0], () => hh.mayWriteFor(ids[0], ids[1])),
      false,
      'mayWriteFor entscheidet nach dem gemerkten Blickfeld',
    );
    assert.deepEqual(
      await als(ids[0], () => hh.writeScope(ids[0])),
      [ids[0]],
      'schreibbereich entscheidet nach dem gemerkten Blickfeld',
    );
    assert.equal(await als(ids[1], () => hh.mayWriteFor(ids[1], ids[1])), true, 'Eigene Daten immer');
  });
});

test('web app and app get the same endpoints', () => {
  // Stage 6: the four household routes now exist only once, under
  // /api/v1; the web app calls the same address (requireToken takes both
  // credentials). Previously this check spanned TWO files and required
  // that both offer everything — the weaker version of the same statement.
  const src = read('routes/api/settings.ts');
  for (const fn of ['householdStatus', 'createInvitation', 'joinHousehold', 'unlinkAccounts']) {
    assert.ok(src.includes(fn), `routes/api/settings.ts: ${fn} fehlt`);
  }
  // And the second version must not come back: every household route exactly once.
  for (const path of [
    "/api/v2/settings/household'",
    "/api/v2/settings/household/invite'",
    "/api/v2/settings/household/redeem'",
    "/api/v2/settings/household/unlink'",
  ])
    assert.equal(src.split(path).length - 1, 1, `${path} steht nicht genau einmal in routes/api/settings.ts`);
  // No own rule in the route — they are in src/household/household.ts.
  assert.doesNotMatch(src, /account_links/, 'Routen dürfen nicht selbst gegen account_links abfragen');
});

// ═══════════════════════════════════════════════════════════════════════════
// Household view: lists, finances, moving, write rights
// ═══════════════════════════════════════════════════════════════════════════

test("the household's portfolio curve is retroactive", () => {
  // The statement stays, the way there has changed: the
  // portfolio snapshots ('__portfolio__<id>') no longer exist. They
  // lay at different times per account — added up they would yield
  // drops that never happened — and they recorded what WAS …
  const p = require('./helpers/sources').portfolioSource();
  assert.doesNotMatch(
    p,
    /__portfolio__/,
    'Der Schnappschuss-Weg ist zurück — er kann weder rückwirkend rechnen ' +
      'noch den heutigen Bestand über die Zeit zeigen',
  );
  assert.match(p, /GROUP BY s\.set_number/, 'Dasselbe Set in zwei Konten darf nicht doppelt in die Summe');
  assert.match(p, /FROM price_history ph/, 'Die Kurve muss aus dem Preisverlauf je Set entstehen');
});

test('moving ONLY goes via the purchase price', async () => {
  // Moving a set as a whole sounds convenient but hides what
  // actually moves: three entries are three purchases that in the household
  // may belong to different children. Whoever wants to move everything changes
  // every row — and sees how many there are in doing so. …
  const { moveSet } = require('./helpers/sources').areaPage('sets');
  await assert.rejects(
    moveSet(1, '10294-1', 1, 2, []),
    (/** @type {any} */ e) => e.kind === 'ungueltig' && e.code === 'purchase_prices_required',
    'move ohne acquisition_ids muss abgelehnt werden',
  );

  // And the UI does not even offer it.
  assert.doesNotMatch(require('./helpers/sources').adminSource(), /renderMoveBox|moveSetToAccount/);
  assert.doesNotMatch(read('public/index.html'), /m-move-box/);
});

/**
 * What this rule checks, and what NOT
 */
