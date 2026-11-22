/**
 * “Delete all my sets" deletes MY sets — not those of the household.
 *
 * Counter-check (measured 01.11.2026): bestaetigePasswort() removed from DELETE /bestand
 * → red: “deleted without password” (code missing in the response).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (content is emptied!).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');
const db = testData();

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
    keineDb(t);
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
  t.after(() => db.pool.end());

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
  assert.equal((await db.all('SELECT 1 FROM sets WHERE user_id = $1', [haupt])).length, 1, 'ohne Passwort gelöscht');

  // Exactly the call from public/js/settings.js (btn-dall).
  const r = await hole('/api/v2/inventory', 'DELETE', { password: PASS });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.deepEqual([r.sets, r.parts, r.minifigs], [1, 1, 0], 'Gezählt wird nur das eigene Konto');

  const meine = await db.all(`SELECT set_number FROM sets WHERE user_id=$1`, [haupt]);
  assert.deepEqual(meine, [], 'Die eigenen Sets müssen weg sein');

  const seine = await db.all(`SELECT set_number FROM sets WHERE user_id=$1 ORDER BY set_number`, [kind]);
  assert.deepEqual(
    seine.map(r => r.set_number),
    ['21318-1', '75192-1'],
    'Das verknüpfte Konto behält ALLE seine Sets — auch die gemeinsame Nummer',
  );
  const parts = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1`, [kind]);
  const minifigs = await db.get(`SELECT COUNT(*)::int c FROM minifigs WHERE user_id=$1`, [kind]);
  assert.equal(parts.c, 2, 'Teile des verknüpften Kontos bleiben (aus dem Set und manuell)');
  assert.equal(minifigs.c, 2, 'Minifiguren des verknüpften Kontos bleiben (aus dem Set und manuell)');
  const myParts = await db.get(`SELECT COUNT(*)::int c FROM parts WHERE user_id=$1`, [haupt]);
  assert.equal(myParts.c, 0, 'Das eigene manuelle Teil muss weg sein');
});

test('accounts can only narrow the delete scope, never widen it', () => {
  // A view parameter that can OPEN something would be an access path instead of
  // a safeguard. The service therefore intersects with schreibbereich(); the
  // route only passes the view on (behavior: scope-services-db.test.js).
  const src = require('./helpers/sources').kompakt(fs.readFileSync(path.join(ROOT, 'routes/api/sets.ts'), 'utf8'));
  const i = src.indexOf("router.endpoint('DELETE /api/v2/sets/:setNumber'");
  assert.ok(i > 0, 'Löschroute nicht gefunden');
  assert.match(src.slice(i, i + 900), /deleteSetFor\(viewOf\(req\)/, 'Die Route löscht nicht über den Dienst');
  const dienst = require('./helpers/sources').functionBody(
    fs.readFileSync(path.join(ROOT, 'src/sets/delete.ts'), 'utf8'),
    'deleteSetFor',
  );
  assert.match(
    dienst,
    /(?:schreibbar|writable)\.includes\(/,
    'Die gewählte Menge muss gegen schreibbereich() geschnitten werden',
  );
});

test('the button leaves the choice to the server', () => {
  // Previously the button listed itself and deleted number by number — with the
  // trap that a missing accounts=own deleted the household along. Now
  // the server decides, and only about the own account.
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', 'settings.js'), 'utf8');
  const i = src.indexOf("G('btn-dall')");
  assert.ok(i > 0, 'Knopf btn-dall nicht gefunden');
  const block = src.slice(i, src.indexOf('\n};', i));
  assert.match(
    block,
    /api\(\s*'DELETE',\s*'\/v2\/inventory',\s*\{\s*password\b/,
    'Der Knopf ruft DELETE /v2/bestand mit Passwort',
  );
  assert.doesNotMatch(block, /\/v2\/sets/, 'Der Knopf listet und löscht wieder selbst');
  const loeschen = fs.readFileSync(path.join(ROOT, 'src/collection/deletion.ts'), 'utf8');
  assert.match(loeschen, /deleteSet\(\[uid\]/, 'Sets werden nur im EIGENEN Konto gelöscht');
});
