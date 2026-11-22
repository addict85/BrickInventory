/**
 * The account switch of an entry — via the ROUTE, not via a pattern.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const { testServer } = require('./helpers/server');
const { holdsSet, catalogSet } = require('./helpers/inventory');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

const SN = '75192-1';
let MAIN = 0,
  KIND = 0,
  FREMD = 0;

async function setup() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }

  await db.run(`INSERT INTO users (username,password_hash)
                VALUES ('haupt','x'),('kind','x'),('fremd','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  MAIN = await id('haupt');
  KIND = await id('kind');
  FREMD = await id('fremd');
  // Only haupt+kind are a household. `fremd` stands beside them on purpose — without
  // it “403 for a foreign account" could not be checked.
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [MAIN, KIND]);

  await catalogSet(db, SN, { name: 'Millennium Falcon' });
  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3001','Brick 2x4')
                ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3001',4,'Rot') ON CONFLICT (part_number,color_id) DO NOTHING`);
  await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ('sw0001','Han Solo')
                ON CONFLICT (fig_number) DO NOTHING`);

  // Set with one entry at the main account.
  await holdsSet(db, MAIN, SN, 2, { preis: 100 });
  // Manual part and manual minifigure, one entry each.
  await db.run(
    `INSERT INTO parts (user_id,part_number,color_id,source)
                VALUES ($1,'3001',4,'manual')`,
    [MAIN],
  );
  await db.run(
    `INSERT INTO part_acquisitions
                  (user_id,part_number,color_id,quantity,unit_price,condition)
                VALUES ($1,'3001',4,4,0.50,'N')`,
    [MAIN],
  );
  await db.run(
    `INSERT INTO minifigs (user_id,fig_number,source)
                VALUES ($1,'sw0001','manual')`,
    [MAIN],
  );
  await db.run(
    `INSERT INTO minifig_acquisitions
                  (user_id,fig_number,quantity,unit_price,condition)
                VALUES ($1,'sw0001',3,12.00,'N')`,
    [MAIN],
  );
}

test('an acquisition changes the account — all three kinds via their route', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await setup();

  const { base } = testServer(_req, { sitzung: { userId: MAIN }, t });
  const setze = async (pfad, koerper) => {
    const r = await fetch(base + pfad, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(koerper),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const entryId = async (tab, feld, wert) =>
    (await db.get(`SELECT id FROM ${tab} WHERE ${feld} = $1 ORDER BY id LIMIT 1`, [wert])).id;
  const besitzer = async (tab, feld, wert) =>
    (await db.all(`SELECT user_id FROM ${tab} WHERE ${feld} = $1 ORDER BY user_id`, [wert])).map(r =>
      Number(r.user_id),
    );

  await t.test('set: the acquisition AND the inventory row are with the child afterwards', async () => {
    const id = await entryId('set_acquisitions', 'set_number', SN);
    const a = await setze(`/api/v1/sets/${SN}/acquisitions/${id}`, { owner_user_id: KIND });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(
      await besitzer('set_acquisitions', 'set_number', SN),
      [KIND],
      'Die Erfassung ist nicht beim Kind gelandet',
    );
    assert.ok(
      (await besitzer('sets', 'set_number', SN)).includes(KIND),
      'Das Kind hat keine Bestandszeile bekommen — die Erfassung haengt dann in der Luft',
    );
    // And the sender no longer holds it: it was its only entry.
    assert.ok(
      !(await besitzer('sets', 'set_number', SN)).includes(MAIN),
      'Beim Absender ist die leere Set-Zeile stehengeblieben',
    );
  });

  await t.test('part: the same factory, a different address', async () => {
    const id = await entryId('part_acquisitions', 'part_number', '3001');
    const a = await setze(`/api/v1/parts/3001/4/acquisitions/${id}`, { owner_user_id: KIND });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(await besitzer('part_acquisitions', 'part_number', '3001'), [KIND]);
    assert.deepEqual(
      await besitzer('parts', 'part_number', '3001'),
      [KIND],
      'Die Bestandszeile ist nicht mitgewandert',
    );
  });

  await t.test('figure: the third branch, and it is not executed anywhere else', async () => {
    // Up to here the only assurance for the minifigures was that the source text
    // contains `manualEntryReassign(tx, 'fig'`. Exactly this kind of assurance
    // passed twice today while the path was broken.
    const id = await entryId('minifig_acquisitions', 'fig_number', 'sw0001');
    const a = await setze(`/api/v1/minifigs/sw0001/acquisitions/${id}`, { owner_user_id: KIND });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.deepEqual(await besitzer('minifig_acquisitions', 'fig_number', 'sw0001'), [KIND]);
    assert.deepEqual(
      await besitzer('minifigs', 'fig_number', 'sw0001'),
      [KIND],
      'Die Bestandszeile der Figur ist nicht mitgewandert',
    );
  });

  await t.test('an account OUTSIDE the household is rejected with 403', async () => {
    // Previously a pattern: /if \(to === null\)\s*\n\s*return sendError\(req, res, 403/.
    // That catches a deleted line — not a condition that never
    // applies, or a writeTargetOrNull() that allows too much.
    await setup();
    const id = await entryId('part_acquisitions', 'part_number', '3001');
    const a = await setze(`/api/v1/parts/3001/4/acquisitions/${id}`, { owner_user_id: FREMD });
    assert.equal(
      a.status,
      403,
      `Erwartet 403, bekam ${a.status}: ${JSON.stringify(a.body)}. Ein Konto ausserhalb ` +
        'des Haushalts darf nichts bekommen — und schon gar nicht stillschweigend das ' +
        'eigene Konto behalten.',
    );
    // And NOTHING is touched. Without this half the case would also be green
    // if the route first moved and then answered 403.
    assert.deepEqual(
      await besitzer('part_acquisitions', 'part_number', '3001'),
      [MAIN],
      'Trotz 403 ist die Erfassung gewandert',
    );
    assert.deepEqual(
      await besitzer('parts', 'part_number', '3001'),
      [MAIN],
      'Trotz 403 ist die Bestandszeile gewandert',
    );
  });

  await t.test('the same account means "nothing to do", not "error"', async () => {
    // The path beside it: whoever moves to their own account gets 200 and
    // `unchanged`. Without this case the route could reject every switch
    // and the 403 case above would still be green.
    const id = await entryId('part_acquisitions', 'part_number', '3001');
    const a = await setze(`/api/v1/parts/3001/4/acquisitions/${id}`, { owner_user_id: MAIN });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body?.unchanged, true, 'Ein Wechsel auf das eigene Konto muss als „unveraendert" antworten');
    assert.deepEqual(await besitzer('part_acquisitions', 'part_number', '3001'), [MAIN]);
  });
});
