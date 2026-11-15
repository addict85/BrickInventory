/**
 * Der Dienstsatz (baueDienste) ist die Fläche, über die Bereiche, Routen und Jobs
 * einander rufen. Seine Schlüssel heissen deutsch, und es werden weniger, nie mehr:
 * Was nur ein Bereich selbst braucht, ruft er über seine Funktionen.
 *
 * Gezählt wird am gebauten Satz, nicht im Quelltext: Ein Schlüssel aus einem Spread
 * oder einer Hilfsfunktion (bildDienste im Katalog) zählt so mit. Der Zugang ist
 * ein Stummel; der Bau fragt die Datenbank nicht.
 *
 * Gegenproben (15.11.2026):
 *   A  in src/katalog/bereich.ts `setInfo` wieder `getSetInfo` → rot „englische
 *      Dienstschlüssel“ (katalog.getSetInfo)
 *   B  in src/gutscheine/bereich.ts `stapelAnlegen` wieder in den Satz → rot „Zahl
 *      der Dienstschlüssel“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const _req = require('./helpers/sources').buildAndRequire();
const { englischerName } = require('./helpers/namen');

/** Ein Satz Dienste über einem Zugang, der nichts beantwortet. */
function satz() {
  const stummel = {
    inTransaktion: () => false,
    transaction: async () => {
      throw new Error('Der Bau fragt nicht');
    },
  };
  return _req('startup/verdrahtung.js').baueDienste(stummel);
}

test('Dienstschlüssel sind deutsch und werden weniger, nie mehr', () => {
  const d = satz();
  const schluessel = Object.entries(d).flatMap(([b, x]) =>
    Object.keys(/** @type {object} */ (x))
      .filter(k => k !== 'ueber')
      .map(k => `${b}.${k}`),
  );
  assert.ok(Object.keys(d).length > 15, `nur ${Object.keys(d).length} Bereiche gebaut`);
  assert.ok(schluessel.length > 300, `nur ${schluessel.length} Dienstschlüssel — greift die Zählung noch?`);

  const SCHRANKE_ENGLISCH = 0;
  const englisch = schluessel.filter(s => englischerName(s.split('.')[1] ?? ''));
  assert.ok(
    englisch.length <= SCHRANKE_ENGLISCH,
    `englische Dienstschlüssel: ${englisch.length}, erlaubt ${SCHRANKE_ENGLISCH}\n${englisch.join('\n')}`,
  );
  if (englisch.length < SCHRANKE_ENGLISCH)
    console.log(`  ℹ englische Dienstschlüssel: ${englisch.length} (Schranke ${SCHRANKE_ENGLISCH}) — nachziehen`);

  const SCHRANKE_ZAHL = 553;
  assert.ok(
    schluessel.length <= SCHRANKE_ZAHL,
    `Zahl der Dienstschlüssel: ${schluessel.length}, erlaubt ${SCHRANKE_ZAHL}`,
  );
  if (schluessel.length < SCHRANKE_ZAHL)
    console.log(`  ℹ Dienstschlüssel: ${schluessel.length} (Schranke ${SCHRANKE_ZAHL}) — nachziehen`);
});
