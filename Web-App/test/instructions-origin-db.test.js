/**
 * The trash only stands at SELF-uploaded instructions. The app reads the same
 * field (is_manual); that its model knows it is checked by the Android run against the contract.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const { holdsSet } = require('./helpers/inventory');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const { readSet, readSets } = require('./helpers/sources').areaPage('sets');

test('instructions: the server says which one was uploaded by the user', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const USER = `anlh-${process.pid}`;
  // Ends in "-<digits>" so that withVersion() appends nothing: shared_
  // instructions is read under the number WITH version suffix.
  const SN = `70999-${process.pid}`;

  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  await db.run(`DELETE FROM shared_instructions WHERE set_number=$1`, [SN]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [USER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [USER])).id;

  await holdsSet(db, uid, SN, 1);
  // The automatic search: no account, file under /data/instructions/.
  await db.run(
    `INSERT INTO shared_instructions (set_number,url,description,local_path)
                VALUES ($1,$2,'Anleitung automatisch',$3)`,
    [SN, `https://example.invalid/${SN}.pdf`, `/data/instructions/${SN}_1.pdf`],
  );
  // The own upload: with account, file under /data/uploads/<id>/.
  await db.run(
    `INSERT INTO instructions (user_id,set_number,url,description,local_path)
                VALUES ($1,$2,$3,'Anleitung selbst',$3)`,
    [uid, SN, `/data/uploads/${uid}/${SN}_1.pdf`],
  );

  try {
    // ── 1. Detail: every row carries its origin ────────────────────────────
    const detail = await readSet(uid, SN);
    assert.ok(detail, 'Set nicht gefunden');
    assert.equal(
      detail.instructions.length,
      2,
      'Es sollen beide Anleitungen ankommen — geteilt und selbst hochgeladen',
    );

    const geteilt = detail.instructions.find(i => i.description === 'Anleitung automatisch');
    const eigene = detail.instructions.find(i => i.description === 'Anleitung selbst');
    assert.ok(geteilt && eigene, 'Beide Anleitungen sollen in der Liste stehen');

    assert.equal(
      geteilt.is_manual,
      false,
      'Die automatisch importierte Anleitung ist NICHT selbst hochgeladen — kein Papierkorb',
    );
    assert.equal(
      eigene.is_manual,
      true,
      'Die selbst hochgeladene Anleitung traegt is_manual=true — nur hier ein Papierkorb',
    );

    // ── 2. Counter-check of the old rule: `id != null` separates nothing ───
    //
    // Exactly on that the trash used to hang. Both rows have an identifier,
    // and the counters of the two tables are independent of each other — the
    // numbers can therefore coincide.
    assert.notEqual(
      geteilt.id,
      null,
      'Gemessen: auch die geteilte Anleitung bringt eine id mit — die alte Regel trennte nicht',
    );
    assert.notEqual(eigene.id, null, 'Die eigene Anleitung bringt ebenfalls eine id mit');

    // ── 3. List: the same marking so that the tile counts the same ─────────
    const { sets } = await readSets(uid, {});
    const inList = sets.find(s => s.set_number === SN);
    assert.ok(inList, 'Set fehlt in der Galerie');
    assert.deepEqual(
      inList.instructions.map(i => i.is_manual).sort(),
      [false, true],
      'Auch die Galerie soll beide Herkuenfte unterscheiden',
    );
  } finally {
    await db.run(`DELETE FROM shared_instructions WHERE set_number=$1`, [SN]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [USER]).catch(() => {});
    // Without that the connection pool stays open and the test run hangs until
    // the time limit — all DB tests here do it like that.
    await db.pool.end().catch(() => {});
  }
});

test('instructions: the web app attaches the trash to is_manual', async () => {
  // Real bundle in jsdom: the origin comes from the server, not from the path. An imported file lying
  // under /data/uploads/ gets no trash, an own upload elsewhere does.
  // Counter-checks (22.11.2026, each alone, public/js/set-detail.js): isUpload from
  // `local_path.startsWith('/data/uploads/')` again → red; the trash shown for every instruction → red.
  const { openUi, warte } = require('./helpers/ui');
  const SET = {
    set_number: '10294-1',
    name: 'Titanic',
    year: 2021,
    quantity: 1,
    instructions: [
      { id: 1, description: 'Import', local_path: '/data/uploads/import.pdf', url: null, is_manual: false },
      { id: 2, description: 'Eigene', local_path: '/data/instructions/eigen.pdf', url: null, is_manual: true },
    ],
  };
  const { w, d } = await openUi({
    '/v2/sets': { success: true, total: 1, themes: [], sets: [SET] },
    '/v2/sets/10294-1': { success: true, set: SET },
  });
  try {
    assert.ok(await warte(() => d.querySelector('#gallery [data-click="openModal"]')));
    d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await warte(() => d.getElementById('instr-2')), 'the instructions are not shown');
    assert.equal(d.querySelector('#instr-1 [data-click="delInstr"]'), null, 'trash on an imported instruction');
    assert.ok(d.querySelector('#instr-2 [data-click="delInstr"]'), 'no trash on the own upload');
  } finally {
    w.close();
  }
});
