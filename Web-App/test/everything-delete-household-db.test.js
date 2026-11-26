/**
 * “Delete all my sets" deletes MY sets — not those of the household.
 *
 * The login is enough, no password (docs/SICHERHEIT.md). Counter-check (measured 26.11.2026):
 * a password check back into DELETE /inventory → red: “delete everything …” (success false).
 * Counter-checks (22.11.2026, each alone):
 *   A  deleteSetFor ignores the account selection (chosen = writable) → red “accounts can only narrow …”
 *      (own deletes the sub-account's set too). Without the cut against writeScope it stays green: no
 *      view reaches beyond the write scope today (household-db), the cut only guards that.
 *   B  deleteAll deletes the sets in writeScope(uid) instead of [uid] → red “delete everything …”
 *   C  btn-dall lists /v2/sets and deletes set by set again → red “the button leaves the choice …”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (content is emptied!).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');
const db = testData();
test.after(() => db.pool.end().catch(() => {}));

async function reachable() {
  try {
    await db.get('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

test('delete everything does not touch the linked accounts', async t => {
  if (!(await reachable())) {
    noDb(t);
    return;
  }
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchemaOnce();
  // And the MIGRATIONS, not only the schema
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }

  const PASS = 'eigenes-Passwort-1';
  await db.run(`INSERT INTO users (username, password_hash) VALUES ('haupt', $1), ('kind','x')`, [
    require(path.join(ROOT, 'node_modules', 'bcryptjs')).hashSync(PASS, 4),
  ]);
  const main = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  const kind = (await db.get(`SELECT id FROM users WHERE username='kind'`)).id;
  await db.run(`INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)`, [main, kind]);

  // BOTH own 75192-1 — that is the case that a check for
  // “foreign set numbers stay" alone does not catch.
  await holdsSet(db, main, '75192-1', 1);
  await holdsSet(db, kind, '75192-1', 1);
  await holdsSet(db, kind, '21318-1', 1);
  await holdsPart(db, kind, '3001', { setNumber: '21318-1', quantity: 10, colorId: 4 });
  await holdsMinifig(db, kind, 'fig1', { setNumber: '21318-1', quantity: 1 });
  // Manual elements on both sides: the child's must stay.
  await holdsPart(db, kind, '3003', { colorId: 1, quantity: 2 });
  await holdsMinifig(db, kind, 'fig2', { quantity: 1 });
  await holdsPart(db, main, '3004', { colorId: 1, quantity: 2 });

  const { base } = testServer(_req, { session: { userId: main, username: 'haupt' }, t });
  const hole = async (path, method = 'GET', body) =>
    (
      await fetch(base + path, {
        method: method,
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      })
    ).json();

  // Exactly the call from public/js/settings.js (btn-dall): without a body.
  const r = await hole('/api/v2/inventory', 'DELETE');
  assert.equal(r.success, true, JSON.stringify(r));
  assert.deepEqual([r.sets, r.parts, r.minifigs], [1, 1, 0], 'Only the own account is counted');

  const mine = await db.all(`SELECT set_number FROM sets WHERE user_id=$1`, [main]);
  assert.deepEqual(mine, [], 'The own sets must be gone');

  const seine = await db.all(`SELECT set_number FROM sets WHERE user_id=$1 ORDER BY set_number`, [kind]);
  assert.deepEqual(
    seine.map(r => r.set_number),
    ['21318-1', '75192-1'],
    'The linked account keeps ALL its sets — including the shared number',
  );
  const parts = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1`, [kind]);
  const minifigs = await db.get(`SELECT COUNT(*)::int c FROM minifigs WHERE user_id=$1`, [kind]);
  assert.equal(parts.c, 2, 'Parts of the linked account stay (from the set and manual)');
  assert.equal(minifigs.c, 2, 'Minifigs of the linked account stay (from the set and manual)');
  const myParts = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1`, [main]);
  assert.equal(myParts.c, 0, 'The own manual part must be gone');
});

test('accounts can only narrow the delete scope, never widen it', async t => {
  // Runs after the test above on the same schema: haupt → kind is linked.
  if (!(await reachable())) {
    noDb(t);
    return;
  }
  const id = async n => (await db.get('SELECT id FROM users WHERE username = $1', [n])).id;
  const [main, kind] = [await id('haupt'), await id('kind')];
  for (const u of [main, kind]) await holdsSet(db, u, '10001-1', 1);
  const owners = async () =>
    (await db.all(`SELECT user_id FROM sets WHERE set_number = '10001-1' ORDER BY user_id`)).map(r => r.user_id);
  const del = async (who, q) => {
    const { base, srv } = testServer(_req, { session: { userId: who, username: String(who) } });
    try {
      return await fetch(`${base}/api/v2/sets/10001-1${q}`, { method: 'DELETE' }).then(r => r.json());
    } finally {
      srv.close();
    }
  };
  // The sub-account sees the main account's set, but may not write there.
  await del(kind, '?accounts=all');
  assert.deepEqual(await owners(), [main], 'the view widened the delete into the main account');
  await holdsSet(db, kind, '10001-1', 1);
  await del(main, '?accounts=own');
  assert.deepEqual(await owners(), [kind], 'own narrows to the own account');
});

test('the button leaves the choice to the server', async () => {
  // Real bundle in jsdom: the button only asks yes or no and leaves listing and deleting to
  // DELETE /v2/inventory (what the server does with it: the test above).
  const { openUi, waitFor } = require('./helpers/ui');
  const { w, d, calls } = await openUi({
    '/v2/inventory': { success: true, sets: 1, parts: 0, minifigs: 0, trash: [] },
  });
  try {
    d.getElementById('btn-dall').click();
    assert.ok(await waitFor(() => d.getElementById('confirm-modal').style.display === 'flex'));
    d.getElementById('cd-confirm').click();
    assert.ok(await waitFor(() => calls.some(a => a.method === 'DELETE')));
    const deletes = calls.filter(a => a.method === 'DELETE');
    assert.deepEqual(
      deletes.map(a => [a.url.replace(/^https?:\/\/[^/]+/, ''), a.body ?? null]),
      [['/api/v2/inventory', null]],
    );
  } finally {
    w.close();
  }
});
