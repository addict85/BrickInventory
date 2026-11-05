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
 *      mit 357 Meldungen
 *   B  in 01-fortschritt.js den Import von apiRoh entfernt → rot, TS2304
 *      „Cannot find name 'apiRoh'“ mit beiden Fundstellen
 *   C  in logviewer.js die Typangabe an getElementById("period") entfernt →
 *      rot im Lauf der klassischen Skripte
 *   D  (05.11.) "strictNullChecks": true aus tsconfig.frontend.json entfernt →
 *      rot: „strictNullChecks und noImplicitAny sind eingeschaltet“, dazu der
 *      Hauptlauf (ohne den Schalter verengt tsc einige Vereinigungen nicht)
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

test('Oberfläche: strictNullChecks und noImplicitAny sind eingeschaltet', () => {
  // Ohne die Schalter bliebe der Lauf oben grün, prüfte aber weniger. Gefragt
  // wird tsc selbst (--showConfig), damit auch geerbte Einstellungen zählen.
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const ROOT = path.join(__dirname, '..');
  // Das Werkzeug liegt im Projekt; -p nimmt den Konfigurationsnamen relativ zu cwd.
  for (const config of LAEUFE) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', config, '--showConfig'],
      { cwd: ROOT, encoding: 'utf8' });
    const o = JSON.parse(r.stdout).compilerOptions;
    assert.equal(o.strictNullChecks, true, `${config}: strictNullChecks`);
    assert.equal(o.noImplicitAny, true, `${config}: noImplicitAny`);
  }
});
