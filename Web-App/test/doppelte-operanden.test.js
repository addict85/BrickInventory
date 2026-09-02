/**
 * Derselbe Operand zweimal — über Webapp UND Android-App.
 *
 * Die Regel steht in scripts/check-doppelte-operanden.js; dort ist auch
 * begründet, warum es sie gibt. Dieser Test führt sie im normalen Lauf mit aus.
 *
 * Gegenproben (durchgeführt):
 *   a) Den bekannten `avg > 0 || avg > 0` in financeCalc.ts zurückgeholt → rot.
 *   b) `SELECT avg_price, avg_price` zurückgeholt → rot.
 *   c) Denselben Fehler in Kotlin gesetzt (GalleryFeature) → rot. Die Prüfung
 *      deckt beide Sprachen ab, weil der Fehler keine kennt.
 *   d) Den Pfad zur Android-App verbogen → rot mit eigener Meldung, statt still
 *      grün auf der halben Menge.
 *
 * Die Prüfung selbst hat zwei Anläufe gebraucht, und beide Male fiel es nur
 * auf, weil sie zuerst am BEKANNTEN Fehler geprüft wurde: Die erste Fassung
 * trennte nur auf oberster Klammerebene (der Fehler steht in einem `if (…)`),
 * die zweite hielt `/^  \S/` und `/^\S/` für gleich, weil sie Leerraum auch in
 * Regex-Literalen entfernte. Eine Suche, die „nichts gefunden" meldet, ohne
 * sich vorher bewährt zu haben, ist keine Auskunft.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('kein Ausdruck steht zweimal auf beiden Seiten', () => {
  const skript = path.join(__dirname, '..', 'scripts', 'check-doppelte-operanden.js');
  try {
    execFileSync(process.execPath, [skript], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    assert.fail(`${e.stdout || ''}${e.stderr || ''}`.trim() ||
      'check-doppelte-operanden.js ist fehlgeschlagen, ohne etwas zu melden');
  }
});
