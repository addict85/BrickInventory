/**
 * Eine FlowRow gehört nicht in eine Row.
 * Ausführlich: docs/begruendungen/test/app-flowrow-in-row.test.js.md#kopf
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

const { quellwurzeln } = require('./helpers/android');

/** Alle Kotlin-Dateien der Oberfläche, aus allen Modulen. `theme` ist die Skala, kein Bildschirm. */
function quellen(verzeichnis = null, raus = []) {
  if (verzeichnis === null) {
    for (const w of quellwurzeln()) if (fs.existsSync(path.join(w, 'ui'))) quellen(path.join(w, 'ui'), raus);
    return raus;
  }
  for (const e of fs.readdirSync(verzeichnis, { withFileTypes: true })) {
    const p = path.join(verzeichnis, e.name);
    if (e.isDirectory()) { if (e.name !== 'theme') quellen(p, raus); }
    else if (e.name.endsWith('.kt')) raus.push([p.slice(p.lastIndexOf(path.sep + 'ui' + path.sep) + 4), fs.readFileSync(p, 'utf8')]);
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
