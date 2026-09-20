/**
 * Die zwei Kaufadressen am Set-Detail: BrickLink und Preisvergleich.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Bitte auf dem Detail-Dialog sowohl den BrickLink-Link analog dem Katalog
 * als auch die URL des Preisvergleichs als Buttons einbauen."
 *
 * ── Warum der SERVER sie liefert ────────────────────────────────────────────
 *
 * „Analog dem Katalog" ist woertlich: Der Katalog laesst die
 * BrickLink-Adresse seit jeher vom Server aufloesen, weil sie sich NICHT aus
 * der Setnummer herleiten laesst — Gear und Buecher liegen unter einem
 * anderen Parameter, Sammelminifiguren unter einer ganz anderen Nummer.
 *
 * Der Preisvergleich kommt aus demselben Grund von dort: Seine Adresse stand
 * bisher an genau EINER Stelle im Baum (dem Vergleichsbildschirm der App).
 * Ohne utils/preisvergleich.ts waeren daraus vier geworden — Webapp und App,
 * je Set-Detail und Vergleich.
 *
 * Der dritte Test unten ist der Waechter dafuer: Baut irgendwann doch wieder
 * eine Oberflaeche die Adresse selbst, faellt es hier auf und nicht erst,
 * wenn zwei davon auseinanderlaufen.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const P = require('./helpers/sources').buildAndRequire()('utils/preisvergleich.js');

test('die Suchadresse maskiert, was hineingeht', () => {
  const u = P.suchUrl('LEGO 75192 Millennium Falcon');
  assert.match(u, /^https:\/\/www\.toppreise\.ch\/produktsuche\?q=/);
  assert.ok(!u.includes(' '), 'Leerzeichen sind nicht maskiert — die Adresse bricht');
  assert.ok(u.includes('Millennium'), 'Der Suchbegriff ist unterwegs verlorengegangen');
});

test('leer bleibt leer — und ist damit KEIN Knopf', () => {
  // Eine leere Zeichenkette ist die Aussage „dafuer gibt es keine Adresse".
  // Die Oberflaechen blenden den Knopf dann aus, statt auf eine Suche nach
  // nichts zu fuehren.
  for (const roh of ['', '   ', null, undefined]) {
    assert.equal(P.suchUrl(roh), '', `${JSON.stringify(roh)} ergab eine Adresse`);
    assert.equal(P.fuerSet(roh), '', `${JSON.stringify(roh)} ergab eine Set-Adresse`);
  }
});

test('die Variante faellt weg, der Name kommt dazu', () => {
  // „-1" ist eine Rebrickable-Eigenheit und steht auf keiner Verpackung; ein
  // Preisvergleicher findet damit nichts. Der Name dagegen ist genau das,
  // wonach dort gesucht wird.
  const mit  = decodeURIComponent(P.fuerSet('75192-1', 'Millennium Falcon'));
  assert.ok(mit.includes('75192 '), `Die Nummer fehlt oder traegt noch die Variante: ${mit}`);
  assert.ok(!mit.includes('75192-1'), 'Die Variante „-1" steht noch drin');
  assert.ok(mit.includes('Millennium Falcon'), 'Der Name fehlt');
  assert.ok(mit.includes('LEGO'), 'Ohne „LEGO" findet der Vergleicher zu viel Fremdes');

  // Ohne Namen bleibt die Nummer — besser als nichts.
  const ohne = decodeURIComponent(P.fuerSet('10276-1', null));
  assert.ok(ohne.includes('10276'), ohne);
});

test('die Adresse des Preisvergleichs steht genau an EINER Stelle je Seite', () => {
  // Der Waechter. Server: nur utils/preisvergleich.ts. App: nur der
  // Vergleichsbildschirm (der mit freiem Suchtext arbeitet und deshalb keine
  // Set-Adresse vom Server holen kann) — das Set-Detail nimmt die Adresse
  // aus der Antwort.
  const wurzel = path.join(__dirname, '..', '..');
  const treffer = [];
  for (const [basis, filter] of [
    [path.join(wurzel, 'Web-App'), (f) => /\.(ts|js)$/.test(f)],
    [path.join(wurzel, 'Android-App', 'app', 'src', 'main'), (f) => f.endsWith('.kt')],
  ]) {
    const stapel = [basis];
    while (stapel.length) {
      const d = stapel.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (['node_modules', '.git', 'build', 'dist'].includes(e.name)) continue;
          stapel.push(p);
          continue;
        }
        if (!filter(e.name) || e.name === 'app.bundle.js') continue;
        if (fs.readFileSync(p, 'utf8').includes('toppreise.ch')) {
          treffer.push(path.relative(wurzel, p));
        }
      }
    }
  }
  assert.deepEqual(treffer.sort(), [
    path.join('Android-App', 'app', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'ui', 'screens', 'ComparisonScreen.kt'),
    path.join('Web-App', 'test', 'kaufadressen.test.js'),
    path.join('Web-App', 'utils', 'preisvergleich.ts'),
  ].sort(),
    'Die Adresse des Preisvergleichs steht an einer weiteren Stelle. Entweder '
    + 'kommt sie dort vom Server (Set-Detail: preisvergleich_url), oder der '
    + 'neue Ort gehoert hier eingetragen — sonst laufen zwei Fassungen auseinander.');
});
