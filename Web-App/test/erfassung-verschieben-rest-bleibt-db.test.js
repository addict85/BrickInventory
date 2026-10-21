/**
 * Eine Erfassung verschieben nimmt nur SIE mit — nicht den ganzen Bestand.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 *
 * Aus einem Fehler, den Migration 0038 eingebaut hat. moveManualAcquisition()
 * entschied, ob die Zeile des Absenders stehenbleibt, so:
 *
 *     const remaining = Math.max(0, (src.quantity || 1) - movingQty);
 *     …
 *     if (remaining > 0) return { …, source_emptied: false };
 *     await tx.run(`DELETE FROM ${acqTab} WHERE user_id = $1 AND ${keySql}`, …);
 *     await tx.run(`DELETE FROM ${table} WHERE id = $1`, [src.id]);
 *
 * `src.quantity` gibt es seit 0038 nicht mehr. Der Ausdruck ist damit
 * `(undefined || 1) - movingQty`, und weil movingQty mindestens 1 ist, war
 * `remaining` IMMER 0: Jedes Verschieben einer einzelnen Erfassung loeschte
 * ALLE Erfassungen des Absenders fuer diese Position und seine Bestandszeile
 * dazu — auch wenn er zehn hatte. Ohne Fehlermeldung.
 *
 * Der Set-Zweig daneben (moveSetAcquisition) rechnet es richtig: aus der
 * Summe der Erfassungen. Dort steht sogar der Kommentar, dass der Rueckfall
 * auf `src.quantity` entfernt wurde. Im manuellen Zweig blieb er stehen.
 *
 * ── Warum es keine Pruefung gefangen hat ────────────────────────────────────
 *
 * Es gab eine: test/household.test.js prueft, dass der Endpunkt
 * moveManualAcquisition() RUFT — mit einem Mustervergleich auf dem Quelltext.
 * Das faengt eine geloeschte Zeile und sagt nichts darueber, was die Funktion
 * TUT. Dieser Test geht deshalb den Weg, den die Oberflaeche nimmt, und sieht
 * danach in die Datenbank.
 *
 * ── Gegenproben (durchgefuehrt) ─────────────────────────────────────────────
 *
 *   a) Mit der alten Zeile (`src.quantity || 1`) ist der erste Fall rot:
 *      „Der Absender hat 0 Erfassungen uebrig, erwartet 1".
 *   b) Der zweite Fall prueft die andere Richtung — wandert die LETZTE
 *      Erfassung, MUSS die Zeile verschwinden. Ohne ihn waere der Test auch
 *      gruen, wenn nie geloescht wuerde.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { testServer } = require('./helpers/server');

test.after(async () => { await db.pool.end().catch(() => {}); });

test('eine von zwei Erfassungen verschieben laesst den Rest beim Absender',
  { concurrency: 1 }, async (t) => {
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

  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async (n) => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  const HAUPT = await id('haupt'), KIND = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`,
    [HAUPT, KIND]);

  await db.run(`INSERT INTO part_catalog (part_number,part_name) VALUES ('3001','Brick 2x4')`);
  await db.run(`INSERT INTO part_color_catalog (part_number,color_id,color_name)
                VALUES ('3001',4,'Rot')`);

  /**
   * Eine manuelle Position mit zwei Erfassungen an VERSCHIEDENEN Tagen.
   *
   * Verschiedene Tage, weil idx_part_acq_tag_zustand (Migration 0008) je Konto,
   * Position und Tag nur eine Erfassung erlaubt — mit demselben Datum braeche
   * das zweite INSERT ab, und der Aufbau waere gar nicht erst herzustellen.
   */
  const aufbau = async () => {
    await db.run(`DELETE FROM part_acquisitions`);
    await db.run(`DELETE FROM parts`);
    await db.run(`INSERT INTO parts (user_id,part_number,color_id,source)
                  VALUES ($1,'3001',4,'manual')`, [HAUPT]);
    await db.run(`INSERT INTO part_acquisitions
                    (user_id,part_number,color_id,quantity,unit_price,condition,created_at)
                  VALUES ($1,'3001',4,2,0.50,'N', NOW() - INTERVAL '2 days'),
                         ($1,'3001',4,3,0.60,'N', NOW() - INTERVAL '1 day')`, [HAUPT]);
    return (await db.all(
      `SELECT id, quantity FROM part_acquisitions WHERE user_id=$1 ORDER BY created_at`,
      [HAUPT])).map(r => ({ id: r.id, menge: Number(r.quantity) }));
  };

  const { base } = testServer(_req, {
    sitzung: { userId: HAUPT },
    apiNutzer: { user_id: HAUPT, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const verschiebe = async (erfassungId, nachKonto) => {
    const r = await fetch(`${base}/api/v1/parts/3001/4/acquisitions/${erfassungId}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_user_id: nachKonto }),
    });
    return { status: r.status, body: await r.json() };
  };
  const zaehle = async (uid) => ({
    erfassungen: (await db.all(
      `SELECT quantity FROM part_acquisitions WHERE user_id=$1 ORDER BY quantity`, [uid]))
      .map(r => Number(r.quantity)),
    zeilen: (await db.get(
      `SELECT COUNT(*)::int c FROM parts WHERE user_id=$1 AND part_number='3001'`, [uid])).c,
  });

  await t.test('die zweite Erfassung wandert, die erste bleibt', async () => {
    const erf = await aufbau();
    const a = await verschiebe(erf[0].id, KIND);   // die mit Menge 2
    assert.equal(a.status, 200, JSON.stringify(a.body));

    const absender = await zaehle(HAUPT);
    assert.deepEqual(absender.erfassungen, [3],
      `Der Absender hat ${absender.erfassungen.length} Erfassungen uebrig (${absender.erfassungen}), ` +
      'erwartet 1 mit Menge 3. Sind es 0, hat das Verschieben ALLE geloescht — ' +
      'genau der Fehler, um den es hier geht.');
    assert.equal(absender.zeilen, 1,
      'Die Bestandszeile des Absenders ist weg, obwohl er noch 3 Stueck hat');
    assert.equal(a.body.source_emptied, false,
      'Die Antwort sagt source_emptied=true, obwohl beim Absender etwas bleibt');

    const ziel = await zaehle(KIND);
    assert.deepEqual(ziel.erfassungen, [2], `Das Ziel hat ${ziel.erfassungen} statt [2]`);
    assert.equal(ziel.zeilen, 1, 'Das Ziel hat keine Bestandszeile bekommen');
  });

  await t.test('wandert die LETZTE Erfassung, verschwindet die Zeile doch', async () => {
    // Die Gegenrichtung. Ohne sie waere der Fall darueber auch gruen, wenn
    // nie geloescht wuerde — und eine manuelle Zeile ohne Erfassung ist
    // Ballast, kein Bestand.
    const erf = await aufbau();
    assert.equal((await verschiebe(erf[0].id, KIND)).status, 200);
    const zweite = (await db.all(
      `SELECT id FROM part_acquisitions WHERE user_id=$1`, [HAUPT])).map(r => r.id);
    assert.equal(zweite.length, 1, 'Vorbedingung: beim Absender muss genau eine uebrig sein');
    const b = await verschiebe(zweite[0], KIND);
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(b.body.source_emptied, true,
      'Die Antwort muss source_emptied=true melden, wenn beim Absender nichts bleibt');

    const absender = await zaehle(HAUPT);
    assert.deepEqual(absender.erfassungen, [], 'Beim Absender darf keine Erfassung bleiben');
    assert.equal(absender.zeilen, 0,
      'Die leere Bestandszeile des Absenders muss weg sein — eine manuelle Zeile ' +
      'ohne Erfassung ist Ballast, kein Bestand');

    const ziel = await zaehle(KIND);
    assert.deepEqual(ziel.erfassungen, [2, 3],
      `Das Ziel muss beide Mengen halten, hat ${JSON.stringify(ziel.erfassungen)}`);
  });
});
