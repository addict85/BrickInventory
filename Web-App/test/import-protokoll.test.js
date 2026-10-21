/**
 * Das Protokoll des Import-Balkens: EINE Fassung, und keine Zeile ohne Namen.
 *
 * ── Marcos zwei Befunde vom 21.10. ──────────────────────────────────────────
 *
 *   „Wenn ich in einem anderen Browsersession oben rechts auf den Fortschritt
 *    klicke wenn ein XML-Wanted-Listen Import läuft, steht unten x/y Sets
 *    anstelle 'Elementen'"
 *
 *   „Nach dem Import erscheint dann ganz viele Zeilen mit
 *    Undefined - aktualisiert"
 *
 * Beide haben dieselbe Wurzel: Der Balken war für den CSV-Import von SETS
 * gebaut, und seit dem 20.10. läuft der Wanted-Listen-Import darüber mit — der
 * legt Teile und Minifiguren an. Was für Sets stimmte, stimmte danach nicht
 * mehr.
 *
 *   Der TEXT sagte „Sets". Jetzt „Elemente" / „items", und der Schlüssel
 *   heisst `csv.items_progress` statt `csv.sets_progress`: Ein Name, der
 *   weiter „sets" sagt, ist die nächste falsche Fährte.
 *
 *   Die ZEILEN kamen aus `results`, und dort standen beim Wanted-Import nur
 *   Zähl-Platzhalter (`{ success: true }`), aus denen buildJobStatus
 *   ok/warn/err rechnet. Ich hatte sie dafür gebaut und übersehen, dass
 *   dieselbe Liste auch das Protokoll füllt. Daraus wurden bei Marco 322
 *   Zeilen „undefined – aktualisiert".
 *
 * ── Was hier geprüft wird, und was woanders ─────────────────────────────────
 *
 * Hier: der QUELLTEXT der beiden Oberflächen-Dateien — dass es den gemeinsamen
 * Zeilenbauer gibt, dass er auf einen Namen prüft, und dass niemand daneben
 * eine zweite Fassung aufmacht. Die Prüfung am Quelltext ist in diesem Baum
 * das übliche Mittel für public/js (siehe test/preisalarm-beide.test.js).
 *
 * Dass der SERVER echte Zeilen liefert, prüft Fall 9 in
 * test/wanted-liste-route-db.test.js — am laufenden Server, nicht am Text.
 * Beides zusammen deckt den Weg ab; jede Hälfte allein war schon einmal grün,
 * während die Anzeige unbrauchbar war.
 *
 * ── Gegenproben (am 21.10. GEMESSEN, Zahlen abgeschrieben) ──────────────────
 *
 * Ausgangslage `# pass 4 / # fail 0`.
 *
 *   A  `if (!r?.set_number) return null;` aus protokollZeile entfernt
 *      → `pass 3 / fail 1`. Rot: „keine Zeile ohne Namen".
 *   B  in 02-gallery.js die drei alten Zeilen wieder eingesetzt
 *      → `pass 3 / fail 1`. Rot: „keine Protokollzeile wird an
 *        protokollZeile vorbei geschrieben".
 *   C  'csv.items_progress' im Deutschen auf „{done} / {total} Sets" gesetzt
 *      → `pass 3 / fail 1`. Rot: „der Fortschrittstext spricht nicht von Sets".
 *
 * Die erste Fassung dieser Datei hat beim ersten Lauf eine DRITTE Stelle
 * gemeldet, die ich beim Zusammenlegen uebersehen hatte: den Abschlusspfad in
 * 02-gallery.js — und das ist genau der Dialog, den Marco fotografiert hat
 * („CSV Import / Fertig: 322 ok"). Der Wächter hat also zuerst mich erwischt.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT = path.join(__dirname, '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { ohneKommentare } = require('./helpers/sources');

const FORTSCHRITT = 'public/js/01-fortschritt.js';
const GALERIE     = 'public/js/02-gallery.js';

test('nur EINE Fassung baut die Zeile fürs Import-Protokoll', () => {
  const quellen = fs.readdirSync(path.join(ROOT, 'public', 'js'))
    .filter(n => n.endsWith('.js') && n !== 'app.bundle.js')
    .map(n => ['public/js/' + n, ohneKommentare(lies('public/js/' + n))]);
  // Selbstnachweis: Fände die Suche kaum Dateien, wäre die Regel leer wahr.
  assert.ok(quellen.length >= 20,
    `Nur ${quellen.length} Oberflächen-Dateien gefunden — die Suche greift nicht mehr`);

  const definiert = quellen.filter(([, js]) => /function protokollZeile\s*\(/.test(js));
  assert.deepEqual(definiert.map(([n]) => n), [FORTSCHRITT],
    'protokollZeile() gehört genau einmal in den Baum. Zwei Fassungen heissen ' +
    'zwei Stellen, an denen die nächste Schranke fehlt — und genau das war ' +
    'der Fall, als dieselben drei Zeilen hier und in 02-gallery.js standen.');
});

test('keine Zeile ohne Namen', () => {
  const js = ohneKommentare(lies(FORTSCHRITT));
  const rumpf = js.slice(js.indexOf('function protokollZeile'));
  assert.match(rumpf.slice(0, 400), /if\s*\(!r\?\.set_number\)\s*return null;/,
    'protokollZeile() muss einen Eintrag ohne set_number verwerfen. Ohne das ' +
    'schreibt das Protokoll „undefined – aktualisiert" — Marcos Befund vom ' +
    '21.10., 322-mal. Die ZÄHLUNG darüber kommt aus s.ok/s.warn/s.err und ' +
    'bleibt davon unberührt.');
});

test('keine Protokollzeile wird an protokollZeile vorbei geschrieben', () => {
  // Geprüft wird der SCHREIBWEG, nicht jedes Vorkommen von set_number: Die
  // Konsolenmeldung in 02-gallery.js („[CSV Import] Fehler: …") liest es
  // ebenfalls und darf das — sie landet nicht im Protokoll, das Marco liest.
  // Eine Regel, die auch sie verbietet, wäre eine Schranke ohne Grund, und
  // der nächste streicht sie als lästig.
  for (const datei of [FORTSCHRITT, GALERIE]) {
    const js = ohneKommentare(lies(datei));
    const schreiber = [...js.matchAll(/\b(addCsvLog|gibAddLog)\s*\(([^\n]*)/g)];
    assert.ok(schreiber.length >= 2,
      `${datei}: nur ${schreiber.length} Aufrufe gefunden — die Suche greift nicht mehr`);
    const eigenbau = schreiber.filter(m => /set_number/.test(m[2]));
    assert.deepEqual(eigenbau.map(m => m[0].slice(0, 90)), [],
      `${datei} baut eine Protokollzeile selbst aus set_number. Die Zeile ` +
      'baut protokollZeile(); wer sie daneben nochmal baut, hat die Schranke ' +
      'nicht — genau so entstanden Marcos „undefined – aktualisiert".');
  }
});

test('der Fortschrittstext spricht nicht von Sets', () => {
  const de = lies('public/locales/de.js');
  const en = lies('public/locales/en.js');
  assert.ok(!/'csv\.sets_progress'/.test(de + en),
    'Der Schlüssel heisst jetzt csv.items_progress. Ein Name, der weiter ' +
    '„sets" sagt, ist die nächste falsche Fährte — derselbe Balken trägt ' +
    'auch Teile und Minifiguren.');
  const deText = de.match(/'csv\.items_progress':\s*'([^']*)'/);
  const enText = en.match(/'csv\.items_progress':\s*'([^']*)'/);
  assert.ok(deText && enText, 'csv.items_progress fehlt in einer der Sprachen');
  assert.ok(!/sets?/i.test(deText[1]),
    `Der deutsche Text lautet „${deText[1]}" und nennt Sets. Marcos Befund: ` +
    '„steht unten x/y Sets anstelle \'Elementen\'"');
  assert.ok(!/sets?/i.test(enText[1]),
    `Der englische Text lautet „${enText[1]}" und nennt sets`);
});
