/**
 * Trash: deleted things come back row by row as they were.
 *
 * Compared is the full row content (to_jsonb) before deleting and after
 * restoring — including id, purchase price and acquisition date.
 *
 * Counter-checks (25.10., measured):
 *   A  putInTrash() removed in deleteSet()         → red: „Set fehlt im Papierkorb"
 *   B  column matching removed in placeAgainHer()  → red: „unbekannte Spalte"
 *   C  `user_id = ANY($2)` gone in placeAgainHer() → red: „fremdes Konto"
 *   D  (03.11.2026) confirmWithFactor() removed in DELETE /papierkorb/:id or
 *      DELETE /papierkorb → red: „endgültig löschen ohne Passwort"
 *      or „Leeren mit falschem Passwort" (200 instead of 400)
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
  const q = (tab, wo, p) =>
    db.all(`SELECT to_jsonb(t) AS z FROM ${tab} t WHERE ${wo} ORDER BY id`, p).then(r => r.map(x => x.z));
  return {
    sets: await q('sets', 'user_id=$1 AND set_number=$2', [uid, SN]),
    setTeile: await q('parts', 'user_id=$1 AND set_number=$2', [uid, SN]),
    setPurchase: await q('set_acquisitions', 'user_id=$1 AND set_number=$2', [uid, SN]),
    teil: await q('parts', "user_id=$1 AND part_number=$2 AND source='manual'", [uid, PN]),
    partPurchase: await q('part_acquisitions', 'user_id=$1 AND part_number=$2', [uid, PN]),
    figur: await q('minifigs', "user_id=$1 AND fig_number=$2 AND source='manual'", [uid, FN]),
    figPurchase: await q('minifig_acquisitions', 'user_id=$1 AND fig_number=$2', [uid, FN]),
  };
}

async function aufraeumen(namen) {
  await db.run('DELETE FROM sets WHERE set_number=$1', [SN]).catch(() => {});
  await db.run('DELETE FROM parts WHERE set_number=$1 OR part_number=$2', [SN, PN]).catch(() => {});
  await db.run('DELETE FROM set_acquisitions WHERE set_number=$1', [SN]).catch(() => {});
  await db.run('DELETE FROM part_acquisitions WHERE part_number=$1', [PN]).catch(() => {});
  await db.run('DELETE FROM minifigs WHERE fig_number=$1', [FN]).catch(() => {});
  await db.run('DELETE FROM minifig_acquisitions WHERE fig_number=$1', [FN]).catch(() => {});
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]).catch(() => {});
}

test('trash', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const namen = [`pk-haupt-${process.pid}`, `pk-sub-${process.pid}`, `pk-fremd-${process.pid}`];
  await aufraeumen(namen);
  const ids = [];
  const PASS = 'pk-Passwort-1',
    hash = require('../node_modules/bcryptjs').hashSync(PASS, 4);
  for (const n of namen)
    ids.push((await db.get('INSERT INTO users (username,password_hash) VALUES ($1,$2) RETURNING id', [n, hash])).id);
  const [haupt, sub, fremd] = ids;
  await db.run('INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)', [haupt, sub]);

  const H = testServer(_req, { sitzung: { userId: haupt }, t });
  const F = testServer(_req, { sitzung: { userId: fremd }, t });
  const api = async (srv, methode, pfad, body) => {
    const r = await fetch(srv.base + '/api/v1' + pfad, {
      method: methode,
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  const eintraege = async srv => (await api(srv, 'GET', '/papierkorb')).body.eintraege;

  try {
    await t.test('set of the sub-account: delete, view, restore', async () => {
      await holdsSet(db, sub, SN, 2, { preis: 12.5, am: '2026-03-01T10:00:00Z' });
      await holdsPart(db, sub, '3001', { setNumber: SN, menge: 4, colorId: 4 });
      const vorher = await rows(sub);
      assert.equal(vorher.sets.length, 1);

      const weg = await api(H, 'DELETE', `/sets/${SN}`);
      assert.equal(weg.status, 200);
      assert.deepEqual((await rows(sub)).sets, [], 'Vorbedingung: das Set ist weg');

      const liste = await eintraege(H);
      const e = liste.find(x => x.type === 'set' && x.number === SN);
      assert.ok(e, 'Set fehlt im Papierkorb');
      assert.equal(e.user_id, sub, 'Der Eintrag gehört dem Konto, dem das Set gehörte');
      assert.equal(e.anzahl, 2);
      assert.deepEqual(weg.body.papierkorb, [e.id], 'Die Antwort nennt den Eintrag — dafür gibt es „Rückgängig"');

      // A foreign account does not see the entry and cannot bring it back.
      assert.equal((await eintraege(F)).length, 0);
      assert.equal(
        (await api(F, 'POST', `/papierkorb/${e.id}/wiederherstellen`)).status,
        404,
        'fremdes Konto darf nicht wiederherstellen',
      );
      assert.equal((await api(F, 'DELETE', `/papierkorb/${e.id}`, { password: PASS })).status, 404);

      const r = await api(H, 'POST', `/papierkorb/${e.id}/wiederherstellen`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const nachher = await rows(sub);
      assert.deepEqual(nachher.sets, vorher.sets);
      assert.deepEqual(nachher.setTeile, vorher.setTeile);
      assert.deepEqual(nachher.setPurchase, vorher.setPurchase, 'Kaufpreis und Datum kommen unverändert zurück');
      assert.equal((await eintraege(H)).length, 0, 'Wiederhergestelltes verlässt den Papierkorb');
    });

    await t.test('newly created: restore rejects and changes nothing', async () => {
      assert.equal((await api(H, 'DELETE', `/sets/${SN}`)).status, 200);
      await holdsSet(db, sub, SN, 1, { preis: 99 });
      const neu = await rows(sub);
      const [e] = await eintraege(H);
      const r = await api(H, 'POST', `/papierkorb/${e.id}/wiederherstellen`);
      assert.equal(r.status, 409);
      assert.deepEqual(await rows(sub), neu, 'Der neue Bestand bleibt, wie er ist');
      assert.equal((await eintraege(H)).length, 1, 'Der Eintrag bleibt liegen');
      const ohne = await api(H, 'DELETE', `/papierkorb/${e.id}`);
      assert.deepEqual(
        [ohne.status, ohne.body.code],
        [400, 'aktuelles_passwort_falsch'],
        'endgültig löschen ohne Passwort',
      );
      assert.equal((await eintraege(H)).length, 1, 'ohne Passwort ist der Eintrag weg');
      assert.equal((await api(H, 'DELETE', `/papierkorb/${e.id}`, { password: PASS })).status, 200);
      assert.equal((await eintraege(H)).length, 0);
      await db.run('DELETE FROM set_acquisitions WHERE set_number=$1', [SN]);
      await db.run('DELETE FROM sets WHERE set_number=$1', [SN]);
    });

    await t.test('manual part and manual minifigure', async () => {
      await holdsPart(db, haupt, PN, { colorId: 5, menge: 3, preis: 0.25, zustand: 'U' });
      await holdsMinifig(db, haupt, FN, { menge: 1, preis: 4 });
      const vorher = await rows(haupt);
      const tw = await api(H, 'DELETE', `/parts/${PN}/5`);
      const fw = await api(H, 'DELETE', `/minifigs/${FN}`);
      assert.equal(tw.status, 200);
      assert.equal(fw.status, 200);
      const leer = await rows(haupt);
      assert.deepEqual([leer.teil, leer.partPurchase, leer.figur, leer.figPurchase], [[], [], [], []]);

      const liste = await eintraege(H);
      const teil = liste.find(x => x.type === 'teil'),
        figur = liste.find(x => x.type === 'figur');
      assert.ok(teil && figur, JSON.stringify(liste));
      assert.equal(teil.color_id, 5);
      assert.equal(teil.anzahl, 3);
      assert.deepEqual([tw.body.papierkorb, fw.body.papierkorb], [[teil.id], [figur.id]]);
      for (const e of [teil, figur])
        assert.equal((await api(H, 'POST', `/papierkorb/${e.id}/wiederherstellen`)).status, 200);
      const nachher = await rows(haupt);
      for (const k of ['teil', 'partPurchase', 'figur', 'figPurchase']) assert.deepEqual(nachher[k], vorher[k], k);
    });

    await t.test('a snapshot survives a dropped column', async () => {
      assert.equal((await api(H, 'DELETE', `/parts/${PN}/5`)).status, 200);
      const [e] = await eintraege(H);
      await db.run(`UPDATE trash SET rows = jsonb_set(rows, '{parts,0,gibt_es_nicht_mehr}', '"x"') WHERE id=$1`, [
        e.id,
      ]);
      const r = await api(H, 'POST', `/papierkorb/${e.id}/wiederherstellen`);
      assert.equal(r.status, 200, 'unbekannte Spalte: ' + JSON.stringify(r.body));
    });

    await t.test('“Alle meine Daten löschen”: everything own into the trash, nothing foreign', async () => {
      await db.run('DELETE FROM trash WHERE user_id = ANY($1)', [ids]);
      await holdsSet(db, haupt, SN, 1, { preis: 5 });
      await holdsPart(db, haupt, '3001', { setNumber: SN, menge: 2, colorId: 4 });
      await holdsPart(db, haupt, PN, { colorId: 5, menge: 3 });
      await holdsMinifig(db, haupt, FN, { menge: 1 });
      // A set of the sub-account: the main account sees it, „meine Daten" it is not.
      const SN2 = `${SN.replace(/-\d+$/, '')}9-1`; // with version: otherwise the database adds it (migration 0074)
      await holdsSet(db, sub, SN2, 1);
      const vorher = await rows(haupt);

      const r = await api(H, 'DELETE', '/bestand', { password: PASS });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual([r.body.sets, r.body.teile, r.body.figuren], [1, 1, 1]);
      const nachher = await rows(haupt);
      for (const k of ['sets', 'setTeile', 'setPurchase', 'teil', 'partPurchase', 'figur', 'figPurchase'])
        assert.deepEqual(nachher[k], [], `${k} ist nicht weg`);
      assert.ok(
        await db.get('SELECT 1 FROM sets WHERE user_id=$1 AND set_number=$2', [sub, SN2]),
        'Das Set des Unterkontos wurde mitgelöscht',
      );

      const liste = await eintraege(H);
      const arten = liste
        .filter(e => e.user_id === haupt)
        .map(e => e.type)
        .sort();
      assert.deepEqual(arten, ['figur', 'set', 'teil'], 'Figur fehlt (oder Set/Teil) im Papierkorb');
      assert.deepEqual(
        r.body.papierkorb.sort(),
        liste
          .filter(e => e.user_id === haupt)
          .map(e => e.id)
          .sort(),
      );

      // And everything comes back individually, as before.
      for (const e of liste.filter(e => e.user_id === haupt))
        assert.equal((await api(H, 'POST', `/papierkorb/${e.id}/wiederherstellen`)).status, 200);
      assert.deepEqual(await rows(haupt), vorher);
      await db.run('DELETE FROM set_acquisitions WHERE set_number = ANY($1)', [[SN, SN2]]);
      // Part and figure stay: the next case deletes them itself.
      await db.run('DELETE FROM parts WHERE set_number = ANY($1)', [[SN, SN2]]);
      await db.run('DELETE FROM sets WHERE set_number = ANY($1)', [[SN, SN2]]);
    });

    await t.test('after 30 days the background run clears up, not before', async () => {
      assert.equal((await api(H, 'DELETE', `/parts/${PN}/5`)).status, 200);
      assert.equal((await api(H, 'DELETE', `/minifigs/${FN}`)).status, 200);
      const [a, b] = await eintraege(H);
      await db.run("UPDATE trash SET deleted_at = NOW() - interval '31 days' WHERE id=$1", [a.id]);
      await db.run("UPDATE trash SET deleted_at = NOW() - interval '29 days' WHERE id=$1", [b.id]);
      assert.ok((await pk.cleanTrashOn()) >= 1);
      assert.deepEqual(
        (await eintraege(H)).map(x => x.id),
        [b.id],
      );
      const ohne = await api(H, 'DELETE', '/papierkorb', { password: 'falsch-Passwort-1' });
      assert.deepEqual(
        [ohne.status, ohne.body.code],
        [400, 'aktuelles_passwort_falsch'],
        'Leeren mit falschem Passwort',
      );
      assert.equal((await eintraege(H)).length, 1, 'Leeren mit falschem Passwort hat entfernt');
      assert.equal(
        (await api(H, 'DELETE', '/papierkorb', { password: PASS })).body.entfernt,
        1,
        'Leeren entfernt den Rest',
      );
    });
  } finally {
    await db.run('DELETE FROM trash WHERE user_id = ANY($1)', [ids]).catch(() => {});
    await db.run('DELETE FROM account_links WHERE main_user_id = $1', [haupt]).catch(() => {});
    await aufraeumen(namen);
    await db.pool.end().catch(() => {});
  }
});
