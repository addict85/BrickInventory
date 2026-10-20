/**
 * Der BrickLink-Export der Teileliste — was er weglässt und was er sagt.
 *
 * ── Marcos Hinweis vom 20.10. ───────────────────────────────────────────────
 *
 *   „Den Export gibt es ja ebenfalls in der Teileliste"
 *
 * Er hatte recht, und beim Nachsehen standen dort drei Dinge, die erst BEI
 * BRICKLINK auffallen. Das FORMAT prüft test/bricklink-wanted-xml.test.js am
 * ausgelagerten Bauteil; hier steht das, was nur der Aufrufer entscheiden
 * kann: welche Posten überhaupt mitgehen.
 *
 * ── Warum am Quelltext und nicht am Verhalten ───────────────────────────────
 *
 * plExportBricklink lebt in js/08-init.js, und die Datei greift schon beim
 * Laden auf das Dokument zu — einlesen lässt sie sich hier nicht. Geprüft
 * wird deshalb der Quelltext, und zwar OHNE Kommentare: Ein Absatz, der die
 * alte Schreibweise ERKLÄRT, nennt sie zwangsläufig. In diesem Baum hat genau
 * das schon einmal eine Prüfung stillschweigend grün gehalten.
 *
 * ── Gegenproben (am 20.10. GEMESSEN) ────────────────────────────────────────
 *
 * Ausgangslage `# pass 4 / # fail 0`, jede Änderung danach zurückgenommen:
 *
 *   E  die Farbkette wieder auf `?? p.color_id ?? 0` gesetzt
 *      → rot: „keine Rebrickable-Farbnummer wandert als BrickLink-Farbe
 *        hinaus". Das ist der Befund im Wortlaut.
 *   F  statt `exportierbar` wieder `expanded` ins XML gegeben
 *      → rot: „Posten ohne bekannte BrickLink-Farbe gehen nicht mit".
 *   G  die Erfolgsmeldung wieder als deutscher Text eingetippt
 *      → rot: „die Meldungen sind übersetzt, nicht eingetippt".
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const quelle = () => ohneKommentare(
  fs.readFileSync(path.join(ROOT, 'public', 'js', '08-init.js'), 'utf8'));

test('die Teileliste baut das XML nicht mehr selbst', () => {
  const js = quelle();
  // Untergrenze gegen die stille Null: Findet der Leser die Datei nicht mehr,
  // wären alle Prüfungen darunter leer und trotzdem grün.
  assert.ok(js.length > 5000, `Nur ${js.length} Zeichen gelesen — Pfad veraltet?`);

  assert.ok(!/<\?xml/.test(js),
    'In js/08-init.js steht wieder eine XML-Deklaration. BrickLinks Hilfe sagt ' +
    'zum Wanted-List-Format wörtlich „can not have an XML declaration" — die ' +
    'Datei wird beim Upload abgewiesen, und hier sieht man nichts davon.');
  assert.match(js, /baueWantedXmlStuecke\(/,
    'Der Export baut das XML wieder von Hand. Dann gilt für ihn nichts von ' +
    'dem, was test/bricklink-wanted-xml.test.js am Bauteil prüft — weder die ' +
    'fehlende Deklaration noch die Grössengrenze.');
});

test('keine Rebrickable-Farbnummer wandert als BrickLink-Farbe hinaus', () => {
  const js = quelle();
  // Der Befund im Wortlaut, wie er dastand:
  //     p.bl_color_id ?? _rbToBlColor[p.color_id] ?? p.color_id ?? 0
  // Die letzten beiden Stufen sind das Problem: Rebrickable-Nummer, dann 0.
  const rueckfall = /_rbToBlColor\[[^\]]+\]\s*\?\?\s*p\.color_id/;
  assert.ok(!rueckfall.test(js),
    'Die Farbkette fällt wieder auf p.color_id zurück — also auf die ' +
    'REBRICKABLE-Farbnummer. Bei BrickLink bedeutet dieselbe Zahl eine andere ' +
    'Farbe: Das ergibt eine gültige Datei, die das falsche Teil bestellt, und ' +
    'es fällt erst auf, wenn das Paket da ist.');

  // Und die Gegenrichtung: Es muss überhaupt noch eine Kette geben. Ohne das
  // wäre die Prüfung oben auch grün, wenn jemand die Farbe ganz entfernte.
  assert.match(js, /_rbToBlColor\[/,
    'Die Zuordnung Rebrickable→BrickLink wird gar nicht mehr befragt — dann ' +
    'hat kein Posten je eine Farbe.');
});

test('Posten ohne bekannte BrickLink-Farbe gehen nicht mit — und werden genannt', () => {
  const js = quelle();
  // Dieselbe Regel wie beim Import (utils/wantedListe.ts): Was sich nicht
  // abbilden lässt, bleibt draussen und wird GESAGT. Stillschweigend
  // auszulassen wäre fast so schlecht wie zu raten — die Teile fehlen dann in
  // der Bestellung, und es fällt beim Zählen auf.
  assert.match(js, /const ohneFarbe\s*=/,
    'Die Posten ohne BrickLink-Farbe werden nicht mehr getrennt gesammelt.');
  assert.match(js, /baueWantedXmlStuecke\(\s*\n?\s*exportierbar/,
    'Ins XML geht nicht mehr nur das Exportierbare — dann ist entweder eine ' +
    'Farbe geraten oder ein Posten ohne COLOR dabei.');
  assert.match(js, /pl\.bl_no_color/,
    'Es gibt keine Meldung mehr über die ausgelassenen Posten. Eine ' +
    'Bestellung, in der still etwas fehlt, ist schlimmer als eine, die sagt ' +
    'was fehlt.');
});

test('die Meldungen sind übersetzt, nicht eingetippt', () => {
  const js = quelle();
  // Hier stand `toast(\`✅ ${missing.length} fehlende Teiletypen exportiert\`)`
  // — deutscher Text fest im Code, auch bei englischer Oberfläche.
  assert.ok(!/fehlende Teiletypen/.test(js),
    'Die Erfolgsmeldung steht wieder als deutscher Text im Code.');
  for (const schluessel of ['pl.bl_exported', 'pl.bl_split', 'pl.bl_no_color'])
    assert.ok(js.includes(schluessel), `Der Sprachschlüssel ${schluessel} fehlt`);
});
