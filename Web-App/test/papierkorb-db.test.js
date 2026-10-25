/**
 * Papierkorb: Gelöschtes kommt Zeile für Zeile so zurück, wie es war.
 *
 * Verglichen wird der volle Zeileninhalt (to_jsonb) vor dem Löschen und nach
 * dem Wiederherstellen — samt id, Kaufpreis und Erfassungsdatum.
 *
 * Gegenproben (25.10., gemessen):
 *   A  legeInPapierkorb() in deleteSet() entfernt      → rot: „Set fehlt im Papierkorb"
 *   B  Spaltenabgleich in stelleWiederHer() entfernt   → rot: „unbekannte Spalte"
 *   C  `user_id = ANY($2)` in stelleWiederHer() weg    → rot: „fremdes Konto"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { haeltSet, haeltTeil, haeltFigur } = require('./helpers/bestand');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const pk = _req('utils/papierkorb.js');

const SN = `99041-${process.pid}`, PN = `pk${process.pid}`, FN = `fig-pk-${process.pid}`;

/** Alle Zeilen eines Elements, als JSON — der Massstab für „wie vorher". */
async function zeilen(uid) {
  const q = (tab, wo, p) => db.all(`SELECT to_jsonb(t) AS z FROM ${tab} t WHERE ${wo} ORDER BY id`, p)
    .then(r => r.map(x => x.z));
  return {
    sets:     await q('sets', 'user_id=$1 AND set_number=$2', [uid, SN]),
    setTeile: await q('parts', 'user_id=$1 AND set_number=$2', [uid, SN]),
    setKauf:  await q('set_acquisitions', 'user_id=$1 AND set_number=$2', [uid, SN]),
    teil:     await q('parts', "user_id=$1 AND part_number=$2 AND source='manual'", [uid, PN]),
    teilKauf: await q('part_acquisitions', 'user_id=$1 AND part_number=$2', [uid, PN]),
    figur:    await q('minifigs', "user_id=$1 AND fig_number=$2 AND source='manual'", [uid, FN]),
    figKauf:  await q('minifig_acquisitions', 'user_id=$1 AND fig_number=$2', [uid, FN]),
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

test('Papierkorb', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const namen = [`pk-haupt-${process.pid}`, `pk-sub-${process.pid}`, `pk-fremd-${process.pid}`];
  await aufraeumen(namen);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get("INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id", [n])).id);
  const [haupt, sub, fremd] = ids;
  await db.run('INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)', [haupt, sub]);

  const routen = { '/api/v1': 'routes/api_v1/index.js' };
  const H = testServer(_req, { sitzung: { userId: haupt }, apiNutzer: { user_id: haupt, is_admin: 0 }, routen, t });
  const F = testServer(_req, { sitzung: { userId: fremd }, apiNutzer: { user_id: fremd, is_admin: 0 }, routen, t });
  const api = async (srv, methode, pfad) => {
    const r = await fetch(srv.base + '/api/v1' + pfad, { method: methode });
    return { status: r.status, body: await r.json() };
  };
  const eintraege = async (srv) => (await api(srv, 'GET', '/papierkorb')).body.eintraege;

  try {
    await t.test('Set des Unterkontos: löschen, ansehen, zurückholen', async () => {
      await haeltSet(db, sub, SN, 2, { preis: 12.5, am: '2026-03-01T10:00:00Z' });
      await haeltTeil(db, sub, '3001', { setNumber: SN, menge: 4, colorId: 4 });
      const vorher = await zeilen(sub);
      assert.equal(vorher.sets.length, 1);

      const weg = await api(H, 'DELETE', `/sets/${SN}`);
      assert.equal(weg.status, 200);
      assert.deepEqual((await zeilen(sub)).sets, [], 'Vorbedingung: das Set ist weg');

      const liste = await eintraege(H);
      const e = liste.find(x => x.art === 'set' && x.nummer === SN);
      assert.ok(e, 'Set fehlt im Papierkorb');
      assert.equal(e.user_id, sub, 'Der Eintrag gehört dem Konto, dem das Set gehörte');
      assert.equal(e.anzahl, 2);
      assert.deepEqual(weg.body.papierkorb, [e.id], 'Die Antwort nennt den Eintrag — dafür gibt es „Rückgängig"');

      // Ein fremdes Konto sieht den Eintrag nicht und kann ihn nicht zurückholen.
      assert.equal((await eintraege(F)).length, 0);
      assert.equal((await api(F, 'POST', `/papierkorb/${e.id}/wiederherstellen`)).status, 404,
        'fremdes Konto darf nicht wiederherstellen');
      assert.equal((await api(F, 'DELETE', `/papierkorb/${e.id}`)).status, 404);

      const r = await api(H, 'POST', `/papierkorb/${e.id}/wiederherstellen`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const nachher = await zeilen(sub);
      assert.deepEqual(nachher.sets, vorher.sets);
      assert.deepEqual(nachher.setTeile, vorher.setTeile);
      assert.deepEqual(nachher.setKauf, vorher.setKauf, 'Kaufpreis und Datum kommen unverändert zurück');
      assert.equal((await eintraege(H)).length, 0, 'Wiederhergestelltes verlässt den Papierkorb');
    });

    await t.test('neu angelegt: Wiederherstellen weist ab und ändert nichts', async () => {
      assert.equal((await api(H, 'DELETE', `/sets/${SN}`)).status, 200);
      await haeltSet(db, sub, SN, 1, { preis: 99 });
      const neu = await zeilen(sub);
      const [e] = await eintraege(H);
      const r = await api(H, 'POST', `/papierkorb/${e.id}/wiederherstellen`);
      assert.equal(r.status, 409);
      assert.deepEqual(await zeilen(sub), neu, 'Der neue Bestand bleibt, wie er ist');
      assert.equal((await eintraege(H)).length, 1, 'Der Eintrag bleibt liegen');
      assert.equal((await api(H, 'DELETE', `/papierkorb/${e.id}`)).status, 200);
      assert.equal((await eintraege(H)).length, 0);
      await db.run('DELETE FROM set_acquisitions WHERE set_number=$1', [SN]);
      await db.run('DELETE FROM sets WHERE set_number=$1', [SN]);
    });

    await t.test('manuelles Teil und manuelle Figur', async () => {
      await haeltTeil(db, haupt, PN, { colorId: 5, menge: 3, preis: 0.25, zustand: 'U' });
      await haeltFigur(db, haupt, FN, { menge: 1, preis: 4 });
      const vorher = await zeilen(haupt);
      const tw = await api(H, 'DELETE', `/parts/${PN}/5`);
      const fw = await api(H, 'DELETE', `/minifigs/${FN}`);
      assert.equal(tw.status, 200); assert.equal(fw.status, 200);
      const leer = await zeilen(haupt);
      assert.deepEqual([leer.teil, leer.teilKauf, leer.figur, leer.figKauf], [[], [], [], []]);

      const liste = await eintraege(H);
      const teil = liste.find(x => x.art === 'teil'), figur = liste.find(x => x.art === 'figur');
      assert.ok(teil && figur, JSON.stringify(liste));
      assert.equal(teil.farbe_id, 5);
      assert.equal(teil.anzahl, 3);
      assert.deepEqual([tw.body.papierkorb, fw.body.papierkorb], [[teil.id], [figur.id]]);
      for (const e of [teil, figur])
        assert.equal((await api(H, 'POST', `/papierkorb/${e.id}/wiederherstellen`)).status, 200);
      const nachher = await zeilen(haupt);
      for (const k of ['teil', 'teilKauf', 'figur', 'figKauf'])
        assert.deepEqual(nachher[k], vorher[k], k);
    });

    await t.test('ein Schnappschuss übersteht eine entfallene Spalte', async () => {
      assert.equal((await api(H, 'DELETE', `/parts/${PN}/5`)).status, 200);
      const [e] = await eintraege(H);
      await db.run(
        `UPDATE papierkorb SET zeilen = jsonb_set(zeilen, '{parts,0,gibt_es_nicht_mehr}', '"x"') WHERE id=$1`, [e.id]);
      const r = await api(H, 'POST', `/papierkorb/${e.id}/wiederherstellen`);
      assert.equal(r.status, 200, 'unbekannte Spalte: ' + JSON.stringify(r.body));
    });

    await t.test('„Alle meine Daten löschen": alles Eigene in den Papierkorb, nichts Fremdes', async () => {
      await db.run('DELETE FROM papierkorb WHERE user_id = ANY($1)', [ids]);
      await haeltSet(db, haupt, SN, 1, { preis: 5 });
      await haeltTeil(db, haupt, '3001', { setNumber: SN, menge: 2, colorId: 4 });
      await haeltTeil(db, haupt, PN, { colorId: 5, menge: 3 });
      await haeltFigur(db, haupt, FN, { menge: 1 });
      // Ein Set des Unterkontos: Das Hauptkonto sieht es, „meine Daten" ist es nicht.
      const SN2 = `${SN}-sub`;
      await haeltSet(db, sub, SN2, 1);
      const vorher = await zeilen(haupt);

      const r = await api(H, 'DELETE', '/bestand');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual([r.body.sets, r.body.teile, r.body.figuren], [1, 1, 1]);
      const nachher = await zeilen(haupt);
      for (const k of ['sets', 'setTeile', 'setKauf', 'teil', 'teilKauf', 'figur', 'figKauf'])
        assert.deepEqual(nachher[k], [], `${k} ist nicht weg`);
      assert.ok(await db.get('SELECT 1 FROM sets WHERE user_id=$1 AND set_number=$2', [sub, SN2]),
        'Das Set des Unterkontos wurde mitgelöscht');

      const liste = await eintraege(H);
      const arten = liste.filter(e => e.user_id === haupt).map(e => e.art).sort();
      assert.deepEqual(arten, ['figur', 'set', 'teil'], 'Figur fehlt (oder Set/Teil) im Papierkorb');
      assert.deepEqual(r.body.papierkorb.sort(), liste.filter(e => e.user_id === haupt).map(e => e.id).sort());

      // Und alles kommt einzeln zurück, wie vorher.
      for (const e of liste.filter(e => e.user_id === haupt))
        assert.equal((await api(H, 'POST', `/papierkorb/${e.id}/wiederherstellen`)).status, 200);
      assert.deepEqual(await zeilen(haupt), vorher);
      await db.run('DELETE FROM set_acquisitions WHERE set_number = ANY($1)', [[SN, SN2]]);
      // Teil und Figur bleiben: Der nächste Fall löscht sie selbst.
      await db.run('DELETE FROM parts WHERE set_number = ANY($1)', [[SN, SN2]]);
      await db.run('DELETE FROM sets WHERE set_number = ANY($1)', [[SN, SN2]]);
    });

    await t.test('nach 30 Tagen räumt der Hintergrundlauf ab, vorher nicht', async () => {
      assert.equal((await api(H, 'DELETE', `/parts/${PN}/5`)).status, 200);
      assert.equal((await api(H, 'DELETE', `/minifigs/${FN}`)).status, 200);
      const [a, b] = await eintraege(H);
      await db.run("UPDATE papierkorb SET geloescht_am = NOW() - interval '31 days' WHERE id=$1", [a.id]);
      await db.run("UPDATE papierkorb SET geloescht_am = NOW() - interval '29 days' WHERE id=$1", [b.id]);
      assert.ok(await pk.raeumePapierkorbAuf() >= 1);
      assert.deepEqual((await eintraege(H)).map(x => x.id), [b.id]);
      assert.equal((await api(H, 'DELETE', '/papierkorb')).body.entfernt, 1, 'Leeren entfernt den Rest');
    });
  } finally {
    await db.run('DELETE FROM papierkorb WHERE user_id = ANY($1)', [ids]).catch(() => {});
    await db.run('DELETE FROM account_links WHERE main_user_id = $1', [haupt]).catch(() => {});
    await aufraeumen(namen);
    await db.pool.end().catch(() => {});
  }
});
