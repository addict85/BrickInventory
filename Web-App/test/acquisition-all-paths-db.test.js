/**
 * ALL entry paths in the household — sets, parts, minifigures, each change and
 * delete.
 *
 * Counter-check (performed): schreibbereich in src/collection/acquisitions.ts replaced by the own ID
 * → “delete set entry" ends in 404 again.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (migrations for account_links).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsMinifig, holdsSet, holdsPart } = require('./helpers/inventory');
const db = testData();
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('acquisitions of the sub-account: change and delete for all three element kinds', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const MAIN = `acq6-h-${process.pid}`,
    SUB = `acq6-s-${process.pid}`;
  const SN = `77001-${process.pid}`,
    PN = `3001x${process.pid}`,
    FN = `sw${process.pid}`;

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [MAIN, SUB]);
  const mainId = (await db.get(`SELECT id FROM users WHERE username=$1`, [MAIN])).id;
  const subId = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [
    mainId,
    subId,
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: mainId };
    req.apiUser = { user_id: mainId, is_admin: 0 };
    next();
  });
  // Since an earlier round the entry routes only live here — one
  // address for web app AND app.
  app.use(_req('src/http/apiV1Alias.js').apiV1Alias);
  app.use('/api/v2', require('./helpers/sources').routerFrom(_req, 'routes/api/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  // Everything belongs to the SUB-ACCOUNT — as in the reported case.
  const setUp = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM part_acquisitions WHERE part_number=$1`, [PN]);
    await db.run(`DELETE FROM parts WHERE part_number=$1`, [PN]);
    await db.run(`DELETE FROM minifig_acquisitions WHERE fig_number=$1`, [FN]);
    await db.run(`DELETE FROM minifigs WHERE fig_number=$1`, [FN]);
    await holdsSet(db, subId, SN, 0); // Quantity 0: the entry behind it carries it
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,10,'N',1)`,
      [subId, SN],
    );
    await holdsPart(db, subId, PN, { quantity: 0, colorId: 4 }); // Quantity 0: the entry behind it carries it
    await db.run(
      `INSERT INTO part_acquisitions (user_id,part_number,color_id,unit_price,condition,quantity)
                  VALUES ($1,$2,4,5,'N',1)`,
      [subId, PN],
    );
    await holdsMinifig(db, subId, FN, { quantity: 0 }); // Quantity 0: the entry behind it carries it
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id,fig_number,unit_price,condition,quantity)
                  VALUES ($1,$2,7,'N',1)`,
      [subId, FN],
    );
  };
  const acqId = async (tabelle, spalte, wert) =>
    (await db.get(`SELECT id FROM ${tabelle} WHERE user_id=$1 AND ${spalte}=$2`, [subId, wert])).id;

  /** @type {[string, string, () => Promise<string>, unknown][]} */
  const faelle = [
    [
      'Set-Erfassung ändern',
      'PUT',
      async () => `/api/v2/sets/${SN}/acquisitions/${await acqId('set_acquisitions', 'set_number', SN)}`,
      { purchase_price: 20 },
    ],
    [
      'Set-Erfassung löschen',
      'DELETE',
      async () => `/api/v2/sets/${SN}/acquisitions/${await acqId('set_acquisitions', 'set_number', SN)}`,
      null,
    ],
    [
      'Teil-Erfassung ändern',
      'PUT',
      async () => `/api/v2/parts/${PN}/4/acquisitions/${await acqId('part_acquisitions', 'part_number', PN)}`,
      { unit_price: 9 },
    ],
    [
      'Teil-Erfassung löschen',
      'DELETE',
      async () => `/api/v2/parts/${PN}/4/acquisitions/${await acqId('part_acquisitions', 'part_number', PN)}`,
      null,
    ],
    [
      'Figur-Erfassung ändern',
      'PUT',
      async () => `/api/v2/minifigs/${FN}/acquisitions/${await acqId('minifig_acquisitions', 'fig_number', FN)}`,
      { unit_price: 9 },
    ],
    [
      'Figur-Erfassung löschen',
      'DELETE',
      async () => `/api/v2/minifigs/${FN}/acquisitions/${await acqId('minifig_acquisitions', 'fig_number', FN)}`,
      null,
    ],
  ];

  try {
    for (const [name, methode, pathFn, body] of faelle) {
      await setUp();
      const path = await pathFn();
      const r = await fetch(`${base}${path}`, {
        method: methode,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(
        r.status,
        200,
        `${name}: must not end in 404 — the row belongs to the sub-account, ` + 'the main account may manage it',
      );
    }

    // Deleting must REALLY delete. Two of the paths used not to check at all
    // whether a row was hit: the DELETE ran into nothing, the response
    // still reported success — the user saw “deleted", the row stayed.
    await setUp();
    const figId = await acqId('minifig_acquisitions', 'fig_number', FN);
    await fetch(`${base}/api/v2/minifigs/${FN}/acquisitions/${figId}`, { method: 'DELETE' });
    const rest = await db.get(`SELECT COUNT(*)::int AS c FROM minifig_acquisitions WHERE id=$1`, [figId]);
    assert.equal(rest.c, 0, 'the acquisition must really be gone after deletion');
  } finally {
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [MAIN, SUB]).catch(() => {});
    for (const [tab, sp, wert] of [
      ['set_acquisitions', 'set_number', SN],
      ['sets', 'set_number', SN],
      ['part_acquisitions', 'part_number', PN],
      ['parts', 'part_number', PN],
      ['minifig_acquisitions', 'fig_number', FN],
      ['minifigs', 'fig_number', FN],
    ])
      await db.run(`DELETE FROM ${tab} WHERE ${sp}=$1`, [wert]).catch(() => {});
    await new Promise(r => srv.close(r));
    await db.pool.end().catch(() => {});
  }
});
