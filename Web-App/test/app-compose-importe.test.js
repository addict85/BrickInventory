/**
 * Compose-Bausteine, die der naheliegende Stern-Import NICHT mitbringt.
 *
 * ── Woher diese Datei kommt ─────────────────────────────────────────────────
 *
 * Android-CI Lauf 203, nach anderthalb Minuten und einem roten Lauf:
 *
 *     MerklisteScreen.kt:120:20 Unresolved reference 'rememberSaveable'.
 *
 * Die Datei hatte `import androidx.compose.runtime.*`. Das sieht aus, als
 * decke es die Compose-Laufzeit ab — `rememberSaveable` liegt aber in einem
 * eigenen Artefakt und damit in einem eigenen Paket
 * (androidx.compose.runtime.saveable). Der Stern-Import eine Zeile darueber
 * hilft nicht, und der Fehler sieht danach aus wie ein Tippfehler.
 *
 * Es ist dieselbe Falle wie bei app-vm-importe.test.js, nur mit einem
 * FREMDEN Paket statt einem eigenen: Ein Aufruf steht da, sein Import fehlt,
 * und in diesem Baum ist die GitHub-Action der einzige Kotlin-Compiler. Ein
 * solcher Fehler kostet dort neun Minuten — hier eine Sekunde.
 *
 * ── Warum nur diese beiden Namen ────────────────────────────────────────────
 *
 * Weil die Regel BEWEISBAR sein muss. Für beide gilt: Der Name lebt in genau
 * einem Paket, und dieses Paket ist NICHT `androidx.compose.runtime`. Wer
 * eine dritte Falle findet, traegt sie hier ein — eine Liste, die raet, waere
 * schlimmer als keine (siehe die 117 Fehlmeldungen, die der erste Entwurf von
 * app-vm-importe.test.js produziert hat).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const WURZEL = path.join(__dirname, '..', '..', 'Android-App', 'app', 'src');

/** Name → das Paket, aus dem er kommen MUSS. */
const HERKUNFT = {
  rememberSaveable:             'androidx.compose.runtime.saveable',
  collectAsStateWithLifecycle:  'androidx.lifecycle.compose',
};

function kotlinDateien(wurzel) {
  const raus = [];
  const stapel = [wurzel];
  while (stapel.length) {
    const d = stapel.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stapel.push(p);
      else if (e.name.endsWith('.kt')) raus.push(p);
    }
  }
  return raus;
}

/** Kommentare und Zeichenketten raus — ein Name im Fliesstext ist kein Aufruf. */
function ohneBeiwerk(quelle) {
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"([^"\\\n]|\\.)*"/g, '""');
}

test('Compose-Namen aus fremden Paketen haben ihren Import', () => {
  const fehlend = [];
  for (const datei of kotlinDateien(WURZEL)) {
    const roh = fs.readFileSync(datei, 'utf8');
    const code = ohneBeiwerk(roh);
    for (const [name, paket] of Object.entries(HERKUNFT)) {
      // Der Import steht in der ROHEN Quelle — ohneBeiwerk() laesst ihn
      // stehen, aber sicher ist sicher.
      // `[({<]` und nicht nur `[(<]`: Der haeufigste Aufruf ist
      // `rememberSaveable { … }` — mit geschweifter Klammer. Die erste
      // Fassung dieser Zeile verlangte `(` oder `<` und war damit auf JEDER
      // Datei gruen, auch auf der, fuer die ich sie geschrieben habe. Drei
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
