/**
 * Compose-Bausteine, die der naheliegende Stern-Import NICHT mitbringt.
 * Ausführlich: docs/begruendungen/test/app-compose-importe.test.js.md#kopf
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { androidDateien } = require('./helpers/android');

/** Name → das Paket, aus dem er kommen MUSS. */
const HERKUNFT = {
  rememberSaveable:             'androidx.compose.runtime.saveable',
  collectAsStateWithLifecycle:  'androidx.lifecycle.compose',
};

/** Kommentare und Zeichenketten raus — ein Name im Fliesstext ist kein Aufruf. */
function ohneBeiwerk(quelle) {
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"([^"\\\n]|\\.)*"/g, '""');
}

test('Compose-Namen aus fremden Paketen haben ihren Import', () => {
  const fehlend = [];
  // Haupt- und Testquellen aller Module.
  for (const datei of [...androidDateien(undefined, 'main'), ...androidDateien(undefined, 'test')]) {
    const roh = fs.readFileSync(datei, 'utf8');
    const code = ohneBeiwerk(roh);
    for (const [name, paket] of Object.entries(HERKUNFT)) {
      // Der Import steht in der ROHEN Quelle — ohneBeiwerk() laesst ihn
      // stehen, aber sicher ist sicher.
      // `[({<]` und nicht nur `[(<]`: Der haeufigste Aufruf ist
      // `rememberSaveable { … }` — mit geschweifter Klammer. Die erste …
      // Ausführlich: docs/begruendungen/test/app-compose-importe.test.js.md#benutzt
      //
      // Gegenproben, alle gruen; erst die vierte Frage „warum eigentlich?"
      // hat es gezeigt.
      const benutzt = new RegExp(`(?<![\\w.])${name}\\s*[({<]`).test(code);
      if (!benutzt) continue;
      const hatImport =
        new RegExp(`^import\\s+${paket.replace(/\./g, '\\.')}\\.(${name}|\\*)\\s*$`, 'm').test(roh);
      if (!hatImport) {
        fehlend.push(`${path.basename(datei)}: ${name} → import ${paket}.${name}`);
      }
    }
  }
  assert.deepEqual(fehlend, [],
    'Diese Dateien benutzen einen Compose-Namen, dessen Paket sie nicht importieren.\n'
    + '`import androidx.compose.runtime.*` deckt ihn NICHT ab — er liegt in einem eigenen '
    + 'Artefakt:\n  ' + fehlend.join('\n  '));
});
