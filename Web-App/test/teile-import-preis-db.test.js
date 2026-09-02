/**
 * CSV-Import und Erfassen von Hand müssen dasselbe hinterlassen.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Bei den Minifiguren steht die Rechnung „Preis/Stk, Kaufpreis, Zustand"
 * EINMAL (resolveManualFigPurchase) und hat drei Aufrufer. Bei den Teilen
 * stand sie an jeder Stelle neu — und die Fassungen im Anlegen und im
 * CSV-Import sagten zweierlei:
 *
 *  1. `unit_price` bekam beim Import den MARKTPREIS. Das Feld heisst
 *     „Preis/Stk" und bedeutet „was der Mensch bezahlt hat"; ohne Angabe in
 *     der Datei gehört dort NULL hin. jobs/purchasePriceBackfill.ts liest
 *     unit_price ausdrücklich als „wurde beim Erfassen eingegeben" — ein
 *     importiertes Teil behauptete eine Eingabe, die es nie gab.
 *
 *  2. Ohne Marktpreis schrieb der Import NULL in den Kaufpreis. Beim Anlegen
 *     von Hand wird dort bewusst 0 gespeichert, sonst zeigt das Feld im
 *     Frontend dauerhaft den „Marktpreis"-Platzhalter.
 *
 * ── Warum gegen die echte Route ─────────────────────────────────────────────
 * Am Quelltext wäre es die Frage, ob zweimal dieselbe Variable im INSERT
 * steht. Interessant ist aber, was am Ende IN DER TABELLE liegt — und zwar
 * verglichen mit dem anderen Weg zum selben Ziel. Deshalb läuft hier der
 * echte Import über eine echte Datei gegen eine echte Datenbank, und daneben
 * derselbe Fall von Hand.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const express = require('express');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Import ohne Preis hinterlässt dasselbe wie Erfassen ohne Preis', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const name = `imp_${process.pid}`;
  const IMPORTIERT = `imp${String(process.pid).slice(-5)}`;
  const VON_HAND   = `hnd${String(process.pid).slice(-5)}`;
  const u = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [name]);
  const uid = u.id;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: uid }; next(); });
  app.use('/api/parts', _req('routes/parts.js'));
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}`;

  try {
    // part_name steht in der Datei, damit kein Rebrickable-Nachschlag nötig
    // ist. Ein Preis steht NICHT drin — genau darum geht es.
    const csv = `part_number,part_name,quantity\n${IMPORTIERT},Testteil,3\n`;
    const fd = new FormData();
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'teile.csv');
    const antwort = await fetch(`${base}/api/parts/import/csv`, { method: 'POST', body: fd });
    const ergebnis = await antwort.json();
    assert.equal(ergebnis.success, true, `Import fehlgeschlagen: ${JSON.stringify(ergebnis)}`);
    assert.equal(ergebnis.added, 1, `Es wurde nichts angelegt: ${JSON.stringify(ergebnis)}`);

    // Derselbe Fall von Hand, ueber dieselbe Route wie die Webapp.
    const { addManualPart } = _req('routes/parts.js');
    await addManualPart(uid, { part_number: VON_HAND, part_name: 'Testteil', color_id: 0, quantity: 3 });

    const spalten = 'unit_price, purchase_price, condition';
    const imp = await db.get(
      `SELECT ${spalten} FROM parts WHERE user_id=$1 AND part_number=$2`, [uid, IMPORTIERT]);
    const hand = await db.get(
      `SELECT ${spalten} FROM parts WHERE user_id=$1 AND part_number=$2`, [uid, VON_HAND]);
    assert.ok(imp,  'Das importierte Teil steht nicht in der Tabelle');
    assert.ok(hand, 'Das von Hand erfasste Teil steht nicht in der Tabelle');

    // Der eigentliche Fehler: Ohne Angabe in der Datei darf im Feld
    // „Preis/Stk" nichts stehen.
    assert.equal(imp.unit_price, null,
      `Der Import hat ${imp.unit_price} als Preis/Stk eingetragen, obwohl in der ` +
      'Datei keiner stand. Das Feld bedeutet „was der Mensch bezahlt hat" — ' +
      'jobs/purchasePriceBackfill.ts liest es genau so.');

    // Und die Regel dahinter: BEIDE Wege hinterlassen dasselbe.
    assert.deepEqual(
      { unit_price: imp.unit_price, purchase_price: imp.purchase_price, condition: imp.condition },
      { unit_price: hand.unit_price, purchase_price: hand.purchase_price, condition: hand.condition },
      'CSV-Import und Erfassen von Hand hinterlassen verschiedene Zeilen für ' +
      'denselben Fall. Beide rechnen über resolveManualPartPurchase — weichen ' +
      'sie ab, rechnet einer der beiden wieder selbst.');
  } finally {
    srv.close();
    await db.run(`DELETE FROM part_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM parts WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
