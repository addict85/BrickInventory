/**
 * Menge im Haushalt je Konto: Eine Verringerung nimmt nur Käufe des genannten
 * Kontos weg, sagt, welcher Kauf entfiel, und legt ihn in den Papierkorb, aus
 * dem er Zeile für Zeile zurückkommt (auch ein nur gekürzter Kauf).
 *
 * Gegenproben (12./13.11.2026 gemessen, je einzeln, dist neu gebaut):
 *   A  in updateSet `ziel` wieder fest auf `uid` → rot: „Hauptkonto verringert
 *      das Unterkonto“ (Unterkonto hat noch 1, das eigene 0)
 *   B  legeKaeufeInPapierkorb() in updateSet nicht gerufen → rot: „älterer
 *      Kauf bleibt, neuerer kommt zurück“ (kein papierkorb in der Antwort)
 *   C  in stelleKaeufeWiederHer das Aufstocken der Herkunftszeile
 *      übersprungen → rot: „gekürzter Kauf“ (ohne den geänderten Preis
 *      blieb es grün: die Suche nach dem gleichen Kauf fand die Zeile)
 *   E  das Aufstocken einer gleichen Zeile desselben Tages übersprungen →
 *      rot: „derselbe Kauf am selben Tag“
 *   D  die Schreibfeld-Prüfung (`_wids.includes(ziel)`) entfernt → rot:
 *      „Unterkonto darf das Hauptkonto nicht ändern“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { zugangOderSkip } = require('./helpers/db');
const { haeltSet, erfasse, mengeVon } = require('./helpers/bestand');

const kaeufe = (db, uid, sn) =>
  db
    .all(`SELECT to_jsonb(t) AS z FROM set_acquisitions t WHERE user_id=$1 AND set_number=$2 ORDER BY id`, [uid, sn])
    .then(r => r.map(x => x.z));

test('Menge je Konto mit Rückweg', { concurrency: 1 }, async t => {
  const db = await zugangOderSkip(t, _req);
  if (!db) return;
  const NAME = `mjk-${process.pid}`,
    SN = `31171-${process.pid % 1000}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}_kind`]]);
  const neu = n => db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n]);
  const uid = (await neu(NAME)).id;
  const kid = (await neu(`${NAME}_kind`)).id;
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [uid, kid]);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, kid]]);
    await db.pool.end().catch(() => {});
  });
  const { updateSet } = _req('src/sets/index.js');
  const pk = _req('src/bestand/papierkorb.js');

  await t.test('Hauptkonto verringert das Unterkonto, Rückgängig bringt den Kauf zurück', async () => {
    await haeltSet(db, uid, SN, 1, { preis: 199.99, am: '2026-06-01T10:00:00Z' });
    await haeltSet(db, kid, SN, 1, { preis: 210, am: '2026-06-02T10:00:00Z' });
    const vorher = await kaeufe(db, kid, SN);
    const r = await updateSet(uid, SN, { quantity_delta: -1, owner_user_id: kid });
    assert.equal(await mengeVon(db, [kid], SN), 0);
    assert.equal(await mengeVon(db, [uid], SN), 1, 'das eigene Exemplar blieb nicht');
    assert.equal(r.quantity, 1);
    assert.deepEqual(
      r.entfallen.map(e => [e.quantity, e.purchase_price, e.date]),
      [[1, 210, '2026-06-02']],
    );
    assert.ok(r.papierkorb, 'kein Papierkorb-Eintrag');
    assert.equal((await pk.stelleWiederHer({ schreiber: uid }, r.papierkorb)).ok, true);
    assert.deepEqual(await kaeufe(db, kid, SN), vorher);
  });

  await t.test('älterer Kauf bleibt, neuerer kommt zurück', async () => {
    await erfasse(db, uid, SN, 1, { preis: 250, am: '2026-09-13T10:00:00Z' });
    const vorher = await kaeufe(db, uid, SN);
    const r = await updateSet(uid, SN, { quantity_delta: -1 });
    assert.deepEqual(
      r.entfallen.map(e => [e.purchase_price, e.date]),
      [[250, '2026-09-13']],
    );
    assert.deepEqual(
      (await kaeufe(db, uid, SN)).map(z => Number(z.purchase_price)),
      [199.99],
    );
    assert.ok(r.papierkorb, 'kein Papierkorb-Eintrag');
    assert.equal((await pk.listePapierkorb([uid])).find(e => e.id === r.papierkorb)?.anzahl, 1);
    assert.equal((await pk.stelleWiederHer({ schreiber: uid }, r.papierkorb)).ok, true);
    assert.deepEqual(await kaeufe(db, uid, SN), vorher);
  });

  await t.test('gekürzter Kauf: dieselbe Zeile wächst wieder, auch mit inzwischen geändertem Preis', async () => {
    await erfasse(db, uid, SN, 3, { preis: 80, am: '2026-10-01T10:00:00Z' });
    const vorher = await kaeufe(db, uid, SN);
    const r = await updateSet(uid, SN, { quantity_delta: -1 });
    assert.deepEqual(
      r.entfallen.map(e => [e.quantity, e.purchase_price]),
      [[1, 80]],
    );
    // Mit geändertem Preis findet die Suche nach einem gleichen Kauf die Zeile nicht mehr.
    const id = r.entfallen[0].id;
    await db.run('UPDATE set_acquisitions SET purchase_price = 85 WHERE id = $1', [id]);
    assert.equal((await pk.stelleWiederHer({ schreiber: uid }, r.papierkorb)).ok, true);
    assert.deepEqual(
      await kaeufe(db, uid, SN),
      vorher.map(z => (z.id === id ? { ...z, purchase_price: 85 } : z)),
    );
  });

  await t.test('derselbe Kauf am selben Tag neu erfasst: die neue Zeile nimmt die Menge auf', async () => {
    await erfasse(db, uid, SN, 1, { preis: 60, am: '2026-10-05T10:00:00Z' });
    const r = await updateSet(uid, SN, { quantity_delta: -1 });
    await erfasse(db, uid, SN, 1, { preis: 60, am: '2026-10-05T12:00:00Z' });
    assert.equal((await pk.stelleWiederHer({ schreiber: uid }, r.papierkorb)).ok, true);
    const am5 = (await kaeufe(db, uid, SN)).filter(z => Number(z.purchase_price) === 60);
    assert.deepEqual(
      am5.map(z => z.quantity),
      [2],
    );
    await updateSet(uid, SN, { quantity_delta: -2 });
  });

  await t.test('Unterkonto darf das Hauptkonto nicht ändern', async () => {
    const vorher = await mengeVon(db, [uid], SN);
    await assert.rejects(updateSet(kid, SN, { quantity_delta: -1, owner_user_id: uid }), {
      art: 'verboten',
    });
    assert.equal(await mengeVon(db, [uid], SN), vorher);
  });

  await t.test('Teil-Eintrag ohne Set: nichts geschrieben, Eintrag bleibt', async () => {
    const r = await updateSet(uid, SN, { quantity_delta: -1 });
    await db.run('DELETE FROM set_acquisitions WHERE user_id=$1 AND set_number=$2', [uid, SN]);
    await db.run('DELETE FROM sets WHERE user_id=$1 AND set_number=$2', [uid, SN]);
    assert.deepEqual(await pk.stelleWiederHer({ schreiber: uid }, r.papierkorb), {
      ok: false,
      code: 'nicht_gefunden',
    });
    assert.ok((await pk.listePapierkorb([uid])).some(e => e.id === r.papierkorb));
  });
});
