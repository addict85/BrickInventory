/**
 * Neu erfasste Sets verändern die Prozentzahl der Portfolio-Kurve NICHT.
 *
 * Gegenprobe (durchgeführt): die Rückschreibung in src/finanzen/portfolioHistory.ts
 * entfernt (Ersteintrag wieder am eigenen Tag statt am Anfang der Reihe) →
 * der erste Teilschritt wird rot, mit +264 % statt −0,18 %.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { haeltSet } = require('./helpers/bestand');
const db = _req('db/database.js');

test('die Portfolio-Prozentzahl misst Preise, nicht Zukäufe', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req, { migrieren: false }))) return;

  const NUTZER = `pfz-${process.pid}`;
  const PRAEFIX = `86${(process.pid % 900) + 100}`;
  const SN = i => `${PRAEFIX}${String(i).padStart(2, '0')}-1`;

  const aufraeumen = async () => {
    await db.run(`DELETE FROM sets WHERE set_number LIKE $1`, [`${PRAEFIX}%`]).catch(() => {});
    await db.run(`DELETE FROM price_history WHERE set_number LIKE $1`, [`${PRAEFIX}%`]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x')`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  await aufraeumen();

  const { getPortfolioHistory } = _req('src/finanzen/portfolioHistory.js');
  const getSetting = async (_u, k, d) => (k === 'currency' ? 'CHF' : d);
  const kurve = async (period = 'week') => getPortfolioHistory(uid, [uid], period, db, getSetting);

  /** Set anlegen und ihm ab `abTag` Tagen vor heute einen Preisverlauf geben. */
  const setMit = async (i, abTag, preisAmAnfang, preisHeute) => {
    await haeltSet(db, uid, SN(i), 0); // Menge 0: die Erfassung dahinter traegt sie
    // Der Kaufpreis stand bis Migration 0032 in der sets-Zeile. Er steht jetzt
    // in der Erfassung — dieselbe Zahl, nur am einzigen Ort, an dem
    // portfolioHistory.ts ihn noch liest.
    await db.run(
      `INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,$2,1,10,'N')`,
      [uid, SN(i)],
    );
    for (let d = abTag; d >= 0; d--) {
      const preis = abTag === 0 ? preisHeute : preisAmAnfang + (preisHeute - preisAmAnfang) * ((abTag - d) / abTag);
      await db.run(
        `INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price,recorded_at)
         VALUES ($1,'N','CHF',$2,$2, CURRENT_DATE - $3::int + interval '9 hours')`,
        [SN(i), preis.toFixed(2), d],
      );
    }
  };

  try {
    // Ausgangslage: zwei Sets mit einer Woche Verlauf, Preis 100 → 110.
    await setMit(1, 6, 100, 110);
    await setMit(2, 6, 100, 110);
    const vorher = await kurve();
    assert.equal(vorher.period_change_pct, 10, `Grundfall stimmt nicht: ${vorher.period_change_pct} statt +10 %`);

    // Der Fall aus Marcos Bild: heute 24 Sets dazu
    for (let i = 3; i <= 26; i++) await setMit(i, 1, 50, 50);
    const nachher = await kurve();
    assert.ok(
      nachher.period_change_pct <= vorher.period_change_pct + 0.01,
      `Das Erfassen hat die Prozentzahl ERHÖHT: ${vorher.period_change_pct} → ` +
        `${nachher.period_change_pct}. Genau das war Marcos Befund (+850 %).`,
    );
    assert.ok(
      nachher.period_change_pct >= 0,
      `Zukäufe dürfen das Vorzeichen nicht drehen, war: ${nachher.period_change_pct}`,
    );
    assert.ok(
      nachher.period_change_pct <= 10,
      'Kein Set hat sich um mehr als 10 % bewegt — mehr darf die Summe nicht zeigen',
    );

    // Gegenrichtung: Bewegt sich ein PREIS, muss es sich zeigen — sonst wäre
    // auch eine fest verdrahtete Null grün.
    for (let i = 1; i <= 26; i++)
      await db.run(
        `UPDATE price_history SET avg_price = avg_price * 2, qty_avg_price = qty_avg_price * 2
          WHERE set_number=$1 AND recorded_at >= CURRENT_DATE`,
        [SN(i)],
      );
    const gestiegen = await kurve();
    assert.ok(
      gestiegen.period_change_pct > nachher.period_change_pct + 50,
      `Eine Preisverdopplung muss sich zeigen, war: ${gestiegen.period_change_pct}`,
    );

    // Und die Kurve selbst darf keinen Sprung mehr haben: Der erste Punkt
    // enthält bereits alle 26 Sets. Ohne die Rückschreibung stünde dort nur
    // der Wert der beiden alten.
    const p = gestiegen.points.map(x => x.value);
    assert.ok(p[0] > 1000, `Der erste Punkt enthält nicht den ganzen Bestand (2×100 + 24×50 = 1400), war: ${p[0]}`);

    // Alle Zeiträume müssen dieselbe Aussage treffen — die Monatsauflösung
    // (Jahr/Max) hat einen eigenen Weg für den Startpunkt, und der ist in
    // dieser Reihe schon einmal auseinandergelaufen.
    const werte = {};
    for (const per of ['week', 'month', 'year', 'max']) werte[per] = (await kurve(per)).period_change_pct;
    const einzig = [...new Set(Object.values(werte))];
    assert.equal(
      einzig.length,
      1,
      `Die Zeiträume sind sich uneinig: ${JSON.stringify(werte)} — bei Daten aus ` +
        'einer einzigen Woche müssen Woche, Monat, Jahr und Max dasselbe zeigen',
    );
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
