/**
 * Ändern, Löschen und Verschieben einer Erfassung gelten nur unter dem
 * Schlüssel im Pfad: `/parts/A/1/acquisitions/{Erfassung von Teil B}` ändert
 * weder Zeile B noch verbucht es deren Menge beim Ziel.
 *
 * Gegenproben (am 08.11.2026 gemessen):
 *   A  erfassungImSchreibfeld() ohne die Schlüsselspalten (wie vorher für Teil und Figur)
 *      → rot: „Teil, anderer Schlüssel: ändern“, „… andere Farbe“, „… löschen“, „Figur …“
 *   B  manuelleErfassung() ohne die Schlüsselbedingung
 *      → rot: „Verschieben unter fremdem Schlüssel: Teil“ und „Figur …“
 *   (Der Test „richtiger Schlüssel“ wird in beiden Fällen mit rot, weil die Fremdzeile vorher zerstört ist.)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

test('Erfassungen gelten nur unter ihrem Schlüssel', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username IN ($1,$2)', ['sk_haupt', 'sk_kind']);
  const haupt = (await db.get("INSERT INTO users (username,password_hash) VALUES ('sk_haupt','x') RETURNING id")).id;
  const kind = (await db.get("INSERT INTO users (username,password_hash) VALUES ('sk_kind','x') RETURNING id")).id;
  await db.run('INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)', [haupt, kind]);
  t.after(() => db.run('DELETE FROM users WHERE id = ANY($1)', [[haupt, kind]]));

  for (const [nr, farbe] of [
    ['3001', 4],
    ['3001', 5],
    ['3002', 4],
  ]) {
    await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ($1,'Stein') ON CONFLICT DO NOTHING`, [nr]);
    await db.run(
      `INSERT INTO part_color_catalog (part_number,color_id,color_name) VALUES ($1,$2,'F') ON CONFLICT DO NOTHING`,
      [nr, farbe],
    );
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source) VALUES ($1,$2,$3,'manual')`, [
      haupt,
      nr,
      farbe,
    ]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
       VALUES ($1,$2,$3,4,0.5,'N')`,
      [haupt, nr, farbe],
    );
  }
  for (const f of ['sk0001', 'sk0002']) {
    await db.run(`INSERT INTO minifigs_catalog (fig_number,fig_name) VALUES ($1,'Figur') ON CONFLICT DO NOTHING`, [f]);
    await db.run(`INSERT INTO minifigs (user_id,fig_number,source) VALUES ($1,$2,'manual')`, [haupt, f]);
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
       VALUES ($1,$2,3,9,'N')`,
      [haupt, f],
    );
  }
  const teilId = async (nr, farbe) =>
    (
      await db.get('SELECT id FROM part_acquisitions WHERE user_id=$1 AND part_number=$2 AND color_id=$3', [
        haupt,
        nr,
        farbe,
      ])
    ).id;
  const figId = async f =>
    (await db.get('SELECT id FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2', [haupt, f])).id;
  const teilZeile = id => db.get('SELECT user_id, quantity FROM part_acquisitions WHERE id=$1', [id]);
  const figZeile = id => db.get('SELECT user_id, quantity FROM minifig_acquisitions WHERE id=$1', [id]);

  const { base } = testServer(_req, {
    sitzung: { userId: haupt },
    apiNutzer: { user_id: haupt, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const ruf = async (methode, pfad, koerper) => {
    const r = await fetch(base + pfad, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: koerper ? JSON.stringify(koerper) : undefined,
    });
    return r.status;
  };

  const b = await teilId('3002', 4);
  const andereFarbe = await teilId('3001', 5);

  await t.test('Teil, anderer Schlüssel: ändern', async () => {
    assert.equal(await ruf('PUT', `/api/v1/parts/3001/4/acquisitions/${b}`, { quantity: 99 }), 404);
    assert.equal((await teilZeile(b)).quantity, 4, 'Zeile von Teil B wurde geändert');
  });

  await t.test('Teil, gleiche Nummer, andere Farbe: ändern', async () => {
    assert.equal(await ruf('PUT', `/api/v1/parts/3001/4/acquisitions/${andereFarbe}`, { quantity: 99 }), 404);
    assert.equal((await teilZeile(andereFarbe)).quantity, 4);
  });

  await t.test('Teil, anderer Schlüssel: löschen', async () => {
    assert.equal(await ruf('DELETE', `/api/v1/parts/3001/4/acquisitions/${b}`), 404);
    assert.ok(await teilZeile(b), 'Erfassung von Teil B wurde gelöscht');
  });

  await t.test('Verschieben unter fremdem Schlüssel: Teil', async () => {
    assert.equal(await ruf('PUT', `/api/v1/parts/3001/4/acquisitions/${b}`, { owner_user_id: kind }), 404);
    assert.equal(Number((await teilZeile(b)).user_id), haupt, 'Erfassung von Teil B ist beim Ziel gelandet');
    const beimKind = await db.all('SELECT part_number FROM parts WHERE user_id=$1', [kind]);
    assert.deepEqual(beimKind, [], 'beim Ziel entstand eine Teilezeile unter dem Schlüssel der Anfrage');
  });

  await t.test('Figur: ändern, löschen, verschieben unter fremdem Schlüssel', async () => {
    const f2 = await figId('sk0002');
    assert.equal(await ruf('PUT', `/api/v1/minifigs/sk0001/acquisitions/${f2}`, { quantity: 99 }), 404);
    assert.equal((await figZeile(f2)).quantity, 3, 'Zeile von Figur B wurde geändert');
    assert.equal(await ruf('DELETE', `/api/v1/minifigs/sk0001/acquisitions/${f2}`), 404);
    assert.ok(await figZeile(f2), 'Erfassung von Figur B wurde gelöscht');
    assert.equal(await ruf('PUT', `/api/v1/minifigs/sk0001/acquisitions/${f2}`, { owner_user_id: kind }), 404);
    assert.equal(Number((await figZeile(f2)).user_id), haupt);
    assert.deepEqual(await db.all('SELECT fig_number FROM minifigs WHERE user_id=$1', [kind]), []);
  });

  await t.test('richtiger Schlüssel: ändern und verschieben gehen weiter', async () => {
    const a = await teilId('3001', 4);
    assert.equal(await ruf('PUT', `/api/v1/parts/3001/4/acquisitions/${a}`, { quantity: 7 }), 200);
    assert.equal((await teilZeile(a)).quantity, 7);
    assert.equal(await ruf('PUT', `/api/v1/parts/3001/4/acquisitions/${a}`, { owner_user_id: kind }), 200);
    assert.equal(
      (
        await db.get("SELECT quantity FROM part_acquisitions WHERE user_id=$1 AND part_number='3001' AND color_id=4", [
          kind,
        ])
      ).quantity,
      7,
    );
    const f1 = await figId('sk0001');
    assert.equal(await ruf('PUT', `/api/v1/minifigs/sk0001/acquisitions/${f1}`, { owner_user_id: kind }), 200);
    assert.equal(
      (await db.get("SELECT quantity FROM minifig_acquisitions WHERE user_id=$1 AND fig_number='sk0001'", [kind]))
        .quantity,
      3,
    );
  });
});
