/**
 * Der CSV-Export gibt je Erfassung eine Zeile — und braucht dafür EINE Abfrage.
 *
 * ── Warum es diesen Test gibt ───────────────────────────────────────────────
 * buildSetsCsv() und buildManualMinifigsCsv() holten die Erfassungen in einer
 * Schleife: eine Abfrage JE SET beziehungsweise je Minifigur. Bei 700 Sets sind
 * das 701 Hin- und Rückwege zur Datenbank statt einem. Der Export ist die
 * Stelle, an der ein Nutzer am ehesten den ganzen Bestand anfasst — also genau
 * die, an der das am meisten kostet.
 *
 * Dieser Test wurde VOR dem Umbau gegen die alte Fassung geschrieben und lief
 * dort grün. Er hält damit fest, was der Umbau NICHT ändern durfte:
 *
 *   • ein Set ohne Erfassungen fällt auf seine eigene Zeile zurück
 *   • ein Set mit mehreren Erfassungen liefert eine Zeile je Erfassung,
 *     aufsteigend nach Erfassungszeitpunkt
 *   • ein leerer Kaufpreis bleibt leer und wird NICHT vom Set-Preis gefüllt —
 *     die naheliegende COALESCE-Formulierung im JOIN täte genau das
 *   • ein fehlender Zustand wird zu 'N'
 *
 * Der dritte Punkt ist der, an dem ein JOIN am leichtesten falsch wird: Zu
 * einer vorhandenen Erfassung OHNE Preis gehört ein leeres Feld, nicht der
 * Preis der Set-Zeile.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

// Ohne das Schliessen des Verbindungspools endet der Testprozess nie: Der Pool
// haelt offene Verbindungen, und node wartet darauf. Dieselbe Zeile steht aus
// demselben Grund in den uebrigen -db-Tests.
test.after(async () => { await db.pool.end().catch(() => {}); });

/** CSV-Text → Zeilen als Objekte (die Kopfzeile bestimmt die Namen). */
function zeilen(csv) {
  const [kopf, ...rest] = csv.trim().split('\n').map(z => z.replace(/\r$/, ''));
  const namen = kopf.split(',');
  return rest.filter(Boolean).map(z => {
    const werte = z.split(',');
    return Object.fromEntries(namen.map((n, i) => [n, (werte[i] ?? '').replace(/^"|"$/g, '')]));
  });
}

