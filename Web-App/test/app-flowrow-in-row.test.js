/**
 * Eine FlowRow gehört nicht in eine Row.
 *
 * ── Marcos Befund vom 25.09. ────────────────────────────────────────────────
 *
 *   „Der Monitoring Bereich in der Android App hat beim Cache vorher und
 *    nachher einen grossen leeren Abstand."
 *
 * ── Was dort stand ──────────────────────────────────────────────────────────
 *
 * Eine Row um vier Blöcke, die untereinander gehören: Vorschau-Ablage,
 * Vorwärm-Netze, Hinweis und Designwahl. Eine Row legt ihre Kinder
 * NEBENEINANDER — die vier teilten sich die Bildschirmbreite, und für jedes
 * blieben ein paar Punkte.
 *
 * Sichtbar wurde es an den beiden FlowRows darin: Eine FlowRow bricht um,
 * sobald der Platz nicht reicht. Auf ein paar Punkte gedrückt, bricht sie
 * JEDEN Chip auf eine eigene Zeile und wird dadurch sehr hoch. Das
 * `Alignment.CenterVertically` der Row setzte die eine sichtbare Zeile in die
 * Mitte dieser Höhe — genau der leere Abstand davor und danach, den Marco
 * gesehen hat. Die übrigen Blöcke standen zusammengedrückt am rechten Rand.
 *
 * ── Warum eine Regel und kein Bildschirmvergleich ───────────────────────────
 *
 * Der Fehler ist am Bild leicht zu sehen und am Quelltext schwer: Zwischen der
 * öffnenden Row und der FlowRow lagen 50 Zeilen Erklärtext. Ein
 * Schnappschuss-Test würde ihn ebenfalls finden, aber erst nach einem
 * Emulatorlauf — und er sagte „das Bild hat sich geändert", nicht warum.
 *
 * Diese Prüfung sagt es: Eine FlowRow, deren nächster Elternteil waagerecht
 * ordnet, hat keinen Platz zum Umbrechen. Sie gehört in eine Column.
 *
 * ── Ihre Grenze, ausdrücklich ───────────────────────────────────────────────
 *
 * Sie liest die EINRÜCKUNG, nicht den Syntaxbaum. Das genügt für diesen Baum
 * (durchgehend vier Leerzeichen, der Aufruf steht auf der Höhe des Elements),
 * und es ist die einzige Fassung, die ohne Kotlin-Übersetzer auskommt — den
 * gibt es in dieser Umgebung nicht, die Action ist der einzige Compiler.
 * Wer den Baum anders einrückt, macht diese Regel blind, nicht falsch.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Die entfernte Row wieder um den Block gelegt → rot, mit Datei und Zeile.
 *   b) Eine FlowRow in eine bestehende Row gehängt  → rot.
 *   c) Der Selbstbeweis unten: Findet die Suche überhaupt FlowRows?
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

// Als EIN Pfad und nicht als acht Segmente: test/baumbruecken.test.js zählt die
// Brücken zwischen den beiden Bäumen und will sie lesen können.
const APP_UI = path.join(ROOT, '../Android-App/app/src/main/java/ch/brickinventoryapp/ui');

/** Alle Kotlin-Dateien der Oberfläche. `theme` ist die Skala, kein Bildschirm. */
function quellen(verzeichnis = APP_UI, raus = []) {
  for (const e of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    const p = path.join(verzeichnis, e.name);
    if (e.isDirectory()) { if (e.name !== 'theme') quellen(p, raus); }
    else if (e.name.endsWith('.kt')) raus.push([path.relative(APP_UI, p), fs.readFileSync(p, 'utf8')]);
  }
  return raus;
}

const EINRUECKUNG = (z) => z.length - z.trimStart().length;
// Ein Aufruf eines Composables: optionaler Paketpfad, dann ein grossgeschriebener
// Name. `if (…)`, `for (…)` und `items(…)` fallen damit heraus — sie ordnen
// nichts an, und die Suche muss an ihnen vorbei zum echten Elternteil.
const AUFRUF = /^(?:[A-Za-z_][\w.]*\.)?([A-Z]\w*)\s*\(/;
/** Ordnet waagerecht an. Box nicht: Es stapelt, die Breite bleibt die volle. */
const WAAGERECHT = new Set(['Row', 'LazyRow']);

/** Der nächste umschliessende Composable-Aufruf einer Zeile — oder null. */
function elternteil(zeilen, nr) {
  let tiefe = EINRUECKUNG(zeilen[nr]);
  for (let i = nr - 1; i >= 0; i--) {
    const z = zeilen[i];
    if (!z.trim()) continue;
    const e = EINRUECKUNG(z);
    if (e >= tiefe) continue;
    const m = z.trim().match(AUFRUF);
    if (m) return { name: m[1], zeile: i + 1 };
    tiefe = e;                       // etwa `if (…) {` — weiter nach oben
  }
  return null;
}

test('keine FlowRow in einer waagerechten Row', () => {
  const funde = [];
  let flowRows = 0;
  for (const [datei, roh] of quellen()) {
    // Ohne Kommentare: Der Erklärtext ÜBER dieser Regel nennt „FlowRow" und
    // „Row" mehrfach, und in HouseholdComposables.kt steht ein Absatz über die
    // Klammerung von FlowRow. Beides würde die Suche sonst selbst auslösen —
    // die bekannte Falle dieses Baums.
    const zeilen = ohneKommentare(roh).split('\n');
    zeilen.forEach((z, i) => {
      if (!/\bFlowRow\s*\(/.test(z)) return;
      flowRows++;
      const e = elternteil(zeilen, i);
      if (e && WAAGERECHT.has(e.name)) {
        funde.push(`${datei}:${i + 1} — FlowRow in ${e.name} (Zeile ${e.zeile})`);
      }
    });
  }

  // ── Selbstbeweis ─────────────────────────────────────────────────────────
  //
  // Ohne ihn wäre die Regel für immer grün, sobald jemand den Ordner umbenennt
  // oder die Schreibweise sich ändert: null Funde in null Quellen ist kein
  // Nachweis. GEMESSEN beim Anlegen: 5 FlowRows in 4 Dateien.
  assert.ok(flowRows >= 4,
    `Nur ${flowRows} FlowRows gefunden (gemessen waren es 5) — Ordner umbenannt?`);

  assert.deepEqual(funde, [],
    'Eine FlowRow in einer Row hat keinen Platz zum Umbrechen: Sie bricht jeden ' +
    'Chip auf eine eigene Zeile und wird sehr hoch. Sie gehört in eine Column.\n' +
    funde.join('\n'));
});
