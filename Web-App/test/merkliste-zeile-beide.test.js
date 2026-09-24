/**
 * Die Merklisten-Zeile: kein Übernahme-Knopf, dafür der Marktpreis — in BEIDEN
 * Oberflächen. Und der Lagerort steht im Detail der manuellen Einträge.
 *
 * ── Marcos Vorgaben vom 24.09. ──────────────────────────────────────────────
 *
 *   „Auf dem Detail Dialog der manuell erfassten Teile ist der Lagerort nicht
 *    ersichtlich. Auf dem Detaildialog der manuell erfassten Minifiguren ist
 *    das Lagerort nicht ersichtlich. Zumindest in der Android App, evtl auch
 *    in der Webapp."
 *
 *   „Bitte in der Tabelle der Merkliste der Button In die Galerie aufnehme
 *    entfernen und dafuer den Marktpreis anzeigen. Dies ebenfalls in der
 *    Android und Webapp Umsetzen."
 *
 * ── Warum eine Regel über beide ─────────────────────────────────────────────
 *
 * „Zumindest in der Android App, evtl auch in der Webapp" beschreibt das
 * Muster, das diesen Baum durchzieht: Eine Änderung landet in einer der beiden
 * Oberflächen, die andere bleibt zurück. Diese Prüfung liest beide Quellbäume
 * und verlangt dasselbe von beiden.
 *
 * Gelesen wird OHNE Kommentarzeilen. Sonst genügte ein Absatz, der den
 * entfernten Knopf ERKLÄRT, und die Regel hielte ihn für vorhanden — dieselbe
 * Falle, die in diesem Projekt schon mehrfach zugeschlagen hat.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Den Knopf in der Webapp-Zeile wieder eingesetzt → Schritt 1 rot.
 *   b) Denselben in der App-Zeile                      → Schritt 1 rot.
 *   c) Den Marktpreis in der Webapp entfernt           → Schritt 2 rot.
 *   d) Denselben in der App                            → Schritt 2 rot.
 *   e) Die Lagerortzeile in der Webapp entfernt        → Schritt 3 rot.
 *   f) Dieselbe in der App                             → Schritt 3 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

// Als EIN Pfad und nicht als acht Segmente: test/baumbruecken.test.js zaehlt
// die Bruecken zwischen den beiden Baeumen und will sie lesen koennen — ein
// variables Segment nimmt ihr die Sicht. Sie hat diese Zeile prompt gemeldet.
const APP = path.join(ROOT, '../Android-App/app/src/main/java/ch/brickinventoryapp');

/** Der Rumpf einer Funktion — ab ihrem Namen bis zur nächsten auf Spaltenanfang. */
function rumpf(quelle, kopf, ende = /\n(?:@Composable|(?:private |internal |export )?(?:async )?fun(?:ction)? )/) {
  const i = quelle.indexOf(kopf);
  assert.ok(i >= 0, `${kopf} nicht gefunden — umbenannt?`);
  const rest = quelle.slice(i + kopf.length);
  const m = rest.search(ende);
  return m >= 0 ? rest.slice(0, m) : rest;
}

const web = (rel) => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const app = (rel) => ohneKommentare(fs.readFileSync(path.join(APP, rel), 'utf8'));

test('1. die Merklisten-ZEILE trägt keinen Übernahme-Knopf mehr', () => {
  // Er ist nicht verschwunden, sondern umgezogen: Das Merkposten-Detail hat
  // ihn weiterhin, und dort steht der Dialog mit Anzahl, Kaufpreis und
  // Zustand. In der Liste stand er neben „Löschen" — zwei Knöpfe, von denen
  // der eine ein Formular öffnet und der andere sofort fragt.
  const zeileWeb = rumpf(web('public/js/16-merkliste.js'), 'function zeile(w) {');
  assert.ok(!/merkpostenUebernehmen/.test(zeileWeb),
    'Die Webapp-Zeile ruft weiterhin die Übernahme auf.');

  const zeileApp = rumpf(app('ui/screens/MerklisteScreen.kt'), 'private fun MerkpostenZeile(');
  assert.ok(!/wanted_take/.test(zeileApp),
    'Die App-Zeile trägt weiterhin den Knopf „In die Galerie".');
});

test('2. dafür steht der Marktpreis darin', () => {
  const zeileWeb = rumpf(web('public/js/16-merkliste.js'), 'function zeile(w) {');
  assert.match(zeileWeb, /marktpreis/,
    'Die Webapp-Zeile zeigt den Marktpreis nicht.');

  const zeileApp = rumpf(app('ui/screens/MerklisteScreen.kt'), 'private fun MerkpostenZeile(');
  assert.match(zeileApp, /marktpreis/,
    'Die App-Zeile zeigt den Marktpreis nicht.');
});

test('3. der Lagerort steht im Detail der MANUELLEN Einträge', () => {
  // Bis zum 24.09. gab es die Zeile nur im Set-Detail und im Dialog der Teile
  // AUS SETS. Bei den manuell erfassten fehlte sie in beiden Oberflächen.
  const webDetail = rumpf(web('public/js/13-acquisition-modals.js'),
    'export async function openManDetail(', /\nfunction |\nexport /);
  assert.match(webDetail, /lagerortBlock\('man-storage'/,
    'Der manuelle Detaildialog der Webapp hat keine Lagerortzeile.');

  const appDetail = app('ui/screens/ManualItemDetailScreen.kt');
  assert.match(appDetail, /LagerortFeld\(/,
    'Der manuelle Detaildialog der App hat keine Lagerortzeile.');
  assert.match(appDetail, /setzeManuellenLagerort\(/,
    'Die Lagerortzeile der App speichert nicht.');
});

test('4. die Abfrage der manuellen Teile liefert den Lagerort überhaupt', () => {
  // Die halbe Ursache von Marcos Befund: getManualParts() zählt seine Spalten
  // auf, und storage fehlte in der Liste. Selbst mit einer Zeile in der
  // Oberfläche wäre sie leer geblieben. Die Schwesterfunktion
  // getManualMinifigs() macht SELECT * und hatte den Fehler nie — genau die
  // Doppelung, vor der der Kommentar an derselben Stelle schon wegen der
  // Spalte condition warnt.
  //
  // ── ohneKommentare() reicht hier NICHT ────────────────────────────────────
  //
  // Es entfernt JavaScript-Kommentare (//), nicht die SQL-Kommentare (--)
  // innerhalb des Template-Literals. Die Gegenprobe hat das gezeigt: Spalte
  // entfernt, Regel blieb grün — mein eigener Erklärungstext daneben nennt
  // das Wort. Das ist die bekannte Falle dieses Projekts in neuer Farbe, und
  // sie fällt genau dann auf, wenn man die Gegenprobe wirklich durchführt.
  const ohneSql = (q) => q.split('\n')
    .map(z => z.trim().startsWith('--') ? '' : z).join('\n');
  const quelle = ohneSql(ohneKommentare(
    fs.readFileSync(path.join(ROOT, 'utils/handlers/parts.ts'), 'utf8')));
  const fn = rumpf(quelle, 'function getManualParts(', /\n(?:export )?(?:async )?function /);
  assert.match(fn, /\bstorage\b/,
    'getManualParts() liest die Spalte storage nicht — die Zeile im Dialog bliebe leer.');
});
