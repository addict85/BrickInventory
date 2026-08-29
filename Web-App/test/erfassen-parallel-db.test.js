/**
 * Erfassen: gleichzeitig, und mit unsinnigen Eingaben.
 *
 * ── Warum echte Nebenläufigkeit ─────────────────────────────────────────────
 * Der Fehler war am laufenden Server sichtbar: Zehn parallele Erfassungen
 * desselben Sets ergaben sets.quantity = 10, aber drei Erfassungszeilen mit
 * Summe 7 — drei verlorene Exemplare und drei Tageszeilen, wo genau eine
 * erlaubt ist. Eine Quelltextprüfung („steht withInventoryLock im
 * Erfassen-Pfad?") würde das erste Symptom bemerken, aber nicht das zweite,
 * und sie sagt nichts darüber, ob die Sperre auch GREIFT.
 *
 * Deshalb hier: echte parallele Aufrufe gegen echte Postgres-Verbindungen.
 * Ohne Sperre schlagen die Prüfungen sofort an — nachgewiesen per Gegenprobe.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 * Ohne DB: skip.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db   = _req('db/database.js');

test('Erfassen unter Last', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }

  const { recordAcquisitionForDay } = _req('utils/acquisitions.js');
  const { withInventoryLock } = _req('utils/txLock.js');

  await db.run("INSERT INTO users (username,password_hash) VALUES ('last','x')");
  const uid = (await db.get("SELECT id FROM users WHERE username='last'")).id;

  const stand = async (sn) => db.get(
    `SELECT COUNT(*)::int AS zeilen, COALESCE(SUM(quantity),0)::int AS menge
       FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [uid, sn]);

  await t.test('zehn gleichzeitige Erfassungen ergeben EINE Tageszeile mit Menge 10', async () => {
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES ($1,'70001-1','S',0)`, [uid]);
    await Promise.all(Array.from({ length: 10 }, () =>
      withInventoryLock(uid, '70001-1', (tx) =>
        recordAcquisitionForDay('set', uid, ['70001-1'], { quantity: 1, price: 10, condition: 'N' }, tx))
    ));

    const s = await stand('70001-1');
    assert.equal(s.menge, 10, `Menge ${s.menge} statt 10 — Erfassungen sind verloren gegangen`);
    assert.equal(s.zeilen, 1, `${s.zeilen} Tageszeilen statt einer — die Regel „ein Kaufpreis je Tag" ist verletzt`);
  });

  await t.test('der Index lässt eine zweite Tageszeile gar nicht erst zu', async () => {
    // Das Netz unter der Sperre: Ein Weg, der die Sperre vergisst, scheitert
    // an der Datenbank statt still eine zweite Zeile anzulegen.
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                  VALUES ($1,'70002-1',1,5,'N')`, [uid]);
    await assert.rejects(
      () => db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition)
                    VALUES ($1,'70002-1',1,5,'N')`, [uid]),
      /duplicate key|unique/i,
      'Eine zweite Erfassung desselben Tages war möglich — der Index fehlt');
  });

  await t.test('dasselbe für manuelle Teile und Minifiguren', async () => {
    await db.run(`INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
                  VALUES ($1,'3001',4,1,0.5,'N')`, [uid]);
    await assert.rejects(() => db.run(
      `INSERT INTO part_acquisitions (user_id,part_number,color_id,quantity,unit_price,condition)
       VALUES ($1,'3001',4,1,0.5,'N')`, [uid]), /duplicate key|unique/i);

    await db.run(`INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
                  VALUES ($1,'sw0001',1,3,'N')`, [uid]);
    await assert.rejects(() => db.run(
      `INSERT INTO minifig_acquisitions (user_id,fig_number,quantity,unit_price,condition)
       VALUES ($1,'sw0001',1,3,'N')`, [uid]), /duplicate key|unique/i);
  });

  await t.test('ein anderer TAG bleibt eine eigene Zeile', async () => {
    await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,purchase_price,condition,created_at)
                  VALUES ($1,'70002-1',1,5,'N', NOW() - INTERVAL '2 days')`, [uid]);
    const s = await stand('70002-1');
    assert.equal(s.zeilen, 2, 'Der Index darf nur den GLEICHEN Tag verhindern');
  });

  await db.pool.end().catch(() => {});
});

test('Mengen und Preise werden geprüft', () => {
  const V = _req('utils/validate.js');

  // Menge: 1 bis 10 000, alles andere wird eingefangen.
  assert.equal(V.acquisitionQuantity(-5), 1, 'negative Menge kam durch');
  assert.equal(V.acquisitionQuantity(0), 1);
  assert.equal(V.acquisitionQuantity(999999999), 10000, 'unplausible Menge kam durch');
  assert.equal(V.acquisitionQuantity('3'), 3);
  assert.equal(V.acquisitionQuantity(undefined), 1);

  // Preis: leer heisst „kein Preis", negativ wird abgelehnt.
  assert.equal(V.optionalPrice(''), null);
  assert.equal(V.optionalPrice(null), null);
  assert.equal(V.optionalPrice('49,90'), 49.9, 'Komma als Dezimaltrenner');
  assert.equal(V.optionalPrice(0), 0, '0 ist ein gültiger Preis, kein fehlender');
  assert.throws(() => V.optionalPrice(-20), /negativ/,
    'ein negativer Kaufpreis senkt stillschweigend den Gesamtwert der Sammlung');
  assert.throws(() => V.optionalPrice(5_000_000), /unplausibel/);
});

test('alle Erfassen-Wege nutzen dieselbe Prüfung', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT, ohneKommentare } = require('./helpers/sources');

  // Webapp UND Android-API, Sets wie manuelle Einträge — vier Wege, eine Regel.
  for (const rel of ['routes/sets.ts', 'routes/api_v1/sets.ts', 'routes/parts.ts', 'routes/minifigs.ts']) {
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.match(src, /acquisitionQuantity\(/, `${rel}: Menge ungeprüft`);
    assert.match(src, /optionalPrice\(/,       `${rel}: Preis ungeprüft`);
  }

  // Und der Erfassen-Pfad schreibt gesperrt.
  const sets = ohneKommentare(require('./helpers/sources').setKernQuelle());
  // Nur der Rumpf von addSet(): bis zur NÄCHSTEN Funktion auf oberster Ebene.
  // Ein Schnitt bis addSetWithDate() umfasste 1200 Zeilen samt fremder Routen
  // und zählte deren Sperren mit.
  const beginn = sets.indexOf('async function addSet(');
  const naechste = sets.slice(beginn + 10).search(/\n(?:async )?function [a-zA-Z_$]/);
  const addSet = sets.slice(beginn, beginn + 10 + naechste);
  const schreibt = (addSet.match(/recordAcquisition\(/g) || []).length;
  assert.ok(schreibt >= 2, `nur ${schreibt} Erfassungs-Schreibstellen gefunden`);
  assert.equal((addSet.match(/withInventoryLock\(/g) || []).length, schreibt,
    'nicht jede Schreibstelle in addSet() läuft unter der Bestandssperre');
});

test('ein kaputter CSV-Eintrag kippt nicht die ganze Datei', () => {
  const { csvEinlesen, uebersprungenHinweis } = _req('utils/csvExport.js');

  // Genau die Datei, die am laufenden Server den Import komplett abbrach:
  // Zeile 3 hat eine Spalte statt drei.
  const kaputt = 'set_number,quantity,purchase_price\n10280,1,20\nMÜLL;;;\n75192,2,30\n';
  const r = csvEinlesen(kaputt);
  assert.equal(r.records.length, 3,
    'brauchbare Zeilen gingen verloren — vorher brach der ganze Import ab');
  assert.equal(r.records[0].set_number, '10280');
  assert.equal(r.records[2].set_number, '75192', 'die Zeile NACH dem Fehler fehlt');

  // Semikolon-Dateien werden weiterhin erkannt.
  const semi = csvEinlesen('set_number;quantity\n10280;2\n');
  assert.equal(semi.delimiter, ';');
  assert.equal(semi.records[0].quantity, '2');

  // Wirklich leere Zeilen zählen als übersprungen und werden benannt.
  const leer = csvEinlesen('set_number,quantity\n10280,1\n,\n');
  assert.equal(leer.records.length, 1);
  assert.deepEqual(leer.uebersprungen, [3], 'Zeilennummer wie im Editor, 1-basiert mit Kopfzeile');
  assert.match(uebersprungenHinweis(leer.uebersprungen), /1 Zeile\(n\) übersprungen \(Zeile 3\)/);
  assert.equal(uebersprungenHinweis([]), null, 'ohne Übersprungene kein Hinweis');
});

test('alle drei Importwege melden übersprungene Zeilen', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT, ohneKommentare } = require('./helpers/sources');
  for (const rel of ['routes/sets.ts', 'routes/parts.ts', 'routes/minifigs.ts']) {
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.match(src, /csvEinlesen\(/, `${rel}: liest noch selbst`);
    assert.match(src, /skipped_hint/,  `${rel}: sagt dem Nutzer nichts über übersprungene Zeilen`);
  }
  // Und die Oberfläche zeigt den Hinweis auch an.
  for (const rel of ['public/js/02-gallery.js', 'public/js/06-minifigs.js']) {
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.match(src, /skipped_hint/, `${rel}: Hinweis kommt an, wird aber nicht gezeigt`);
  }
});

test('die Teileliste liefert, was sie meldet', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROOT, ohneKommentare } = require('./helpers/sources');
  const H = require('./helpers/sources').handlerModul(_req);

  // ── Die Teileliste EINES Sets darf mehr als eine normale Seite liefern ────
  //
  // Die Set-Detailansicht der App fragt page_size=2000 und holt nur Seite 1.
  // clampPageSize deckelte auf 500: Ein Set mit 915 Teilezeilen kam als 500
  // Zeilen an — und die Antwort meldete „page_size: 2000", spiegelte also die
  // Anfrage zurück. Damit konnte kein Client merken, dass Teile fehlen. Auch
  // die PDF-Teileliste baut auf dieser Antwort auf.
  assert.ok(H.SET_PARTS_MAX_PAGE_SIZE > H.MAX_PAGE_SIZE,
    'Ein einzelnes Set braucht eine höhere Grenze als die allgemeine Liste');
  assert.ok(H.SET_PARTS_MAX_PAGE_SIZE >= 5000,
    'Grosse Sets haben mehrere tausend Teilezeilen');

  const src = ohneKommentare(require('./helpers/sources').handlerQuelle());
  // Beide Abfragewege (Zusammenfassung und Live) müssen dieselbe Grenze
  // kennen — dass sie sich unterschiedlich deckelten, war schon einmal ein
  // Fehler (dieselbe Anfrage lieferte je nach Cache-Zustand 500 oder 5000).
  assert.equal((src.match(/SET_PARTS_MAX_PAGE_SIZE/g) || []).length >= 3, true,
    'Die Set-Grenze gilt nicht auf beiden Abfragewegen');
  assert.equal((src.match(/UNPAGED_LIMIT/g) || []).length >= 3, true,
    'Die Grenze für Aufrufe ohne page_size gilt nicht auf beiden Wegen');

  // Die Antwort meldet die TATSÄCHLICHE Seitengrösse, nicht die angefragte.
  const v1 = ohneKommentare(fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'parts.ts'), 'utf8'));
  const antwort = v1.slice(v1.indexOf("router.get('/parts'"), v1.indexOf("router.get('/parts/brick-colors'"));
  // Geprüft wird, WOHER die Zahl kommt, nicht wie die Zeile geschrieben ist.
  //
  // Vorher stand hier der Wortlaut `page_size: result.page_size`. Der war seit
  // jeher wirkungslos — er stand VOR `...result`, das ihn mit demselben Wert
  // überschrieb — und wurde beim Aufräumen entfernt. Der Test wurde dadurch
  // rot, obwohl die Antwort sich um kein Byte geändert hat.
  assert.match(antwort, /\.\.\.result/,
    'Die Antwort übernimmt das Ergebnis von getParts nicht mehr — dann fehlt page_size ganz');
  assert.doesNotMatch(antwort, /page_size:\s*(parseInt\()?(String\()?req\.query/,
    'Die Antwort spiegelt wieder die Anfrage zurück statt zu sagen, was geliefert wurde');

  // ── Und die SET-Liste bleibt unbegrenzt ──────────────────────────────────
  //
  // Die App blättert die Galerie nicht (BrickApiService.getSets kennt keinen
  // page-Parameter). Eine Grenze dort unterschlüge ihr stillschweigend Sets.
  const getSets = src.slice(src.indexOf('async function getSets'), src.indexOf('async function getSetConditionAggregate'));
  assert.match(getSets, /if \(page_size\) \{/,
    'Die Set-Liste darf ohne page_size NICHT gedeckelt werden — die App blättert dort nicht');
});
