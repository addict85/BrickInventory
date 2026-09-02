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

/** Die aus einer CSV-Zeile gelesenen Schlüssel im Importrumpf. */
function importSchluessel(rel) {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const i = src.indexOf("router.post('/import/csv'");
  assert.ok(i > 0, `${rel}: keine CSV-Importroute gefunden`);
  const j = src.indexOf('\n});', i);
  const blk = src.slice(i, j > i ? j : undefined);
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
