/**
 * Teil und Minifigur ohne Marktpreis hinterlassen DASSELBE.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * `resolveManualPartPurchase` (routes/parts.ts) und `resolveManualFigPurchase`
 * (routes/minifigs.ts) waren bis auf die Marktpreis-Abfrage gleich — mit einem
 * Unterschied, den die Doppelungsmessung sichtbar gemacht hat:
 *
 *     Teile:       … ?? 0     ← liefert BrickLink nichts, steht 0 in der Zeile
 *     Minifiguren: (fehlte)   ← dann stand NULL
 *
 * Bei den Teilen steht der Grund im Quelltext: „sonst zeigt das Kaufpreis-Feld
 * im Frontend dauerhaft den Marktpreis-Platzhalter". utils/financeCalc.ts liest
 * beide Fälle unterschiedlich (`hasCost = … != null; // 0 zählt als erfasst`):
 * Eine Figur ohne ermittelbaren Marktpreis galt als „kein Kaufpreis erfasst",
 * ein Teil in derselben Lage als „0 erfasst". Derselbe Fix war bei den Teilen
 * gemacht und bei den Figuren liegen geblieben.
 *
 * ── Der zweite Teil, und der ist der feinere ────────────────────────────────
 *
 * In der STAMMZEILE ist die 0 ein Anzeigewert. In der ERFASSUNG hiesse sie
 * „für null Franken gekauft" — dort gehört NULL hin. Diese Umwandlung stand
 * in routes/minifigs.ts an EINER von DREI Stellen: bei der Zweiterfassung ja,
 * bei der Neuanlage nein, im CSV-Import nein.
 *
 * Beides ist jetzt eine Sache: utils/preisRegel.ts gibt `kaufpreis` (nie null)
 * und `erfassungsPreis` (null, wenn unbekannt) getrennt zurück, und keine
 * Schreibstelle rechnet mehr selbst.
 *
 * ── Warum gegen die echte Datenbank ────────────────────────────────────────
 *
 * Am Quelltext wäre es die Frage, ob dieselbe Variable an beiden Stellen
 * steht. Interessant ist, was am Ende IN DEN TABELLEN liegt — und zwar beim
 * Teil und bei der Figur verglichen. Dieselbe Begründung wie in
 * teile-import-preis-db.test.js nebenan.
 *
 * Ohne BrickLink-Zugang liefert die Marktpreis-Abfrage nichts; genau das ist
 * der Fall, um den es geht, und im Testlauf ist er der Normalfall.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('ohne Marktpreis: Stammzeile 0, Erfassung NULL — bei Teil UND Figur',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const name = `mkp_${process.pid}`;
  const TEIL = `mkpP${String(process.pid).slice(-5)}`;
  const FIG  = `mkpF${String(process.pid).slice(-5)}`;
  const u = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [name]);
  const uid = u.id;

  try {
    const { addManualPart } = _req('routes/parts.js');
    const { addManualFig }  = _req('routes/minifigs.js');

    // Namen mitgeben, damit kein Rebrickable-Nachschlag nötig ist. KEIN Preis
    // — darum geht es.
    await addManualPart(uid, { part_number: TEIL, part_name: 'Testteil', color_id: 0, quantity: 2 });
    await addManualFig(uid,  { fig_number: FIG,  fig_name: 'Testfigur',  quantity: 2 });

    const teil = await db.get(
      'SELECT unit_price, purchase_price FROM parts WHERE user_id=$1 AND part_number=$2', [uid, TEIL]);
    const figur = await db.get(
      'SELECT unit_price, purchase_price FROM minifigs WHERE user_id=$1 AND fig_number=$2', [uid, FIG]);
    assert.ok(teil,  'Das Teil steht nicht in der Tabelle');
    assert.ok(figur, 'Die Figur steht nicht in der Tabelle');

    // Ohne Eingabe steht in „Preis/Stk" nichts — bei beiden.
    assert.equal(teil.unit_price, null, 'Das Teil behauptet eine Preiseingabe');
    assert.equal(figur.unit_price, null, 'Die Figur behauptet eine Preiseingabe');

    // Der eigentliche Fund: die Stammzeile trägt 0, nicht NULL — und zwar
    // bei beiden gleich.
    assert.equal(Number(teil.purchase_price), 0,
      `Das Teil hat ${teil.purchase_price} statt 0 im Kaufpreis`);
    assert.equal(Number(figur.purchase_price), 0,
      `Die Figur hat ${figur.purchase_price} statt 0 im Kaufpreis. utils/financeCalc.ts ` +
      'liest NULL als „kein Kaufpreis erfasst" und 0 als „0 erfasst" — die Figur ' +
      'verhielte sich damit anders als das Teil daneben.');
    assert.equal(figur.purchase_price === null, teil.purchase_price === null,
      'Teil und Figur sind sich uneins, ob ein unbekannter Marktpreis NULL oder 0 ist');

    // Und die feinere Hälfte: In der ERFASSUNG steht NULL, nicht 0.
    // Die Erfassungstabellen nennen die Spalte `unit_price`, nicht
    // `purchase_price` — nachgesehen, nicht angenommen (\d part_acquisitions).
    // Sie traegt den PREIS DIESER ERFASSUNG; die Stammzeile hat beide Felder.
    const teilErf = await db.get(
      'SELECT unit_price FROM part_acquisitions WHERE user_id=$1 AND part_number=$2', [uid, TEIL]);
    const figErf = await db.get(
      'SELECT unit_price FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2', [uid, FIG]);
    assert.ok(teilErf, 'Zum Teil wurde keine Erfassung angelegt');
    assert.ok(figErf,  'Zur Figur wurde keine Erfassung angelegt');
    assert.equal(teilErf.unit_price, null,
      `Die Teil-Erfassung trägt ${teilErf.unit_price}; die 0 der Stammzeile ist ein ` +
      'Anzeigewert und gehört hier nicht hin');
    assert.equal(figErf.unit_price, null,
      `Die Figuren-Erfassung trägt ${figErf.unit_price} statt NULL — die Umwandlung ` +
      'stand in routes/minifigs.ts an einer von drei Schreibstellen');
  } finally {
    await db.run('DELETE FROM part_acquisitions WHERE user_id=$1', [uid]).catch(() => {});
    await db.run('DELETE FROM minifig_acquisitions WHERE user_id=$1', [uid]).catch(() => {});
    await db.run('DELETE FROM parts WHERE user_id=$1', [uid]).catch(() => {});
    await db.run('DELETE FROM minifigs WHERE user_id=$1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
