/**
 * Der Import einer Wanted-Liste lässt sich nicht zweimal anstossen.
 *
 * ── Marcos Vorgabe vom 20.10. ───────────────────────────────────────────────
 *
 *   „Wenn der Import der Wanted-Liste läuft, soll der Button nicht nochmals
 *    geklickt werden können."
 *
 * ── Warum das mehr ist als Kosmetik ─────────────────────────────────────────
 *
 * Der zweite Schritt SCHREIBT, und er schreibt über recordAcquisitionForDay().
 * Eine zweite Anfrage mit derselben Datei legt für denselben Tag keine zweite
 * Erfassung an, sondern ADDIERT auf die bestehende (idx_part_acq_tag_zustand). Zwei
 * Klicks ergäben also die doppelte Stückzahl — lautlos, denn beide Antworten
 * melden Erfolg.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 *
 * Der Riegel liegt an zwei Stellen, und beide werden gelesen:
 *   1. `disabled` am Knopf (ein deaktivierter Knopf löst kein click-Ereignis
 *      aus) — gesetzt an GENAU EINER Stelle, knoepfeStand().
 *   2. die Abfrage in lies() selbst — gegen die Eingabetaste, gegen den
 *      Dateiknopf daneben und gegen jeden späteren Aufrufer.
 *
 * Dass der Riegel nach einem Fehler wieder aufgeht, hängt am try/finally; ohne
 * das bliebe der Dialog nach einem Netzfehler tot und sähe aus wie ein
 * hängender Import. Auch das steht als Zusicherung da.
 *
 * Der Fortschrittsbalken gehört in dieselbe Prüfung, weil er dasselbe Fenster
 * betrifft: Was während des Laufs passiert, steht hier.
 *
 * ── Gegenproben (am 20.10. GEMESSEN) ────────────────────────────────────────
 *
 * Ausgangslage `# pass 6 / # fail 0`. Jede Änderung einzeln, danach
 * zurückgenommen:
 *
 *   A  `_laeuft` aus der Bedingung in lies() entfernt
 *      → rot: „lies() beginnt ohne die Abfrage auf _laeuft".
 *   B  das try/finally um den Lauf entfernt (Riegel bleibt nach einem Fehler)
 *      → rot: „ohne finally bleibt _laeuft nach einem Fehler stehen".
 *   C  `_laeuft ||` aus der Zeile für den Schreibknopf gestrichen
 *      → rot: „der Schreibknopf wird während des Laufs nicht gesperrt".
 *   D  die Zeile `if (_laeuft) { … return; }` in wantedXmlGewaehlt entfernt
 *      → rot: „während eines Laufs darf keine neue Datei angenommen werden".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { funktionsRumpf, ohneKommentare } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const SRC = ohneKommentare(
  fs.readFileSync(path.join(ROOT, 'public', 'js', '18-wanted-xml.js'), 'utf8'));
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('lies() lässt keinen zweiten Lauf zu', () => {
  const fn = funktionsRumpf(SRC, 'lies');
  assert.match(fn, /if\s*\(!_datei\s*\|\|\s*_laeuft\)\s*return/,
    'lies() beginnt ohne die Abfrage auf _laeuft — ein zweiter Klick startet ' +
    'einen zweiten Import, und der addiert die Mengen auf');
  assert.match(fn, /_laeuft\s*=\s*true/, 'der Riegel wird nicht gesetzt');
});

test('der Riegel geht auch nach einem Fehler wieder auf', () => {
  const fn = funktionsRumpf(SRC, 'lies');
  assert.match(fn, /finally\s*\{[\s\S]*_laeuft\s*=\s*false/,
    'ohne finally bleibt _laeuft nach einem Fehler stehen — der Dialog wäre ' +
    'tot, bis man ihn schliesst, und das sieht aus wie ein hängender Import');
});

test('die Knopfzustände stehen an genau EINER Stelle', () => {
  const fn = funktionsRumpf(SRC, 'knoepfeStand');
  assert.match(fn, /_laeuft\s*\|\|\s*!_bericht\?\.vorschau/,
    'der Schreibknopf wird während des Laufs nicht gesperrt');
  assert.match(fn, /_laeuft\s*\|\|\s*!_datei/,
    '„Neu einlesen" wird während des Laufs nicht gesperrt');

  // Jede andere Stelle, die diese beiden Knöpfe schaltet, wäre eine zweite
  // Wahrheit — und die eine überschriebe die andere. GEMESSEN war genau das
  // der Zustand davor: zeichneBericht() setzte `disabled` selbst.
  const fremde = SRC.split('\n')
    .filter(z => /\.disabled\s*=/.test(z) && !fn.includes(z.trim()));
  assert.deepEqual(fremde.map(z => z.trim()), [],
    'Diese Zeilen schalten einen Knopf ausserhalb von knoepfeStand():\n  ' +
    fremde.join('\n  '));
});

test('während eines Laufs wird keine neue Datei angenommen', () => {
  const fn = funktionsRumpf(SRC, 'wantedXmlGewaehlt');
  assert.match(fn, /if\s*\(_laeuft\)[\s\S]{0,120}return/,
    'während eines Laufs darf keine neue Datei angenommen werden — sie würde ' +
    '_datei mitten im laufenden Schreiben austauschen');
});

test('der Dialog hat beide Knöpfe als Kennung und einen Balken', () => {
  for (const id of ['wanted-xml-schreiben', 'wanted-xml-neu',
                    'wanted-xml-balken', 'wanted-xml-fortschritt']) {
    assert.equal(HTML.split(`id="${id}"`).length - 1, 1,
      `id="${id}" kommt nicht genau einmal vor — die IDs sind der Vertrag mit dem JS`);
  }
  const wrap = HTML.slice(HTML.indexOf('id="wanted-xml-fortschritt"'),
                          HTML.indexOf('id="wanted-xml-bericht"'));
  assert.match(wrap, /role="progressbar"/,
    'Ohne role="progressbar" ist der Balken für Screenreader nur ein Kasten');
  assert.match(wrap, /aria-valuemin="0"[\s\S]*aria-valuemax="100"/,
    'role="progressbar" braucht seine Grenzen');
  assert.match(wrap, /display:none/,
    'Der Balken muss verborgen starten — sonst steht er leer da, bevor etwas läuft');
});

test('der Fortschritt wird gelesen und angezeigt', () => {
  // Der Server schickt ihn nur auf Verlangen (strom=1); wer ihn nicht anfordert,
  // bekommt auch keinen Balken.
  assert.match(SRC, /p\.set\('strom',\s*'1'\)/,
    'Ohne strom=1 antwortet die Adresse in einem Stück — es gäbe nichts zu zeigen');
  const fn = funktionsRumpf(SRC, 'liesStrom');
  assert.match(fn, /getReader\(\)/, 'die Antwort wird nicht zeilenweise gelesen');
  assert.match(fn, /rest\s*=\s*zeilen\.pop\(\)/,
    'Die angeschnittene letzte Zeile muss liegen bleiben — sonst zerbricht ein ' +
    'Bericht, der über zwei Pakete kommt, mitten im JSON');
  assert.match(fn, /o\.fortschritt/, 'die Fortschrittszeilen werden nicht erkannt');
  assert.match(funktionsRumpf(SRC, 'zeichneFortschritt'), /aria-valuenow/,
    'Der Wert muss auch für Screenreader mitgeführt werden');
});