test('Sets-Export: eine Zeile je Erfassung, ohne Erfassung die Set-Zeile',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const nutzer = `csvexp-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [nutzer]).catch(() => {});
  const u = await db.get(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [nutzer, 'x']);
  const uid = u.id;

  try {
    // ── Vier Faelle, jeder mit einer eigenen Aussage ────────────────────────
    // 0001-1  keine Erfassung        → faellt auf die Set-Zeile zurueck
    // 0002-1  zwei Erfassungen       → zwei Zeilen, aelteste zuerst
    // 0003-1  Erfassung ohne Preis   → leeres Feld, NICHT der Set-Preis
    // 0004-1  Set ohne Zustand       → 'N'
    for (const [sn, menge, preis, zustand] of [
      ['0001-1', 3, 12.50, 'N'], ['0002-1', 1, 99.00, 'N'],
      ['0003-1', 1, 77.00, 'U'], ['0004-1', 2, null, null],
    ]) {
      await db.run(
        `INSERT INTO sets (user_id, set_number, name, quantity, purchase_price, condition)
         VALUES ($1,$2,$3,$4,$5,$6)`, [uid, sn, `Set ${sn}`, menge, preis, zustand]);
    }
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, created_at)
       VALUES ($1,'0002-1',1,10.00,'N', NOW() - INTERVAL '2 days'),
              ($1,'0002-1',4,20.00,'U', NOW() - INTERVAL '1 day'),
              ($1,'0003-1',1,NULL,NULL, NOW())`, [uid]);

    const csv = await _req('utils/setService.js').buildSetsCsv(uid);
    const r = zeilen(csv);
    const je = (sn) => r.filter(x => x.set_number === sn);

    assert.equal(r.length, 5, `5 Zeilen erwartet (1+2+1+1), bekommen ${r.length}:\n${csv}`);

    // Ohne Erfassung: die Set-Zeile, ohne Datum.
    // '12.5' und nicht '12.50', obwohl die Spalte NUMERIC(12,4) ist:
    // db/database.ts stellt den pg-Typparser fuer NUMERIC auf parseFloat um.
    // Aus '12.5000' wird dadurch die Zahl 12.5, und csvField() schreibt
    // deren String-Form. Nachgesehen, nicht angenommen — die uebliche
    // Regel „numeric kommt als Zeichenkette" gilt in diesem Projekt nicht.
    assert.deepEqual(je('0001-1'),
      [{ set_number: '0001-1', quantity: '3', purchase_price: '12.5', condition: 'N', acquired_at: '' }]);

    // Zwei Erfassungen, aelteste zuerst — die Reihenfolge traegt die Bedeutung.
    const zwei = je('0002-1');
    assert.equal(zwei.length, 2, 'zwei Erfassungen ergeben zwei Zeilen');
    assert.equal(zwei[0].quantity, '1', 'die aeltere Erfassung steht oben');
    assert.equal(zwei[1].quantity, '4');
    assert.equal(zwei[0].condition, 'N');
    assert.equal(zwei[1].condition, 'U');
    assert.match(zwei[0].acquired_at, /^\d{4}-\d{2}-\d{2}$/, 'Erfassungen tragen ihr Datum');

    // Der heikle Fall: Erfassung ohne Preis. Das Feld bleibt LEER; es darf
    // nicht mit dem Preis der Set-Zeile (77.00) gefuellt werden.
    const ohnePreis = je('0003-1');
    assert.equal(ohnePreis.length, 1);
    assert.equal(ohnePreis[0].purchase_price, '',
      'eine Erfassung ohne Preis erbt NICHT den Preis der Set-Zeile');
    assert.equal(ohnePreis[0].condition, 'N', 'fehlender Zustand wird zu N');

    // Set ohne Zustand und ohne Preis.
    assert.deepEqual(je('0004-1'),
      [{ set_number: '0004-1', quantity: '2', purchase_price: '', condition: 'N', acquired_at: '' }]);
  } finally {
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM sets WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
  }
});

