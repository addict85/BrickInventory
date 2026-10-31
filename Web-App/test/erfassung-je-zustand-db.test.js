/**
 * Zwei Zustände am selben Tag sind ZWEI Erfassungen, mit eigenen Preisen.
 *
 * ── Marcos Befund vom 21.10. ────────────────────────────────────────────────
 *
 *   „Beim Import der Liste dann darauf achten, dass wenn das Teil und Farbe
 *    bereits existiert und nur der Zustand anders ist, einen neuen Preis
 *    erzeugen mit einem anderen Zustand."
 *
 * GEMESSEN vorher, eine Wanted-Liste mit zweimal 3001 in Rot — 3 Stück NEU zu
 * 1.50 und 2 Stück GEBRAUCHT zu 0.50:
 *
 *   part_acquisitions: 1 Zeile — quantity 5, unit_price 1.10, condition 'U'
 *
 * 1.10 ist der mengengewichtete Mischpreis, und der Zustand wurde 'U', weil im
 * Projekt „gebraucht gewinnt". Die drei neuen Teile zu 1.50 standen damit als
 * gebraucht zu 1.10 in der Finanzansicht.
 *
 * ── Warum dieser Test NEBEN manual-acq-refresh.test.js steht ────────────────
 *
 * Dort wird der QUELLTEXT geprüft: dass der Zustand in der Bedingung steht und
 * „gebraucht gewinnt" beim Aufstocken weg ist. Das ist ein Netz gegen das
 * Zurückrutschen, aber es sagt nichts darüber, was am Ende in der Datenbank
 * liegt — und genau das ist Marcos Befund. Hier laufen deshalb echte
 * Erfassungen gegen eine echte Datenbank, mitsamt dem Unique-Index aus
 * Migration 0040. Eine Hälfte allein wäre schon einmal grün gewesen, während
 * die andere falsch war.
 *
 * ── Gegenproben (am 21.10. GEMESSEN, Zahlen abgeschrieben) ──────────────────
 *
 * Ausgangslage `# pass 6 / # fail 0` (fünf Fälle und ihre Hülle).
 *
 *   A  `AND COALESCE(condition, 'N') = $…` aus recordAcquisitionForDay
 *      entfernt (der Stand von Marcos Befund)
 *      → `pass 2 / fail 4`. Rot sind DREI Fälle: „zwei Zustände, zwei
 *        Zeilen" (`1 Zeile(n) statt 2`), „jede Zeile behält ihren eigenen
 *        Preis" und „der Datums-Endpunkt sieht den Zustand an" — der letzte
 *        nur mittelbar, weil die N-Zeile, die er sucht, gar nicht entstand.
 *        „Derselbe Zustand stockt weiterhin auf" bleibt grün: Diese Hälfte
 *        der Regel ändert sich nicht.
 *   B  Migration 0040 zurückgenommen (alter Index ohne Zustand)
 *      → `pass 1 / fail 5`. Rot sind VIER Fälle. Der Index verhindert die
 *        zweite Zeile schon in der Datenbank, und alles, was auf ihr aufbaut,
 *        fällt mit. Das ist der Beleg, dass die Migration trägt und nicht
 *        nur der Code.
 *   C  den Zustand aus findSameDayAcquisition entfernt
 *      → `pass 4 / fail 2`. Rot: „der Datums-Endpunkt sieht den Zustand an".
 *        Ohne ihn lehnt der Bearbeiten-Pfad ab, was der Anlege-Pfad gerade
 *        erlaubt — genau der Widerspruch, wegen dem diese Fassung einmal
 *        verworfen wurde.
 *
 * Gegenproben zu Migration 0047 (am 28.10. gemessen):
 *   D  recordAcquisitionForDay wieder als Lesen-Rechnen-Schreiben (Stand vor
 *      0047) → rot: „gleichzeitige Erfassungen gehen nicht verloren" (weniger
 *      als 12) und „gleicher Preis stockt auf …" (Mischpreis 3)
 *   E  price_estimated aus Index und Einfügen entfernt → rot: „ein
 *      eingesetzter Marktpreis ist als geschätzt gekennzeichnet"
 *   F  den Währungs-Trigger der Migration entfernt → rot: alle Fälle, weil
 *      die Pflichtspalte currency ohne ihn jedes Einfügen abweist
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');
const { recordAcquisitionForDay, findSameDayAcquisition } = _req('src/bestand/acquisitions.js');

test.after(async () => { await db.pool.end().catch(() => {}); });

test('eine Erfassung je Tag, Zustand, Preis und Währung', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  {
    const c = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  }

  const UID = (await db.get(
    `INSERT INTO users (username,password_hash) VALUES ('marco','x') RETURNING id`)).id;
  const TAG = '2026-10-21';

  /** Die Erfassungen eines Teils, vergleichbar aufbereitet. */
  const zeilen = async (nr) => (await db.all(
    `SELECT quantity, unit_price::float AS preis, COALESCE(condition,'N') AS zustand
       FROM part_acquisitions WHERE user_id=$1 AND part_number=$2
      ORDER BY zustand`, [UID, nr]))
    .map(z => ({ menge: Number(z.quantity), preis: z.preis, zustand: z.zustand }));

  await t.test('zwei Zustände, zwei Zeilen', async () => {
    await recordAcquisitionForDay('part', UID, ['3001', 4],
      { quantity: 3, price: 1.5, condition: 'N', createdAt: TAG });
    await recordAcquisitionForDay('part', UID, ['3001', 4],
      { quantity: 2, price: 0.5, condition: 'U', createdAt: TAG });
    const z = await zeilen('3001');
    assert.equal(z.length, 2,
      `${z.length} Zeile(n) statt 2: ${JSON.stringify(z)}. Vorher wurde der ` +
      'gebrauchte Kauf in den neuen gefaltet — Marcos Befund');
  });

  await t.test('jede Zeile behält ihren eigenen Preis', async () => {
    assert.deepEqual(await zeilen('3001'), [
      { menge: 3, preis: 1.5, zustand: 'N' },
      { menge: 2, preis: 0.5, zustand: 'U' },
    ], 'Der Mischpreis 1.10 wäre die alte Rechnung über zwei verschiedene Käufe');
  });

  await t.test('gleicher Preis stockt auf, ein anderer Preis bekommt eine eigene Zeile', async () => {
    // Seit Migration 0047: Kein Mischpreis mehr. Gleiche Käufe eines Tages
    // werden addiert (verlustfrei), verschiedene Preise bleiben getrennt.
    await recordAcquisitionForDay('part', UID, ['3002', 4],
      { quantity: 2, price: 2.0, condition: 'N', createdAt: TAG });
    await recordAcquisitionForDay('part', UID, ['3002', 4],
      { quantity: 1, price: 2.0, condition: 'N', createdAt: TAG });
    await recordAcquisitionForDay('part', UID, ['3002', 4],
      { quantity: 2, price: 4.0, condition: 'N', createdAt: TAG });
    assert.deepEqual(
      (await zeilen('3002')).sort((x, y) => x.preis - y.preis),
      [{ menge: 3, preis: 2, zustand: 'N' }, { menge: 2, preis: 4, zustand: 'N' }],
      'Die Einzelkäufe müssen rekonstruierbar bleiben — kein Mischpreis 3');
  });

  await t.test('gleichzeitige Erfassungen gehen nicht verloren', async () => {
    // Web und App erfassen dasselbe Teil im selben Augenblick.
    await Promise.all(Array.from({ length: 12 }, () =>
      recordAcquisitionForDay('part', UID, ['3004', 1],
        { quantity: 1, price: 1.0, condition: 'N', createdAt: TAG })));
    const z = await zeilen('3004');
    assert.deepEqual(z, [{ menge: 12, preis: 1, zustand: 'N' }],
      `Statt 12 sind ${z.reduce((s, r) => s + r.menge, 0)} angekommen: ${JSON.stringify(z)}`);
  });

  await t.test('ein eingesetzter Marktpreis ist als geschätzt gekennzeichnet', async () => {
    await recordAcquisitionForDay('part', UID, ['3005', 1],
      { quantity: 1, price: 0.3, condition: 'N', createdAt: TAG, geschaetzt: true });
    await recordAcquisitionForDay('part', UID, ['3005', 1],
      { quantity: 1, price: 0.3, condition: 'N', createdAt: TAG });
    const z = await db.all(
      `SELECT quantity, price_estimated FROM part_acquisitions
        WHERE user_id = $1 AND part_number = '3005' ORDER BY price_estimated`, [UID]);
    assert.deepEqual(z.map(r => [Number(r.quantity), r.price_estimated]), [[1, false], [1, true]],
      'Ein geschätzter und ein bezahlter Preis gleicher Höhe dürfen nicht verschmelzen');
  });

  await t.test('jede Erfassung trägt die Währung ihres Kontos', async () => {
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')
                  ON CONFLICT (user_id, key) DO UPDATE SET value = 'CHF'`, [UID]);
    await recordAcquisitionForDay('part', UID, ['3006', 1],
      { quantity: 1, price: 5, condition: 'N', createdAt: TAG });
    await db.run(`UPDATE user_settings SET value = 'EUR' WHERE user_id = $1 AND key = 'currency'`, [UID]);
    await recordAcquisitionForDay('part', UID, ['3006', 1],
      { quantity: 1, price: 5, condition: 'N', createdAt: TAG });
    const z = await db.all(
      `SELECT currency FROM part_acquisitions WHERE user_id = $1 AND part_number = '3006' ORDER BY currency`, [UID]);
    assert.deepEqual(z.map(r => r.currency), ['CHF', 'EUR'],
      'Nach dem Wechsel darf der alte CHF-Preis nicht zum EUR-Preis werden');
  });

  await t.test('der Unique-Index trägt die Regel, nicht nur der Code', async () => {
    // Migration 0040. Ohne den Index hätte ein Weg, der am Helfer vorbei
    // schreibt, freie Bahn — genau dafür gibt es ihn seit 0008.
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, condition, created_at)
       VALUES ($1,'3003',4,1,'N',$2::date)`, [UID, TAG]);
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, condition, created_at)
       VALUES ($1,'3003',4,1,'U',$2::date)`, [UID, TAG]);
    const doppelt = db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, condition, created_at)
       VALUES ($1,'3003',4,1,'N',$2::date)`, [UID, TAG]);
    await assert.rejects(doppelt, /duplicate key|unique/i,
      'Eine DRITTE Zeile mit einem schon belegten Zustand muss die Datenbank ' +
      'abweisen — sonst ist der Index zu weit geraten');
  });

  await t.test('der Datums-Endpunkt sieht den Zustand an', async () => {
    // Der zweite Schritt, ohne den die Fassung schon einmal verworfen wurde:
    // Der Bearbeiten-Pfad darf nicht ablehnen, was der Anlege-Pfad erlaubt.
    const n = await db.get(
      `SELECT id FROM part_acquisitions WHERE user_id=$1 AND part_number='3001'
         AND condition='N'`, [UID]);
    assert.ok(n, 'Vorbedingung: die N-Zeile von oben');
    assert.equal(
      await findSameDayAcquisition('part', UID, ['3001', 4], TAG, n.id, 'N', db, { preis: 1.5 }), null,
      'Gegen den EIGENEN Zustand ist der Tag frei — die eigene Zeile zählt nicht');
    const clash = await findSameDayAcquisition('part', UID, ['3001', 4], TAG, n.id, 'U', db, { preis: 0.5 });
    assert.ok(clash,
      'Gegen den ANDEREN Zustand mit gleichem Preis liegt dort eine Zeile. Wer sie ' +
      'übersieht, lässt eine Dublette entstehen — und der Index weist sie ab');
    assert.equal(
      await findSameDayAcquisition('part', UID, ['3001', 4], TAG, n.id, 'U', db, { preis: 0.9 }), null,
      'Mit anderem Preis ist es seit Migration 0047 eine eigene Zeile, keine Kollision');
  });
});
