/**
 * Typprüfung der Oberfläche: kein unbekannter Name, keine Meldung.
 *
 * Ein Tippfehler in einem Namen oder ein Feld, das ein Element nicht hat,
 * fällt im Browser erst auf, wenn die Zeile läuft. tsc prüft deshalb die
 * ES-Module unter public/js samt i18n.js (tsconfig.frontend.json) und die
 * zwei klassischen Skripte (tsconfig.frontend-skripte.json) — derselbe Lauf
 * wie `npm run typecheck:frontend` und der Schritt in der CI.
 *
 * Gegenproben (am 05.11.2026 gemessen):
 *   A  an G() in 01-core.js die Typangabe {Feld} entfernt → rot: Hauptlauf
 *      mit 357 Meldungen, dazu die strictNullChecks-Ratsche
 *   B  in 01-fortschritt.js den Import von apiRoh entfernt → rot, TS2304
 *      „Cannot find name 'apiRoh'“ mit beiden Fundstellen
 *   C  in logviewer.js die Typangabe an getElementById("period") entfernt →
 *      rot im Lauf der klassischen Skripte
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const { pruefe, LAEUFE } = require('../scripts/check-frontend-typen');

for (const config of LAEUFE) {
  test(`Oberfläche: ${config} meldet 0 Typfehler`, () => {
    const meldungen = pruefe(config);
    assert.deepEqual(meldungen, [], `${meldungen.length} Meldungen:\n${meldungen.slice(0, 20).join('\n')}`);
  });
}

test('Oberfläche: strictNullChecks meldet weniger, nie mehr', () => {
  // Nächste Stufe der Typprüfung, gestaffelt wie beim Server: gemessen am
  // 05.11.2026 mit 140 Meldungen. Erst wenn die Zahl 0 ist, wird der
  // Schalter in tsconfig.frontend.json eingeschaltet und diese Ratsche entfällt.
  const SCHRANKE = 140;
  const meldungen = pruefe('tsconfig.frontend.json', ['--strictNullChecks']);
  assert.ok(meldungen.length > 0 || SCHRANKE === 0, 'keine Meldung — Schalter einschalten und Ratsche streichen');
  assert.ok(meldungen.length <= SCHRANKE,
    `${meldungen.length} Meldungen unter strictNullChecks, erlaubt sind ${SCHRANKE}. Neue zuerst:\n${meldungen.slice(0, 15).join('\n')}`);
  if (meldungen.length < SCHRANKE) console.log(`  ℹ strictNullChecks: ${meldungen.length} (Schranke ${SCHRANKE}) — Schranke nachziehen`);
});
