/**
 * “Delete all my sets" deletes MY sets — not those of the household.
 *
 * Counter-check (measured 01.11.2026): bestaetigePasswort() removed from DELETE /bestand
 * → red: “deleted without password” (code missing in the response).
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

async function erreichbar() {
  try {
    await db.get('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

test('delete everything does not touch the linked accounts', async t => {
  if (!(await erreichbar())) {
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
  const haupt = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  const kind = (await db.get(`SELECT id FROM users WHERE username='kind'`)).id;
  await db.run(`INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)`, [haupt, kind]);

  // BOTH own 75192-1 — that is the case that a check for
  // “foreign set numbers stay" alone does not catch.
  await holdsSet(db, haupt, '75192-1', 1);
  await holdsSet(db, kind, '75192-1', 1);
  await holdsSet(db, kind, '21318-1', 1);
  await holdsPart(db, kind, '3001', { setNumber: '21318-1', quantity: 10, colorId: 4 });
  await holdsMinifig(db, kind, 'fig1', { setNumber: '21318-1', quantity: 1 });
  // Manual elements on both sides: the child's must stay.
  await holdsPart(db, kind, '3003', { colorId: 1, quantity: 2 });
  await holdsMinifig(db, kind, 'fig2', { quantity: 1 });
  await holdsPart(db, haupt, '3004', { colorId: 1, quantity: 2 });

  const { base } = testServer(_req, { sitzung: { userId: haupt, username: 'haupt' }, t });
  const hole = async (path, methode = 'GET', body) =>
    (
      await fetch(base + path, {
        method: methode,
        ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      })
    ).json();

  // Without a password everything stays: a captured app token alone should not delete everything.
  const ohne = await hole('/api/v2/inventory', 'DELETE');
  assert.equal(ohne.code, 'current_password_wrong', JSON.stringify(ohne));
  assert.equal(
    (await db.all('SELECT 1 FROM sets WHERE user_id = $1', [haupt])).length,
    1,
    'deleted without a password',
  );

  // Exactly the call from public/js/settings.js (btn-dall).
  const r = await hole('/api/v2/inventory', 'DELETE', { password: PASS });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.deepEqual([r.sets, r.parts, r.minifigs], [1, 1, 0], 'Only the own account is counted');

  const mine = await db.all(`SELECT set_number FROM sets WHERE user_id=$1`, [haupt]);
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
  const myParts = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1`, [haupt]);
  assert.equal(myParts.c, 0, 'The own manual part must be gone');
});

test('accounts can only narrow the delete scope, never widen it', async t => {
  // Runs after the test above on the same schema: haupt → kind is linked.
  if (!(await erreichbar())) {
    noDb(t);
    return;
  }
  const id = async n => (await db.get('SELECT id FROM users WHERE username = $1', [n])).id;
  const [haupt, kind] = [await id('haupt'), await id('kind')];
  for (const u of [haupt, kind]) await holdsSet(db, u, '10001-1', 1);
  const owners = async () =>
    (await db.all(`SELECT user_id FROM sets WHERE set_number = '10001-1' ORDER BY user_id`)).map(r => r.user_id);
  const del = async (who, q) => {
    const { base, srv } = testServer(_req, { sitzung: { userId: who, username: String(who) } });
    try {
      return await fetch(`${base}/api/v2/sets/10001-1${q}`, { method: 'DELETE' }).then(r => r.json());
    } finally {
      srv.close();
    }
  };
  // The sub-account sees the main account's set, but may not write there.
  await del(kind, '?accounts=all');
  assert.deepEqual(await owners(), [haupt], 'the view widened the delete into the main account');
  await holdsSet(db, kind, '10001-1', 1);
  await del(haupt, '?accounts=own');
  assert.deepEqual(await owners(), [kind], 'own narrows to the own account');
});

test('the button leaves the choice to the server', async () => {
  // Real bundle in jsdom: the button only asks for the password and leaves listing and deleting to
  // DELETE /v2/inventory (what the server does with it: the test above).
  const { openUi, warte } = require('./helpers/ui');
  const { w, d, aufrufe } = await openUi({
    '/v2/inventory': { success: true, sets: 1, parts: 0, minifigs: 0, trash: [] },
  });
  try {
    d.getElementById('btn-dall').click();
    assert.ok(await warte(() => d.getElementById('confirm-modal').style.display === 'flex'));
    d.getElementById('cd-pw').value = 'mein-Passwort';
    d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => aufrufe.some(a => a.method === 'DELETE')));
    const deletes = aufrufe.filter(a => a.method === 'DELETE');
    assert.deepEqual(
      deletes.map(a => [a.url.replace(/^https?:\/\/[^/]+/, ''), JSON.parse(a.body).password]),
      [['/api/v2/inventory', 'mein-Passwort']],
    );
  } finally {
    w.close();
  }
});