test('Sets-Export braucht EINE Abfrage, unabhaengig von der Anzahl Sets',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  // ── Warum gezaehlt und nicht gestoppt wird ────────────────────────────────
  // Eine Zeitmessung waere hier die schlechtere Pruefung: Sie schwankt mit der
  // Last der Maschine und braucht eine Schwelle, die entweder zu locker ist
  // oder sprunghaft rot wird. Die ANZAHL der Abfragen ist dagegen die Groesse,
  // um die es geht — sie darf mit dem Bestand nicht mitwachsen.
  const nutzer = `csvcnt-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [nutzer]).catch(() => {});
  const u = await db.get(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [nutzer, 'x']);
  const uid = u.id;

  // ── Gezaehlt wird an pool.query, NICHT an db.all ──────────────────────────
  //
  // Der erste Anlauf hat `db.all` ersetzt und dabei 0 Abfragen gezaehlt — die
  // Zusicherung war damit trivial erfuellt und der Test wertlos. Grund: Die
  // Module werden als ESM nach CommonJS uebersetzt, und `import * as db`
  // liefert ein Namensraum-Objekt, dessen Exporte als Getter gebunden sind. Ein
  // `db.all = …` von aussen laeuft dort ins Leere.
  //
  // `pool` ist dagegen eine gewoehnliche Instanz. Alle drei Zugriffswege des
  // Moduls (all, get, run) gehen durch `pool.query` — dort gezaehlt, ist die
  // Messung ausserdem vollstaendiger als an einer einzelnen Funktion.
  const echtesQuery = db.pool.query.bind(db.pool);
  try {
    for (let i = 1; i <= 25; i++) {
      const sn = `9${String(i).padStart(3, '0')}-1`;
      await db.run(
        `INSERT INTO sets (user_id, set_number, name, quantity, purchase_price, condition)
         VALUES ($1,$2,$3,1,5.00,'N')`, [uid, sn, `Set ${sn}`]);
      await db.run(
        `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition)
         VALUES ($1,$2,1,5.00,'N')`, [uid, sn]);
    }

    let abfragen = 0;
    db.pool.query = (...args) => { abfragen++; return echtesQuery(...args); };
    const csv = await _req('utils/setService.js').buildSetsCsv(uid);
    db.pool.query = echtesQuery;

    assert.equal(zeilen(csv).length, 25, 'alle 25 Sets stehen im Export');
    // Untergrenze: Zaehlte der Patch gar nichts, waere die Obergrenze darunter
    // trivial erfuellt — genau der Zustand, in dem dieser Test zuerst war.
    assert.ok(abfragen >= 1, 'der Zaehler hat nichts erfasst — der Patch greift nicht mehr');
    assert.ok(abfragen <= 2,
      `${abfragen} Abfragen fuer 25 Sets. Der Export holte die Erfassungen frueher ` +
      `je Set einzeln — bei 700 Sets waren das 701 Hin- und Rueckwege. Der LEFT JOIN ` +
      `in SETS_CSV_SQL macht daraus einen; erlaubt sind 2, weil der Rueckfallweg ` +
      `(fehlende Migration) eine zweite Abfrage kostet.`);
  } finally {
    db.pool.query = echtesQuery;
    await db.run('DELETE FROM set_acquisitions WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM sets WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
  }
});

test('Minifiguren-Export: dieselbe Regel, dieselbe eine Abfrage',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const nutzer = `figexp-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [nutzer]).catch(() => {});
  const u = await db.get(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [nutzer, 'x']);
  const uid = u.id;

  const echtesQuery = db.pool.query.bind(db.pool);
  try {
    // fig-a  ohne Erfassung          → Figuren-Zeile
    // fig-b  Erfassung ohne Preis    → leeres Feld, NICHT 42.00
    for (const [nr, name, menge, preis] of [
      ['fig-a', 'Aaa', 2, 9.00], ['fig-b', 'Bbb', 1, 42.00],
    ]) {
      await db.run(
        `INSERT INTO minifigs (user_id, fig_number, fig_name, quantity, unit_price, condition, source)
         VALUES ($1,$2,$3,$4,$5,'N','manual')`, [uid, nr, name, menge, preis]);
    }
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition)
       VALUES ($1,'fig-b',1,NULL,NULL)`, [uid]);

    let abfragen = 0;
    db.pool.query = (...args) => { abfragen++; return echtesQuery(...args); };
    const csv = await _req('routes/minifigs.js').buildFigsCsv(uid);
    db.pool.query = echtesQuery;

    const r = zeilen(csv);
    assert.equal(r.length, 2, `2 Zeilen erwartet, bekommen ${r.length}:\n${csv}`);

    const a = r.find(x => x.fig_number === 'fig-a');
    assert.equal(a.quantity, '2', 'ohne Erfassung zaehlt die Figuren-Zeile');
    assert.equal(a.acquired_at, '', 'ohne Erfassung kein Datum');

    const b = r.find(x => x.fig_number === 'fig-b');
    assert.equal(b.unit_price, '',
      'eine Erfassung ohne Preis erbt NICHT den Preis der Figuren-Zeile (42.00)');
    assert.equal(b.condition, 'N', 'fehlender Zustand wird zu N');

    assert.ok(abfragen >= 1, 'der Zaehler hat nichts erfasst — der Patch greift nicht mehr');
    assert.ok(abfragen <= 2,
      `${abfragen} Abfragen fuer 2 Figuren. Frueher lief eine Abfrage JE FIGUR; ` +
      `FIGS_CSV_SQL macht daraus eine.`);
  } finally {
    db.pool.query = echtesQuery;
    await db.run('DELETE FROM minifig_acquisitions WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM minifigs WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
  }
});
