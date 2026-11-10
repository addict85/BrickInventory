/**
 * Typprüfung der Oberfläche: kein unbekannter Name, keine Meldung.
 *
 * Gegenproben (am 05.11.2026 gemessen; A–C seitdem im CI-Schritt
 * „Typprüfung Oberfläche“, nicht mehr in npm test):
 *   A  an G() in 01-dom.js die Typangabe {Feld} entfernt → rot: Hauptlauf
 *      mit 357 Meldungen
 *   B  in 01-fortschritt.js den Import von apiRoh entfernt → rot, TS2304
 *      „Cannot find name 'apiRoh'“ mit beiden Fundstellen
 *   C  in logviewer.js die Typangabe an getElementById("period") entfernt →
 *      rot im Lauf der klassischen Skripte
 *   E  den Schritt `npm run typecheck:frontend` aus web-ci.yml entfernt → rot
 *   D  "strict": true in tsconfig.frontend.json auf false → rot: „strict ist
 *      eingeschaltet“; "noImplicitThis": false ergänzt → ebenso rot
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const { pruefe, LAEUFE } = require('../scripts/check-frontend-typen');

test('Oberfläche: die CI prüft beide Konfigurationen als eigenen Schritt', () => {
  // Den tsc-Lauf macht die CI (npm run typecheck:frontend, beide LAEUFE); hier
  // doppelt gelaufen kostete er jeden Testlauf rund 19 s (Prüfbericht arch17-web-b, N7).
  const fs = require('node:fs');
  const path = require('node:path');
  const ci = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'web-ci.yml'), 'utf8');
  assert.match(ci, /^\s+run: npm run typecheck:frontend\s*$/m);
  assert.equal(require('../package.json').scripts['typecheck:frontend'], 'node scripts/check-frontend-typen.js');
  assert.deepEqual(LAEUFE, ['tsconfig.frontend.json', 'tsconfig.frontend-skripte.json']);
  assert.equal(typeof pruefe, 'function');
});

test('Oberfläche: strict ist eingeschaltet, kein Teil davon abgeschaltet', () => {
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
    assert.equal(o.strict, true, `${config}: strict`);
    for (const teil of ['strictNullChecks', 'noImplicitAny', 'noImplicitThis', 'strictFunctionTypes',
      'strictBindCallApply', 'strictPropertyInitialization', 'useUnknownInCatchVariables', 'alwaysStrict'])
      assert.notEqual(o[teil], false, `${config}: ${teil} abgeschaltet`);
  }
});
