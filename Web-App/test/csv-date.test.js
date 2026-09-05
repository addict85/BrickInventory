/**
 * Datumsangaben aus CSV-Dateien.
 *
 * `new Date('05.03.2026')` liefert den **3. Mai**, nicht den 5. März —
 * JavaScript liest punktgetrennte Daten amerikanisch als MM.DD.YYYY. Dasselbe
 * gilt für Postgres bei DateStyle MDY. Eine Datei mit Schweizer Datumsangaben
 * landete dadurch mit vertauschten Tagen und Monaten in der Datenbank, und bei
 * Tagen über 12 scheiterte der Import ganz.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// utils/csvExport ist TypeScript; das ladbare .js liegt seit der Umstellung
// in dist/ und nicht mehr neben der Quelle. buildAndRequire() baut bei Bedarf
// und löst dorthin auf.
const { parseCsvDate } = require('./helpers/sources').buildAndRequire()('utils/csvExport.js');

test('Tag zuerst, nicht Monat', () => {
  assert.equal(parseCsvDate('05.03.2026'), '2026-03-05', '5. März, nicht 3. Mai');
  assert.equal(parseCsvDate('25.12.2025'), '2025-12-25');
  assert.equal(parseCsvDate('05/03/2026'), '2026-03-05', 'auch mit Schrägstrich');
  // Genau der Fall, der vorher zu einem Fehler führte: Tag > 12
  assert.equal(parseCsvDate('31.12.2025'), '2025-12-31');
});

test('ISO bleibt ISO', () => {
  // Das eigene Exportformat — es darf nicht als Tag-zuerst umgedeutet werden.
  assert.equal(parseCsvDate('2026-03-05'), '2026-03-05');
});

test('zweistellige Jahre', () => {
  assert.equal(parseCsvDate('05.03.26'), '2026-03-05');
  assert.equal(parseCsvDate('05.03.99'), '1999-03-05');
});

test('unmögliche Daten werden abgelehnt', () => {
  // Eine Prüfung auf 1–31 allein liesse den 31. Februar durch; Date rollt ihn
  // still in den März.
  assert.equal(parseCsvDate('31.02.2026'), null);
  assert.equal(parseCsvDate('29.02.2025'), null, '2025 ist kein Schaltjahr');
  assert.equal(parseCsvDate('29.02.2024'), '2024-02-29', '2024 schon');
  assert.equal(parseCsvDate('00.03.2026'), null);
  assert.equal(parseCsvDate('05.13.2026'), null);
});

test('leere und unbrauchbare Eingaben ergeben null', () => {
  for (const v of ['', '   ', 'abc', null, undefined]) {
    assert.equal(parseCsvDate(v), null, `${JSON.stringify(v)} muss null ergeben`);
  }
});

// Hier stand `beide Importe benutzen den Parser` — eine Prüfung über die
// AUFGEZÄHLTE Liste ['sets.ts', 'parts.ts']. Sie war grün, während
// routes/minifigs.ts das Datum roh weiterreichte: Der dritte Import stand
// nicht in der Liste, also hat ihn niemand geprüft.
//
// Das ist die Lehre und nicht die Ausnahme. Eine aufgezählte Liste prüft, woran
// jemand beim Schreiben gedacht hat; genau das ist bei der nächsten neuen
// Stelle nicht mehr gegeben. Der Test darunter sucht die Aufrufer stattdessen.

/**
 * Jeder CSV-Import läuft durch parseCsvDate — nicht nur die, an die jemand dachte.
 *
 * ── Warum diese Prüfung dazukam ─────────────────────────────────────────────
 * Die Funktion oben ist vollständig geprüft, und trotzdem stand der Fehler noch
 * in der Anwendung: `routes/minifigs.ts` las `erfassungsdatum` roh aus der Zeile
 * und reichte es als Datum weiter. Sets und Teile benutzten parseCsvDate, die
 * Minifiguren nicht — der dritte Aufrufer hat die Behebung nie bekommen.
 *
 * Nachgemessen an der Datenbank, nicht angenommen:
 *
 *     SHOW DateStyle          -> ISO, MDY
 *     SELECT '01.02.2026'::date -> 2026-01-02      (2. Januar!)
 *     SELECT '31.02.2026'::date -> ERROR
 *
 * Unter Tag 13 also stille Verfälschung, darüber ein abgebrochener Eintrag. Die
 * Erfassung landete auf dem falschen Tag oder gar nicht — beides ohne Meldung
 * an den Nutzer.
 *
 * Ein Test der Funktion beweist eben nicht, dass sie auch gerufen wird. Deshalb
 * hier die andere Frage: WER liest ein Datum aus einer CSV-Zeile, und läuft es
 * dort durch parseCsvDate? Die Liste wird gefunden, nicht aufgezählt.
 */
