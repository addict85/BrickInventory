/**
 * Trash: deleted things come back row by row as they were.
 *
 * Compared is the full row content (to_jsonb) before deleting and after
 * restoring — including id, purchase price and acquisition date.
 *
 * Counter-checks (25.10., measured):
 *   A  putInTrash() removed in deleteSet()         → red: „Set fehlt im Papierkorb"
 *   B  column matching removed in restore()  → red: „unbekannte Spalte"
 *   C  `user_id = ANY($2)` gone in restore() → red: „fremdes Konto"
 *   D  (26.11.2026) a password check back into DELETE /trash/:id or DELETE /trash
 *      (the requests carry no password, the login is enough) → red: “deleting
 *      permanently without a password” or “emptying removes the rest” (400 instead of 200)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { holdsSet, holdsPart, holdsMinifig } = require('./helpers/inventory');
const { testServer } = require('./helpers/server');
const db = testData();
const pk = _req('src/inventory/trash.js');

const SN = `99041-${process.pid}`,
  PN = `pk${process.pid}`,
  FN = `fig-pk-${process.pid}`;

/** All rows of an element, as JSON — the yardstick for „as before". */
async function rows(uid) {
  const q = (tab, where, p) =>
    db.all(`SELECT to_jsonb(t) AS z FROM ${tab} t WHERE ${where} ORDER BY id`, p).then(r => r.map(x => x.z));
  return {
    sets: await q('sets', 'user_id=$1 AND set_number=$2', [uid, SN]),
    setParts: await q('parts', 'user_id=$1 AND set_number=$2', [uid, SN]),
    setPurchase: await q('set_acquisitions', 'user_id=$1 AND set_number=$2', [uid, SN]),
    part: await q('parts', "user_id=$1 AND part_number=$2 AND source='manual'", [uid, PN]),
    partPurchase: await q('part_acquisitions', 'user_id=$1 AND part_number=$2', [uid, PN]),
    minifig: await q('minifigs', "user_id=$1 AND fig_number=$2 AND source='manual'", [uid, FN]),
    figPurchase: await q('minifig_acquisitions', 'user_id=$1 AND fig_number=$2', [uid, FN]),
  };
}

async function cleanUp(names) {
  await db.run('DELETE FROM sets WHERE set_number=$1', [SN]).catch(() => {});
  await db.run('DELETE FROM parts WHERE set_number=$1 OR part_number=$2', [SN, PN]).catch(() => {});
  await db.run('DELETE FROM set_acquisitions WHERE set_number=$1', [SN]).catch(() => {});
  await db.run('DELETE FROM part_acquisitions WHERE part_number=$1', [PN]).catch(() => {});
  await db.run('DELETE FROM minifigs WHERE fig_number=$1', [FN]).catch(() => {});
  await db.run('DELETE FROM minifig_acquisitions WHERE fig_number=$1', [FN]).catch(() => {});
  await db.run('DELETE FROM users WHERE username = ANY($1)', [names]).catch(() => {});
}

