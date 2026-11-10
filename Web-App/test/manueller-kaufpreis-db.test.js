/**
 * Teil und Minifigur ohne Marktpreis hinterlassen DASSELBE.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

test('ohne Marktpreis: Anzeigewert 0, Erfassung NULL — bei Teil UND Figur',
  { concurrency: 1 }, async (t) => {

  if (!await dbOderSkip(t, _req)) return;

  const name = `mkp_${process.pid}`;
  const TEIL = `mkpP${String(process.pid).slice(-5)}`;
  const FIG  = `mkpF${String(process.pid).slice(-5)}`;
  const u = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [name]);
  const uid = u.id;

  try {
    const { addManualPart } = _req('src/teile/manuelleTeile.js');
    const { addManualFig }  = _req('src/figuren/manuelleFiguren.js');

    // Namen mitgeben, damit kein Rebrickable-Nachschlag nötig ist. KEIN Preis
    // — darum geht es.
    await addManualPart(uid, { part_number: TEIL, part_name: 'Testteil', color_id: 0, quantity: 2 });
    await addManualFig(uid,  { fig_number: FIG,  fig_name: 'Testfigur',  quantity: 2 });

    // Gelesen ueber die Listen, die auch die Oberflaechen benutzen — die
    // Spalten gibt es seit Migration 0035 nicht mehr (siehe den Kopf).
    const { getManualParts }    = _req('src/teile/abfragen.js');
    const { getManualMinifigs } = _req('src/figuren/abfragen.js');
    const teileListe = await getManualParts([uid], uid);
    const figListe   = await getManualMinifigs([uid], uid);
    const teil  = (Array.isArray(teileListe) ? teileListe : [])
      .find(p => p.part_number === TEIL);
    const figur = (Array.isArray(figListe) ? figListe : [])
      .find(f => f.fig_number === FIG);
    assert.ok(teil,  'Das Teil steht nicht in der Liste');
    assert.ok(figur, 'Die Figur steht nicht in der Liste');

    // Ohne Eingabe steht in „Preis/Stk" nichts — bei beiden.
    assert.equal(teil.unit_price, null, 'Das Teil behauptet eine Preiseingabe');
    assert.equal(figur.unit_price, null, 'Die Figur behauptet eine Preiseingabe');

    // Der eigentliche Fund: der Anzeigewert trägt 0, nicht NULL — und zwar
    // bei beiden gleich.
    assert.equal(Number(teil.purchase_price), 0,
      `Das Teil hat ${teil.purchase_price} statt 0 im Kaufpreis`);
    assert.equal(Number(figur.purchase_price), 0,
      `Die Figur hat ${figur.purchase_price} statt 0 im Kaufpreis. src/finanzen/financeCalc.ts ` +
      'liest NULL als „kein Kaufpreis erfasst" und 0 als „0 erfasst" — die Figur ' +
      'verhielte sich damit anders als das Teil daneben.');
    assert.equal(figur.purchase_price === null, teil.purchase_price === null,
      'Teil und Figur sind sich uneins, ob ein unbekannter Marktpreis NULL oder 0 ist');

    // Und die feinere Hälfte: In der ERFASSUNG steht NULL, nicht 0.
    // Die Erfassungstabellen nennen die Spalte `unit_price`, nicht
    // `purchase_price` — nachgesehen, nicht angenommen (\d part_acquisitions).
    // Sie traegt den PREIS DIESER ERFASSUNG; der Anzeigewert daneben wird
    // beim Lesen gebildet.
    const teilErf = await db.get(
      'SELECT unit_price FROM part_acquisitions WHERE user_id=$1 AND part_number=$2', [uid, TEIL]);
    const figErf = await db.get(
      'SELECT unit_price FROM minifig_acquisitions WHERE user_id=$1 AND fig_number=$2', [uid, FIG]);
    assert.ok(teilErf, 'Zum Teil wurde keine Erfassung angelegt');
    assert.ok(figErf,  'Zur Figur wurde keine Erfassung angelegt');
    assert.equal(teilErf.unit_price, null,
      `Die Teil-Erfassung trägt ${teilErf.unit_price}; die 0 ist ein Anzeigewert ` +
      'und gehört hier nicht hin');
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
