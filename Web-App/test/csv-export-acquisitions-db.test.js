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
 *   • ein Set ohne Erfassungen liefert trotzdem eine Zeile — mit seiner Menge
 *   • ein Set mit mehreren Erfassungen liefert eine Zeile je Erfassung,
 *     aufsteigend nach Erfassungszeitpunkt
 *   • ein leerer Kaufpreis bleibt leer
 *   • ein fehlender Zustand wird zu 'N'
 *
 * ── Was Migration 0032 an diesem Test geändert hat ──────────────────────────
 * Der dritte Punkt lautete vorher: „ein leerer Kaufpreis wird NICHT vom
 * Set-Preis gefüllt — die naheliegende COALESCE-Formulierung im JOIN täte
 * genau das". Das war die heikelste Stelle des JOINs, weil `sets` einen
 * eigenen Kaufpreis trug. Seit Migration 0032 trägt sie keinen mehr: Der Fehler
 * ist nicht mehr behoben, sondern unmöglich. Die Prüfung bleibt stehen, weil
 * sie weiterhin eine Aussage über die Ausgabe macht — leer heisst leer.
 *
 * Der erste Punkt hat damit ebenfalls eine schwächere Bedeutung: Ein Set ohne
 * Erfassung hat nichts mehr, worauf es zurückfallen könnte. Die Zeile entsteht
 * trotzdem (LEFT JOIN) und trägt die Menge der Set-Zeile — und genau das ist
 * der Fall, den Migration 0032 nach dem Nachtragen nicht mehr erwartet, hier
 * aber von Hand hergestellt wird.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { haeltFigur, haeltSet, haeltTeil } = require('./helpers/bestand');
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
    // 0001-1  keine Erfassung        → eine Zeile, Menge 0
    // 0002-1  zwei Erfassungen       → zwei Zeilen, aelteste zuerst
    // 0003-1  Erfassung ohne Preis   → leeres Preisfeld
    // 0004-1  keine Erfassung        → Zustand 'N'
    //
    // Menge 0 heisst hier „Bestandszeile ohne Erfassung" — genau der Fall,
    // den die beiden ersten Zeilen beschreiben. Vorher stand die Menge in
    // sets.quantity und blieb auch ohne Erfassung stehen; seit Migration 0036
    // gibt es sie dort nicht, und „ohne Erfassung" heisst null Exemplare.
    // Die Mengen der anderen beiden kommen aus den Erfassungen darunter.
    for (const sn of ['0001-1', '0002-1', '0003-1', '0004-1']) {
      await haeltSet(db, uid, sn, 0);
    }
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, created_at)
       VALUES ($1,'0002-1',1,10.00,'N', NOW() - INTERVAL '2 days'),
              ($1,'0002-1',4,20.00,'U', NOW() - INTERVAL '1 day'),
              ($1,'0003-1',1,NULL,'N', NOW())`, [uid]);

    const csv = await _req('src/sets/setService.js').buildSetsCsv(uid);
    const r = zeilen(csv);
    const je = (sn) => r.filter(x => x.set_number === sn);

    assert.equal(r.length, 5, `5 Zeilen erwartet (1+2+1+1), bekommen ${r.length}:\n${csv}`);

    // Ohne Erfassung: eine Zeile mit Menge 0, ohne Preis, ohne Datum,
    // Zustand 'N'. Hier stand quantity '3' — die Menge der Set-Spalte, die es
    // seit Migration 0036 nicht mehr gibt, und purchase_price '12.5' aus der
    // Spalte, die Migration 0032 geloescht hat.
    assert.deepEqual(je('0001-1'),
      [{ set_number: '0001-1', quantity: '0', purchase_price: '', condition: 'N', acquired_at: '' }]);

    // Zwei Erfassungen, aelteste zuerst — die Reihenfolge traegt die Bedeutung.
    const zwei = je('0002-1');
    assert.equal(zwei.length, 2, 'zwei Erfassungen ergeben zwei Zeilen');
    assert.equal(zwei[0].quantity, '1', 'die aeltere Erfassung steht oben');
    assert.equal(zwei[1].quantity, '4');
    assert.equal(zwei[0].condition, 'N');
    assert.equal(zwei[1].condition, 'U');
    assert.match(zwei[0].acquired_at, /^\d{4}-\d{2}-\d{2}$/, 'Erfassungen tragen ihr Datum');

    // Erfassung vorhanden, aber ohne Preis → leeres Feld. Die Verwechslung mit
    // dem Set-Preis, gegen die diese Pruefung geschrieben wurde, kann es seit
    // Migration 0032 nicht mehr geben; die Aussage ueber die Ausgabe bleibt.
    const ohnePreis = je('0003-1');
    assert.equal(ohnePreis.length, 1);
    assert.equal(ohnePreis[0].purchase_price, '',
      'eine Erfassung ohne Preis muss ein leeres Feld ergeben');
    assert.equal(ohnePreis[0].condition, 'N', 'fehlender Zustand wird zu N');

    // Set ohne Erfassung: Menge 0, Zustand 'N', Preis leer.
    assert.deepEqual(je('0004-1'),
      [{ set_number: '0004-1', quantity: '0', purchase_price: '', condition: 'N', acquired_at: '' }]);
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
      await haeltSet(db, uid, sn, 0);  // Menge 0: die Erfassung dahinter traegt sie
      await db.run(
        `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition)
         VALUES ($1,$2,1,5.00,'N')`, [uid, sn]);
    }

    let abfragen = 0;
    db.pool.query = (...args) => { abfragen++; return echtesQuery(...args); };
    const csv = await _req('src/sets/setService.js').buildSetsCsv(uid);
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
    // fig-a  ohne Erfassung        → Figuren-Zeile
    // fig-b  Erfassung ohne Preis  → leeres Feld
    //
    // Der Preis stand hier einmal an der Figuren-Zeile (9.00 bzw. 42.00), und
    // die Zusage lautete: „eine Erfassung ohne Preis erbt NICHT den Preis der
    // Figuren-Zeile". Seit Migration 0035 gibt es dort keinen Preis mehr —
    // die FEHLERQUELLE ist weg, nicht nur der Fehler. Die Zusicherung bleibt
    // trotzdem: Sie haelt fest, dass eine leere Erfassung leer exportiert und
    // nicht etwa als 0.
    for (const [nr, name, menge] of [
      ['fig-a', 'Aaa', 2], ['fig-b', 'Bbb', 1],
    ]) {
      // Der Name steht seit Migration 0034 im Katalog — und er ist hier
      // nicht nebensaechlich: Der Export sortiert danach.
      await db.run(
        `INSERT INTO minifigs_catalog (fig_number, fig_name) VALUES ($1,$2)
         ON CONFLICT (fig_number) DO NOTHING`, [nr, name]);
      // fig-a bekommt KEINE Erfassung — das ist der Fall, den der Export
      // unterscheiden muss. Die Erfassung fuer fig-b legt der Test darunter an.
      // Menge 0: fig-b bekommt ihre Erfassung darunter, fig-a bewusst keine.
      await haeltFigur(db, uid, nr, { menge: 0 });
    }
    await db.run(
      `INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition)
       VALUES ($1,'fig-b',1,NULL,'U')`, [uid]);

    let abfragen = 0;
    db.pool.query = (...args) => { abfragen++; return echtesQuery(...args); };
    const csv = await _req('src/bestand/bestandExport.js').buildFigsCsv(uid);
    db.pool.query = echtesQuery;

    const r = zeilen(csv);
    assert.equal(r.length, 2, `2 Zeilen erwartet, bekommen ${r.length}:\n${csv}`);

    const a = r.find(x => x.fig_number === 'fig-a');
    // Hier stand '2' — die Zahl der Figuren-Zeile. Seit Migration 0038 gibt es
    // sie dort nicht mehr: Fuer eine MANUELLE Position ist die Stueckzahl die
    // Summe der Erfassungen, und ohne Erfassung ist das 0. Die Zeile bleibt
    // trotzdem im Export (sie steht im Bestand) — genau diese Unterscheidung
    // soll der Fall festhalten. Dieselbe Aenderung wie im Set-Export.
    assert.equal(a.quantity, '0', 'ohne Erfassung ist die Stueckzahl 0 — die Zeile bleibt aber');
    assert.equal(a.acquired_at, '', 'ohne Erfassung kein Datum');

    const b = r.find(x => x.fig_number === 'fig-b');
    assert.equal(b.unit_price, '',
      'eine Erfassung ohne Preis muss leer exportieren — nicht als 0');
    // Seit Migration 0047 ist der Zustand Pflicht; geprüft wird, dass er durchkommt.
    assert.equal(b.condition, 'U');

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

test('Teile-Export: dieselbe Regel, dieselbe eine Abfrage',
  { concurrency: 1 }, async (t) => {

  // ── Warum dieser Fall spaeter kam (Nachtrag 134) ──────────────────────────
  //
  // Diese Datei pruefte Sets und Minifiguren. buildPartsCsv blieb als einziger
  // der drei Zwillinge bei der Schleife — eine Abfrage JE TEIL — und faellt
  // damit unter genau die Ueberschrift, die oben steht. Gefunden nicht durch
  // Lesen, sondern durch eine Suche nach `await db.` innerhalb einer Schleife.
  //
  // Teile haben eine zweite Schluesselspalte, die Sets und Figuren nicht haben:
  // die FARBE. Derselbe Teiletyp in Rot und in Blau sind zwei Zeilen, und der
  // JOIN muss beide Spalten vergleichen — sonst erbt die rote Zeile die
  // Erfassungen der blauen. Dafuer steht der Fall `3001` unten.
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const nutzer = `teilexp-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [nutzer]).catch(() => {});
  const u = await db.get(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id', [nutzer, 'x']);
  const uid = u.id;

  const echtesQuery = db.pool.query.bind(db.pool);
  try {
    // 3001 / Farbe 4   zwei Erfassungen      → zwei Zeilen, aelteste zuerst
    // 3001 / Farbe 1   KEINE Erfassung       → Teile-Zeile, nicht die von Farbe 4
    // 3002 / Farbe 0   Erfassung ohne Preis  → leeres Feld
    //
    // Die Preise standen hier einmal an der Teile-Zeile — siehe die
    // Begruendung im Figuren-Teil darueber (Migration 0035).
    // Keine Stueckzahl in dieser Aufstellung: Seit Migration 0038 ist die
    // Menge einer manuellen Position die Summe ihrer Erfassungen, und die
    // legt der Test unten gezielt an. Eine Zahl hier waere eine, die nichts
    // bewirkt.
    for (const [nr, farbe, farbname] of [
      ['3001', 4, 'Rot'],
      ['3001', 1, 'Blau'],
      ['3002', 0, ''],
    ]) {
      // Name und Farbbezeichnung in die Kataloge (Migration 0034). Beide
      // stehen in der Exportspalte color_name bzw. in der Sortierung.
      await db.run(
        `INSERT INTO part_catalog (part_number, part_name) VALUES ($1,$2)
         ON CONFLICT (part_number) DO NOTHING`, [nr, `Teil ${nr}`]);
      await db.run(
        `INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES ($1,$2,$3)
         ON CONFLICT (part_number, color_id) DO NOTHING`, [nr, farbe, farbname]);
      // Menge 0: die Erfassungen legt der Test darunter gezielt an, damit die
      // Faelle „mit" und „ohne Preis" unterscheidbar bleiben.
      await haeltTeil(db, uid, nr, { menge: 0, colorId: farbe });
    }
    await db.run(
      `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, created_at)
       VALUES ($1,'3001',4,2,0.50,'N', NOW() - INTERVAL '2 days'),
              ($1,'3001',4,3,1.50,'U', NOW() - INTERVAL '1 day'),
              ($1,'3002',0,1,NULL,'U', NOW())`, [uid]);

    let abfragen = 0;
    db.pool.query = (...args) => { abfragen++; return echtesQuery(...args); };
    const csv = await _req('src/bestand/bestandExport.js').buildPartsCsv(uid);
    db.pool.query = echtesQuery;

    const r = zeilen(csv);
    assert.equal(r.length, 4, `4 Zeilen erwartet (2+1+1), bekommen ${r.length}:\n${csv}`);

    // Der Fall, den nur die Teile haben: gleiche Nummer, andere Farbe.
    const rot  = r.filter(x => x.part_number === '3001' && x.color_id === '4');
    const blau = r.filter(x => x.part_number === '3001' && x.color_id === '1');
    assert.equal(rot.length, 2, 'die rote Zeile hat zwei Erfassungen');
    assert.equal(blau.length, 1,
      'die blaue Zeile hat KEINE Erfassung — sie darf die der roten nicht erben');
    // Wie bei fig-a oben: ohne Erfassung ist die Stueckzahl 0, die Zeile
    // bleibt aber im Export.
    assert.equal(blau[0].quantity, '0', 'ohne Erfassung ist die Stueckzahl 0');
    assert.equal(blau[0].acquired_at, '', 'ohne Erfassung kein Datum');

    assert.equal(rot[0].quantity, '2', 'die aeltere Erfassung steht oben');
    assert.equal(rot[1].quantity, '3');
    assert.equal(rot[0].condition, 'N');
    assert.equal(rot[1].condition, 'U');
    assert.match(rot[0].acquired_at, /^\d{4}-\d{2}-\d{2}$/, 'Erfassungen tragen ihr Datum');

    const ohnePreis = r.find(x => x.part_number === '3002');
    assert.equal(ohnePreis.unit_price, '',
      'eine Erfassung ohne Preis muss leer exportieren — nicht als 0');
    assert.equal(ohnePreis.condition, 'U');

    assert.ok(abfragen >= 1, 'der Zaehler hat nichts erfasst — der Patch greift nicht mehr');
    assert.ok(abfragen <= 2,
      `${abfragen} Abfragen fuer 3 Teile. Frueher lief eine Abfrage JE TEIL; ` +
      `PARTS_CSV_SQL macht daraus eine.`);
  } finally {
    db.pool.query = echtesQuery;
    await db.run('DELETE FROM part_acquisitions WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM parts WHERE user_id = $1', [uid]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
  }
});