test('jeder CSV-Import normalisiert das Datum', () => {
  // ── Auch utils/, seit die Zeile dort steht (Nachtrag 144) ────────────────
  //
  // Teile- und Minifiguren-Import lasen das Datum bis dahin JE SELBST — und
  // genau daran hing der Fehler, den dieser Test festhält: Die Behebung war
  // für Sets und Teile gemacht und beim dritten Aufrufer liegen geblieben.
  // Jetzt liest csvGemeinsameFelder() in utils/csvExport.ts für beide, und wer
  // nur `routes/` durchsucht, findet die Stelle nicht mehr.
  const ROOT = path.join(__dirname, '..');
  const dateien = [];
  for (const ordner of ['routes', 'utils']) {
    for (const f of fs.readdirSync(path.join(ROOT, ordner)))
      if (f.endsWith('.ts')) dateien.push(path.join(ordner, f));
  }
  assert.ok(dateien.length >= 3,
    `nur ${dateien.length} Quelldateien gefunden — der Pfad stimmt nicht, und ` +
    'ein leeres Ergebnis würde diesen Test stillschweigend bestehen lassen');

  const ohneKommentar = (src) => src.split('\n')
    .map(z => { const t = z.trim(); return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) ? '' : z; })
    .join('\n');

  const verstoesse = [];
  let gefunden = 0;
  for (const datei of dateien) {
    const src = ohneKommentar(fs.readFileSync(path.join(ROOT, datei), 'utf8'));
    // Jede Zeile, die ein Erfassungsdatum aus einer CSV-ZEILE liest.
    const re = /^.*\brow\b[^\n]*(acquired_at|erfassungsdatum)[^\n]*$/gm;
    for (const treffer of src.match(re) || []) {
      gefunden++;
      if (!treffer.includes('parseCsvDate')) verstoesse.push(`${datei}: ${treffer.trim()}`);
    }
  }

  // Selbstbeweis: Findet das Muster gar keine Lesestelle, sagt ein leeres
  // Ergebnis nichts.
  //
  // Die Schranke war 3 („drei Importe gibt es") und ist jetzt 2: Es gibt
  // weiterhin drei Importe, aber nur noch ZWEI Stellen, die das Datum lesen —
  // routes/sets.ts und die gemeinsame Fassung für Teile und Minifiguren.
  // Weniger Lesestellen sind hier der Fortschritt, nicht der Verlust.
  assert.ok(gefunden >= 2,
    `nur ${gefunden} Stelle(n) gefunden, die ein Datum aus einer CSV-Zeile lesen — ` +
    'das Muster ist veraltet');

  // Und: Beide Importe, die nicht mehr selbst lesen, gehen wirklich über die
  // gemeinsame Fassung. Ohne das könnte einer wieder eine eigene Lesezeile
  // bekommen, und der Test bliebe still — er fände ja die andere.
  for (const rel of ['routes/parts.ts', 'routes/minifigs.ts']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /csvGemeinsameFelder\(/,
      `${rel}: liest die Zeilenfelder wieder selbst statt über csvGemeinsameFelder()`);
  }

  assert.deepEqual(verstoesse, [],
    'Diese Stellen lesen ein Datum aus einer CSV-Zeile, ohne es durch ' +
    'parseCsvDate zu schicken:\n  ' + verstoesse.join('\n  ') +
    '\nPostgres liest "01.02.2026" bei DateStyle MDY als 2. Januar — ' +
    'stillschweigend.');
});