test('trash', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const names = [`pk-haupt-${process.pid}`, `pk-sub-${process.pid}`, `pk-fremd-${process.pid}`];
  await cleanUp(names);
  const ids = [];
  const PASS = 'pk-Passwort-1',
    hash = require('../node_modules/bcryptjs').hashSync(PASS, 4);
  for (const n of names)
    ids.push((await db.get('INSERT INTO users (username,password_hash) VALUES ($1,$2) RETURNING id', [n, hash])).id);
  const [main, sub, fremd] = ids;
  await db.run('INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)', [main, sub]);

  const H = testServer(_req, { session: { userId: main }, t });
  const F = testServer(_req, { session: { userId: fremd }, t });
  const api = async (srv, method, path, body) => {
    const r = await fetch(srv.base + '/api/v2' + path, {
      method: method,
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  const entries = async srv => (await api(srv, 'GET', '/trash')).body.entries;

  try {
    await t.test('set of the sub-account: delete, view, restore', async () => {
      await holdsSet(db, sub, SN, 2, { price: 12.5, am: '2026-03-01T10:00:00Z' });
      await holdsPart(db, sub, '3001', { setNumber: SN, quantity: 4, colorId: 4 });
      const prior = await rows(sub);
      assert.equal(prior.sets.length, 1);

      const route = await api(H, 'DELETE', `/sets/${SN}`);
      assert.equal(route.status, 200);
      assert.deepEqual((await rows(sub)).sets, [], 'precondition: the set is gone');

      const list = await entries(H);
      const e = list.find(x => x.type === 'set' && x.number === SN);
      assert.ok(e, 'set missing in the trash');
      assert.equal(e.user_id, sub, 'The entry belongs to the account the set belonged to');
      assert.equal(e.count, 2);
      assert.deepEqual(route.body.trash, [e.id], 'The response names the entry — that is what „Rückgängig“ is for');

      // A foreign account does not see the entry and cannot bring it back.
      assert.equal((await entries(F)).length, 0);
      assert.equal((await api(F, 'POST', `/trash/${e.id}/restore`)).status, 404, 'a foreign account must not restore');
      assert.equal((await api(F, 'DELETE', `/trash/${e.id}`, { password: PASS })).status, 404);

      const r = await api(H, 'POST', `/trash/${e.id}/restore`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const later = await rows(sub);
      assert.deepEqual(later.sets, prior.sets);
      assert.deepEqual(later.setParts, prior.setParts);
      assert.deepEqual(later.setPurchase, prior.setPurchase, 'purchase price and date come back unchanged');
      assert.equal((await entries(H)).length, 0, 'restored items leave the trash');
    });

    await t.test('newly created: restore rejects and changes nothing', async () => {
      assert.equal((await api(H, 'DELETE', `/sets/${SN}`)).status, 200);
      await holdsSet(db, sub, SN, 1, { price: 99 });
      const fresh = await rows(sub);
      const [e] = await entries(H);
      const r = await api(H, 'POST', `/trash/${e.id}/restore`);
      assert.equal(r.status, 409);
      assert.deepEqual(await rows(sub), fresh, 'The new stock stays as it is');
      assert.equal((await entries(H)).length, 1, 'The entry stays');
      const final = await api(H, 'DELETE', `/trash/${e.id}`);
      assert.equal(final.status, 200, `deleting permanently without a password: ${JSON.stringify(final.body)}`);
      assert.equal((await entries(H)).length, 0);
      await db.run('DELETE FROM set_acquisitions WHERE set_number=$1', [SN]);
      await db.run('DELETE FROM sets WHERE set_number=$1', [SN]);
    });

    await t.test('manual part and manual minifigure', async () => {
      await holdsPart(db, main, PN, { colorId: 5, quantity: 3, price: 0.25, condition: 'U' });
      await holdsMinifig(db, main, FN, { quantity: 1, price: 4 });
      const prior = await rows(main);
      const tw = await api(H, 'DELETE', `/parts/${PN}/5`);
      const fw = await api(H, 'DELETE', `/minifigs/${FN}`);
      assert.equal(tw.status, 200);
      assert.equal(fw.status, 200);
      const empty = await rows(main);
      assert.deepEqual([empty.part, empty.partPurchase, empty.minifig, empty.figPurchase], [[], [], [], []]);

      const list = await entries(H);
      const part = list.find(x => x.type === 'teil'),
        minifig = list.find(x => x.type === 'figur');
      assert.ok(part && minifig, JSON.stringify(list));
      assert.equal(part.color_id, 5);
      assert.equal(part.count, 3);
      assert.deepEqual([tw.body.trash, fw.body.trash], [[part.id], [minifig.id]]);
      for (const e of [part, minifig]) assert.equal((await api(H, 'POST', `/trash/${e.id}/restore`)).status, 200);
      const later = await rows(main);
      for (const k of ['part', 'partPurchase', 'minifig', 'figPurchase']) assert.deepEqual(later[k], prior[k], k);
    });

    await t.test('a snapshot survives a dropped column', async () => {
      assert.equal((await api(H, 'DELETE', `/parts/${PN}/5`)).status, 200);
      const [e] = await entries(H);
      await db.run(`UPDATE trash SET rows = jsonb_set(rows, '{parts,0,gibt_es_nicht_mehr}', '"x"') WHERE id=$1`, [
        e.id,
      ]);
      const r = await api(H, 'POST', `/trash/${e.id}/restore`);
      assert.equal(r.status, 200, 'unknown column: ' + JSON.stringify(r.body));
    });

    await t.test('“Alle meine Daten löschen”: everything own into the trash, nothing foreign', async () => {
      await db.run('DELETE FROM trash WHERE user_id = ANY($1)', [ids]);
      await holdsSet(db, main, SN, 1, { price: 5 });
      await holdsPart(db, main, '3001', { setNumber: SN, quantity: 2, colorId: 4 });
      await holdsPart(db, main, PN, { colorId: 5, quantity: 3 });
      await holdsMinifig(db, main, FN, { quantity: 1 });
      // A set of the sub-account: the main account sees it, „meine Daten" it is not.
      const SN2 = `${SN.replace(/-\d+$/, '')}9-1`; // with version: otherwise the database adds it (migration 0074)
      await holdsSet(db, sub, SN2, 1);
      const prior = await rows(main);

      const r = await api(H, 'DELETE', '/inventory', { password: PASS });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual([r.body.sets, r.body.parts, r.body.minifigs], [1, 1, 1]);
      const later = await rows(main);
      for (const k of ['sets', 'setParts', 'setPurchase', 'part', 'partPurchase', 'minifig', 'figPurchase'])
        assert.deepEqual(later[k], [], `${k} is not gone`);
      assert.ok(
        await db.get('SELECT 1 FROM sets WHERE user_id=$1 AND set_number=$2', [sub, SN2]),
        "The sub-account's set was deleted along with it",
      );

      const list = await entries(H);
      const kinds = list
        .filter(e => e.user_id === main)
        .map(e => e.type)
        .sort();
      assert.deepEqual(kinds, ['figur', 'set', 'teil'], 'figure missing (or set/part) in the trash');
      assert.deepEqual(
        r.body.trash.sort(),
        list
          .filter(e => e.user_id === main)
          .map(e => e.id)
          .sort(),
      );

      // And everything comes back individually, as before.
      for (const e of list.filter(e => e.user_id === main))
        assert.equal((await api(H, 'POST', `/trash/${e.id}/restore`)).status, 200);
      assert.deepEqual(await rows(main), prior);
      await db.run('DELETE FROM set_acquisitions WHERE set_number = ANY($1)', [[SN, SN2]]);
      // Part and figure stay: the next case deletes them itself.
      await db.run('DELETE FROM parts WHERE set_number = ANY($1)', [[SN, SN2]]);
      await db.run('DELETE FROM sets WHERE set_number = ANY($1)', [[SN, SN2]]);
    });

    await t.test('after 30 days the background run clears up, not before', async () => {
      assert.equal((await api(H, 'DELETE', `/parts/${PN}/5`)).status, 200);
      assert.equal((await api(H, 'DELETE', `/minifigs/${FN}`)).status, 200);
      const [a, b] = await entries(H);
      await db.run("UPDATE trash SET deleted_at = NOW() - interval '31 days' WHERE id=$1", [a.id]);
      await db.run("UPDATE trash SET deleted_at = NOW() - interval '29 days' WHERE id=$1", [b.id]);
      assert.ok((await pk.cleanTrashOn()) >= 1);
      assert.deepEqual(
        (await entries(H)).map(x => x.id),
        [b.id],
      );
      assert.equal((await api(H, 'DELETE', '/trash')).body.removed, 1, 'emptying removes the rest');
    });
  } finally {
    await db.run('DELETE FROM trash WHERE user_id = ANY($1)', [ids]).catch(() => {});
    await db.run('DELETE FROM account_links WHERE main_user_id = $1', [main]).catch(() => {});
    await cleanUp(names);
    await db.pool.end().catch(() => {});
  }
});
