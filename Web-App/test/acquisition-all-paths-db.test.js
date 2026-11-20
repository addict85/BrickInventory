/**
 * ALLE Erfassungs-Wege im Haushalt — Sets, Teile, Minifiguren, je Ändern und
 * Löschen.
 *
 * Gegenprobe (durchgeführt): schreibbereich in src/collection/acquisitions.ts durch die eigene ID
 * ersetzt → „Set-Erfassung löschen" endet wieder in 404.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (Migrationen für account_links).
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
  // Die Erfassungs-Routen liegen seit einer früheren Runde nur noch hier — eine
  // Adresse für Webapp UND App.
  app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/index.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  // Alles gehört dem UNTERKONTO — wie im gemeldeten Fall.
  const aufbauen = async () => {
    await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM sets WHERE set_number=$1`, [SN]);
    await db.run(`DELETE FROM part_acquisitions WHERE part_number=$1`, [PN]);
    await db.run(`DELETE FROM parts WHERE part_number=$1`, [PN]);
    await db.run(`DELETE FROM minifig_acquisitions WHERE fig_number=$1`, [FN]);
    await db.run(`DELETE FROM minifigs WHERE fig_number=$1`, [FN]);
    await holdsSet(db, subId, SN, 0); // Menge 0: die Erfassung dahinter traegt sie
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                  VALUES ($1,$2,10,'N',1)`,
      [subId, SN],
    );
    await holdsPart(db, subId, PN, { menge: 0, colorId: 4 }); // Menge 0: die Erfassung dahinter traegt sie
    await db.run(
      `INSERT INTO part_acquisitions (user_id,part_number,color_id,unit_price,condition,quantity)
                  VALUES ($1,$2,4,5,'N',1)`,
      [subId, PN],
    );
    await holdsMinifig(db, subId, FN, { menge: 0 }); // Menge 0: die Erfassung dahinter traegt sie
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
      async () => `/api/v1/sets/${SN}/acquisitions/${await acqId('set_acquisitions', 'set_number', SN)}`,
      { purchase_price: 20 },
    ],
    [
      'Set-Erfassung löschen',
      'DELETE',
      async () => `/api/v1/sets/${SN}/acquisitions/${await acqId('set_acquisitions', 'set_number', SN)}`,
      null,
    ],
    [
      'Teil-Erfassung ändern',
      'PUT',
      async () => `/api/v1/parts/${PN}/4/acquisitions/${await acqId('part_acquisitions', 'part_number', PN)}`,
      { unit_price: 9 },
    ],
    [
      'Teil-Erfassung löschen',
      'DELETE',
      async () => `/api/v1/parts/${PN}/4/acquisitions/${await acqId('part_acquisitions', 'part_number', PN)}`,
      null,
    ],
    [
      'Figur-Erfassung ändern',
      'PUT',
      async () => `/api/v1/minifigs/${FN}/acquisitions/${await acqId('minifig_acquisitions', 'fig_number', FN)}`,
      { unit_price: 9 },
    ],
    [
      'Figur-Erfassung löschen',
      'DELETE',
      async () => `/api/v1/minifigs/${FN}/acquisitions/${await acqId('minifig_acquisitions', 'fig_number', FN)}`,
      null,
    ],
  ];

  try {
    for (const [name, methode, pathFn, body] of faelle) {
      await aufbauen();
      const pfad = await pathFn();
      const r = await fetch(`${base}${pfad}`, {
        method: methode,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(
        r.status,
        200,
        `${name}: darf nicht in 404 enden — die Zeile gehört dem Unterkonto, ` + 'das Hauptkonto darf sie verwalten',
      );
    }

    // Löschen muss WIRKLICH löschen. Zwei der Wege prüften früher gar nicht,
    // ob eine Zeile getroffen wurde: Das DELETE lief ins Leere, die Antwort
    // meldete trotzdem Erfolg — der Nutzer sah „gelöscht", die Zeile blieb.
    await aufbauen();
    const figId = await acqId('minifig_acquisitions', 'fig_number', FN);
    await fetch(`${base}/api/v1/minifigs/${FN}/acquisitions/${figId}`, { method: 'DELETE' });
    const rest = await db.get(`SELECT COUNT(*)::int AS c FROM minifig_acquisitions WHERE id=$1`, [figId]);
    assert.equal(rest.c, 0, 'die Erfassung muss nach dem Löschen wirklich weg sein');
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
