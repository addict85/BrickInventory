/**
 * Was der CSV-Export schreibt, muss der Import auch lesen.
 *
 * ── Warum diese Prüfung ─────────────────────────────────────────────────────
 * Export und Import stehen an verschiedenen Stellen und werden von
 * verschiedenen Anlässen geändert. Wer dem Export eine Spalte hinzufügt, merkt
 * nicht, dass der Import sie ignoriert — die Datei sieht richtig aus, und beim
 * Zurücklesen fehlt der Wert einfach. Kein Fehler, keine Meldung.
 *
 * Nachgemessen zum Zeitpunkt, als diese Prüfung entstand: Alle drei Rundläufe
 * waren vollständig. Das ist ein Ergebnis und kein Anlass, die Prüfung
 * wegzulassen — sie hält den Zustand, statt ihn zu behaupten.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────
 * Für jede der drei Elementarten: Jede Spalte, die `toCsv([...])` schreibt,
 * muss im zugehörigen Importrumpf als `row.spalte` oder `row['spalte']`
 * vorkommen. Beide Seiten werden aus dem Quelltext abgeleitet, keine Liste hier.
 *
 * Deutsche Zweitnamen (`Anzahl`, `Farb-ID`, `zustand`, …) sind Zugaben für
 * fremde Dateien und deshalb nicht Gegenstand dieser Prüfung — hier geht es um
 * den eigenen Export.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const ohneKommentare = (src) => src.split('\n')
  .map(z => { const t = z.trim(); return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) ? '' : z; })
  .join('\n');

/** Die Spalten des ersten toCsv([...]) in einer Datei. */
function exportSpalten(rel) {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const m = /toCsv\(\s*\n?\s*\[([^\]]+)\]/.exec(src);
  assert.ok(m, `${rel}: kein toCsv([...]) gefunden — Export umgebaut?`);
  return m[1].split(",").map(s => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
}

/**
 * Die aus einer CSV-Zeile gelesenen Schlüssel im Importrumpf.
 *
 * ── Seit Nachtrag 144 auch die gemeinsame Fassung ───────────────────────────
 *
 * Menge, Preis, Notiz, Erfassungsdatum und Zustand liest für Teile und
 * Minifiguren jetzt `csvGemeinsameFelder()` in utils/csvExport.ts. Wer nur den
 * Routenrumpf ansieht, findet diese fünf Spalten nicht mehr und hielte den
 * Export für unvollständig gelesen — obwohl das Gegenteil der Fall ist: Sie
 * werden für BEIDE Importe an einer Stelle gelesen.
 *
 * Deshalb wird der Rumpf der gemeinsamen Funktion mitgelesen, wenn die Route
 * sie ruft. Nicht pauschal: Ruft eine Route sie nicht, zählt auch nichts aus
 * ihr — sonst deckte die gemeinsame Fassung einen Import mit ab, der sie gar
 * nicht benutzt.
 */
function importSchluessel(rel) {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const i = src.indexOf("router.post('/import/csv'");
  assert.ok(i > 0, `${rel}: keine CSV-Importroute gefunden`);
  const j = src.indexOf('\n});', i);
  let blk = src.slice(i, j > i ? j : undefined);
  if (blk.includes('csvGemeinsameFelder(')) {
    const geteilt = ohneKommentare(fs.readFileSync(path.join(ROOT, 'utils/csvExport.ts'), 'utf8'));
    const k = geteilt.indexOf('function csvGemeinsameFelder(');
    assert.ok(k > 0, 'csvGemeinsameFelder() gibt es nicht mehr — utils/csvExport.ts umgebaut?');
    // Bis zur NAECHSTEN Deklaration, nicht bis zum ersten `\n}`: Die Funktion
    // traegt ihren Rueckgabetyp als `{ … }` in der Signatur, und das erste
    // `\n}` schliesst deshalb den TYP, nicht den Rumpf. Der erste Entwurf las
    // dadurch 153 Zeichen Typdeklaration statt der Zeilen darunter — und
    // meldete vier Spalten als ungelesen, die sehr wohl gelesen werden.
    const naechste = geteilt.slice(k + 1).search(/\n(?:\/\*\*|function |export )/);
    blk += geteilt.slice(k, naechste < 0 ? undefined : k + 1 + naechste);
  }
  const keys = new Set();
  for (const m of blk.matchAll(/row\.(\w+)/g)) keys.add(m[1]);
  for (const m of blk.matchAll(/row\[['"]([^'"]+)['"]\]/g)) keys.add(m[1]);
  return keys;
}

test('jede exportierte Spalte wird beim Import auch gelesen', () => {
  const paare = [
    ['Sets',        'utils/setService.ts', 'routes/sets.ts'],
    ['Teile',       'routes/parts.ts',     'routes/parts.ts'],
    ['Minifiguren', 'routes/minifigs.ts',  'routes/minifigs.ts'],
  ];

  const fehlend = [];
  let geprueft = 0;
  for (const [name, expDatei, impDatei] of paare) {
    const spalten = exportSpalten(expDatei);
    // Selbstbeweis je Paar: Ein Export mit einer Spalte waere ein kaputtes
    // Muster, kein sparsamer Export.
    assert.ok(spalten.length >= 4,
      `${name}: nur ${spalten.length} Exportspalte(n) erkannt (${spalten.join(", ")}) — Muster veraltet?`);
    const gelesen = importSchluessel(impDatei);
    assert.ok(gelesen.size >= 4,
      `${name}: nur ${gelesen.size} gelesene Schluessel erkannt — Muster veraltet?`);
    geprueft += spalten.length;
    for (const s of spalten) {
      if (!gelesen.has(s)) fehlend.push(`${name}: "${s}" wird exportiert, aber beim Import nicht gelesen`);
    }
  }
  assert.ok(geprueft >= 15, `nur ${geprueft} Spalten insgesamt geprueft — das kann nicht stimmen`);

  assert.deepEqual(fehlend, [],
    "Der eigene Export erzeugt Spalten, die der eigene Import ignoriert:\n  " +
    fehlend.join("\n  ") +
    "\nBeim Zurueckspielen der Datei geht der Wert stillschweigend verloren.");
});
