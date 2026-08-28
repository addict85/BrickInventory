/**
 * Diagramm und Besitzer-Label folgen dem TATSÄCHLICHEN Bestand.
 *
 * ── Marcos zwei Befunde ─────────────────────────────────────────────────────
 * 1. „Das Diagramm sollte nur den Wert der eingetragenen Status anzeigen. In
 *    diesem Fall ist nur ein gebrauchtes. Somit sollte der Verlauf von Neu
 *    nicht angezeigt werden."
 * 2. „Ich habe den Kaufpreis für den Marco gelöscht. Somit sollte auch das
 *    Label auf der Kachel von Marco nicht mehr angezeigt werden."
 *
 * ── Was dahinter steckte ────────────────────────────────────────────────────
 * Zu 1: Die Regel „nur Zustände, die auch im Bestand liegen" gab es bereits —
 * für `by_condition`. Der Diagramm-Aufbau stand im selben Modul ein paar
 * Zeilen davor und kannte sie nicht; er nahm immer beide Reihen. Dieselbe
 * Regel, zwei Stellen, eine davon vergessen. Es hing mehr daran als die
 * Legende: In der App speisen sich „Tief", „Aktuell" und „Hoch" aus den
 * Diagrammwerten, standen also auf den NEU-Preisen, während die Zeile darüber
 * korrekt den Gebrauchtpreis auswies.
 *
 * Zu 2: Beim Löschen der letzten Erfassung setzt `parentQuantitySql` die Menge
 * auf 0 und lässt die sets-Zeile stehen (bewusst — 0 ist ein gültiger Zustand,
 * etwa über den Mengenregler). `array_agg(DISTINCT s.user_id)` nahm sie
 * trotzdem mit, und das Konto stand weiter als Besitzer auf der Kachel.
 *
 * Beide Fixes liegen auf dem SERVER und wirken damit in Webapp und App
 * zugleich.
 *
 * Gegenproben (durchgeführt): Diagramm wieder fest auf beide Reihen → erster
 * Teilschritt rot (Reihen N,U statt U). FILTER entfernt → Besitzer-Teilschritt
 * rot (zwei Namen statt einem).
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Diagramm und Besitzer folgen dem Bestand', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const HAUPT = `bh-${process.pid}`, SUB = `bs-${process.pid}`;
  const SN = `83${process.pid % 900 + 100}-1`;

  const aufraeumen = async () => {
    for (const tab of ['sets', 'set_acquisitions', 'price_history', 'price_cache'])
      await db.run(`DELETE FROM ${tab} WHERE set_number=$1`, [SN]).catch(() => {});
  };

  await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]);
  await db.run(`INSERT INTO users (username,password_hash) VALUES ($1,'x'),($2,'x')`, [HAUPT, SUB]);
  const hauptId = (await db.get(`SELECT id FROM users WHERE username=$1`, [HAUPT])).id;
  const subId   = (await db.get(`SELECT id FROM users WHERE username=$1`, [SUB])).id;
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
               [hauptId, subId]);
  await aufraeumen();

  // Der Preis-Job schreibt BEIDE Zustände, unabhängig davon, was jemand
  // besitzt — genau daher kam die überzählige Reihe.
  for (const [cond, preis] of [['N', 7.99], ['U', 3.94]]) {
    await db.run(`INSERT INTO price_cache (set_number,condition,currency_code,avg_price,qty_avg_price,total_quantity)
                  VALUES ($1,$2,'CHF',$3,$3,5)`, [SN, cond, preis]);
    for (let d = 1; d >= 0; d--)
      await db.run(`INSERT INTO price_history (set_number,condition,currency_code,avg_price,qty_avg_price,recorded_at)
                    VALUES ($1,$2,'CHF',$3,$3, CURRENT_DATE - $4::int + interval '9 hours')`,
                   [SN, cond, preis, d]);
  }

  // Hauptkonto: Kaufpreis gelöscht → Menge 0, keine Erfassung mehr.
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition)
                VALUES ($1,$2,'T',0,'U')`, [hauptId, SN]);
  // Unterkonto: ein GEBRAUCHTES Exemplar mit Kaufpreis.
  await db.run(`INSERT INTO sets (user_id,set_number,name,quantity,condition,purchase_price)
                VALUES ($1,$2,'T',1,'U',3.94)`, [subId, SN]);
  await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                VALUES ($1,$2,3.94,'U',1)`, [subId, SN]);

  const { getSetPriceHistory } = _req('utils/priceHistory.js');
  const { getSets } = require('./helpers/sources').handlerModul(_req);

  try {
    await t.test('das Diagramm zeigt nur die Zustände im Bestand', async () => {
      const ph = await getSetPriceHistory([hauptId, subId], SN, 'CHF');
      assert.deepEqual(Object.keys(ph.by_condition), ['U'],
        'Vorbedingung: nur „gebraucht" ist erfasst');
      assert.deepEqual(ph.chart.values.map(v => v.name), ['U'],
        'Das Diagramm führt eine Reihe für einen Zustand, der nicht im Bestand liegt — ' +
        'die Legende zeigt dann „Neu" für ein Set, das es nur gebraucht gibt');
    });

    await t.test('Tief, Aktuell und Hoch stammen aus derselben Reihe', async () => {
      // Die App liest diese drei Zahlen aus den Diagrammwerten. Mit einer
      // überzähligen Reihe standen dort die Neupreise (3.94 / 7.99 / 7.99),
      // während die Zeile darüber CHF 3.94 auswies — zwei Antworten auf
      // dieselbe Frage, untereinander.
      const ph = await getSetPriceHistory([hauptId, subId], SN, 'CHF');
      const werte = ph.chart.values.flatMap(v => v.values.map(p => p.y)).filter(y => y > 0);
      assert.ok(werte.length, 'keine Diagrammwerte');
      assert.equal(Math.max(...werte), 3.94,
        `Der Höchstwert stammt aus dem falschen Zustand: ${Math.max(...werte)}`);
      assert.equal(Math.min(...werte), 3.94);
    });

    await t.test('ohne jede Erfassung bleibt der Verlauf trotzdem sichtbar', async () => {
      // Gegenrichtung: Ein Set ohne erfassten Kaufpreis hat trotzdem einen
      // Marktwert. Würde die Regel stur auf `by_condition` abstellen, wäre das
      // Diagramm hier leer — schlimmer als eine Reihe zu viel.
      await db.run(`DELETE FROM set_acquisitions WHERE set_number=$1`, [SN]);
      const ph = await getSetPriceHistory([hauptId, subId], SN, 'CHF');
      assert.deepEqual(Object.keys(ph.by_condition), []);
      assert.equal(ph.chart.values.length, 1,
        'Ohne Erfassung muss der Zustand des Bestandes übrig bleiben, nicht nichts');
      await db.run(`INSERT INTO set_acquisitions (user_id,set_number,purchase_price,condition,quantity)
                    VALUES ($1,$2,3.94,'U',1)`, [subId, SN]);
    });

    await t.test('ein Konto mit Menge 0 steht nicht mehr als Besitzer da', async () => {
      const r = await getSets([hauptId, subId], {});
      const zeile = r.sets.find(s => s.set_number === SN);
      assert.ok(zeile, 'das Set fehlt in der Galerie');
      assert.equal(zeile.quantity, 1, 'die Menge des Haushalts ist die Summe');
      const namen = (zeile.owners || []).map(o => o.username);
      assert.deepEqual(namen, [SUB],
        `Besitzer-Label falsch: ${namen.join(',')} — ein Konto, dessen Kaufpreis gelöscht ` +
        'wurde, hält kein Exemplar mehr');
    });

    await t.test('hält wieder jemand ein Exemplar, kommt das Label zurück', async () => {
      // Ohne diese Gegenrichtung wäre der Test auch grün, wenn das Label ganz
      // verschwände.
      await db.run(`UPDATE sets SET quantity=2 WHERE user_id=$1 AND set_number=$2`, [hauptId, SN]);
      const r = await getSets([hauptId, subId], {});
      const namen = (r.sets.find(s => s.set_number === SN).owners || []).map(o => o.username).sort();
      assert.deepEqual(namen, [HAUPT, SUB].sort(), 'beide Konten halten jetzt Exemplare');
    });
  } finally {
    await aufraeumen();
    await db.run(`DELETE FROM account_links WHERE main_user_id=$1`, [hauptId]).catch(() => {});
    await db.run(`DELETE FROM users WHERE username IN ($1,$2)`, [HAUPT, SUB]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
