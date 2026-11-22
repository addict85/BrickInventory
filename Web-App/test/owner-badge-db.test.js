/**
 * Where a client draws an owner badge, the response must carry it.
 */
require('./helpers/system-frame');
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
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

after(() => db.pool.end());

test('every list with a badge in the client carries it in the response too', async t => {
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

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const haupt = await id('haupt'),
    kind = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [haupt, kind]);

  // ONLY the sub-account owns something. That makes the badge meaningful:
  // if the own account stands there, the assignment is wrong; if it is missing,
  // the main account sees stock without an origin.
  await holdsSet(db, kind, '75192-1', 1);
  await holdsPart(db, kind, '3001', { setNumber: '75192-1', quantity: 10, colorId: 4 });
  await holdsPart(db, kind, '3020', { quantity: 3, colorId: 0 });
  await holdsMinifig(db, kind, 'sw0001', { setNumber: '75192-1', quantity: 1 });
  await holdsMinifig(db, kind, 'sw0002', { quantity: 2 });

  const { scopeIds } = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const uids = await scopeIds(haupt, 'all');
  const S = require('./helpers/sources').areaPage('sets');
  const P = _req('src/parts/queries.js');
  const M = _req('src/minifigs/queries.js');

  /** @type {[string, () => Promise<any[]>][]} */
  const listen = [
    ['/v2/sets', async () => (await S.readSets(uids, { page_size: 60 })).sets],
    // manualPartsList/readManualMinifigs deliver a BARE array; the route
    // wraps it. The three other lists deliver an object with `total`.
    ['/v2/parts/manual', async () => await P.manualPartsList(uids, {})],
    ['/v2/minifigs', async () => (await M.readMinifigs(uids, { source: 'set' })).figs],
    ['/v2/minifigs/manual', async () => await M.readManualMinifigs(uids, {})],
  ];

  for (const [name, hole] of listen) {
    const zeilen = await hole();
    assert.ok(zeilen?.length, `${name}: Vorlage liefert keine Zeile — dann prüft der Rest nichts`);
    for (const z of zeilen) {
      assert.ok(
        Array.isArray(z.owners) && z.owners.length === 1,
        `${name}: keine Besitzer-Plakette in der Antwort. Beide Clients zeichnen sie ` +
          `an dieser Stelle (ownerBadges / OwnerBadges) — ohne den Wert bleibt sie leer.`,
      );
      assert.equal(z.owners[0].id, kind, `${name}: falsches Konto in der Plakette`);
      assert.equal(z.owners[0].username, 'kind', `${name}: Plakette ohne Namen nützt nichts`);
    }
  }

  // The set parts list is the one exception, and a justified one: it groups
  // by part number AND color across the whole household, and neither of the two
  // clients draws a badge there. If one is added, this assertion
  // strikes — then the aggregate belongs in the query too.
  const parts = (await P.partsQuery(uids, { page_size: 60, exclude_manual: '1' })).parts;
  assert.ok(parts?.length, 'Vorlage: Set-Teile fehlen');
  for (const z of parts) {
    assert.equal(
      z.owners,
      undefined,
      'Die Set-Teileliste trägt jetzt Besitzer — dann muss auch ein Client sie ' +
        'zeichnen, sonst ist es Ballast in jeder Antwort.',
    );
  }
});

test('in a single account there is no badge', async t => {
  if (!(await erreichbar())) {
    keineDb(t);
    return;
  }
  // No second DROP SCHEMA — own account names suffice (see
  // manual-delete-owner-db.test.js).
  await db.initSchemaOnce();
  // Migrations here too — see the reasoning further above.
  {
    const mc = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(mc);
    } finally {
      mc.release();
    }
  }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('allein','x')`);
  const allein = (await db.get(`SELECT id FROM users WHERE username='allein'`)).id;
  await holdsSet(db, allein, '21318-1', 1);
  await holdsMinifig(db, allein, 'sw0003', { setNumber: '21318-1', quantity: 1 });

  const { scopeIds } = {
    ..._req('src/household/rules.js'),
    ..._req('src/household/household.js'),
    ...require('./helpers/sources').testArea('household'),
  };
  const uids = await scopeIds(allein, 'all');
  const S = require('./helpers/sources').areaPage('sets');
  const M = _req('src/minifigs/queries.js');

  // „mine" on every tile would only be noise — and additional fields in
  // every response. The same decision as for the sets all along.
  for (const [name, zeilen] of [
    ['/v2/sets', (await S.readSets(uids, { page_size: 60 })).sets],
    ['/v2/minifigs', (await M.readMinifigs(uids, { source: 'set' })).figs],
  ]) {
    assert.ok(zeilen?.length, `${name}: Vorlage liefert keine Zeile`);
    for (const z of zeilen) {
      assert.equal(z.owners, undefined, `${name}: Plakette gehört nicht ins Einzelkonto`);
      assert.equal(z.owner_ids, undefined, `${name}: owner_ids gehört nicht ins Einzelkonto`);
    }
  }
});
