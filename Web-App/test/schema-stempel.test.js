/**
 * Ein halb gelaufenes Schema wird NICHT als erledigt vermerkt.
 *
 * ── Marcos Befund vom 25.09. ────────────────────────────────────────────────
 *
 * Der Teile-Reiter antwortete mit „column storage does not exist" — obwohl
 * initSchema() nachweislich gelaufen war. Marco hat das ausdrücklich
 * richtiggestellt: „Das initschema wurde vorher aufgerufen."
 *
 * Damit fiel meine erste Erklärung (die Migration sei übersprungen worden)
 * weg, und die eigentliche Stelle kam zum Vorschein. Die Spalte entsteht in
 * initPartsSummary(), und dessen Fehlschlag wurde geschluckt:
 *
 *     .catch(e => console.error('[db] parts_summary:', e.message))
 *
 * Das allein wäre erträglich — ein fehlender Index soll den Server nicht am
 * Starten hindern. Der eigentliche Fehler steht eine Ebene darüber:
 * initSchemaOnce() vermerkte die Fassung danach in schema_meta, und zwar
 * BEDINGUNGSLOS. Ein einmaliger Fehlschlag wurde als Erfolg gebucht, und weil
 * initSchema() nur bei einer Versionsänderung erneut läuft, war die Spalte
 * damit für immer weg.
 *
 * Aus einem vorübergehenden Problem wurde ein dauerhafter Zustand. Genau das
 * ist der Fehler, den diese Prüfung festhält.
 *
 * ── Was sie prüft, und was sie NICHT kann ───────────────────────────────────
 *
 * Sie liest den Quelltext, nicht das Verhalten. Den Fehlschlag eines
 * Schema-Schritts liesse sich nur herbeiführen, indem man die Datenbank
 * währenddessen sperrt — das ist ein Aufbau, der mehr Fehlerquellen schafft
 * als er absichert.
 *
 * Geprüft wird deshalb die Form: KEINE Schluckstelle darf am Zähler
 * vorbeigehen, und der Vermerk muss von ihm abhängen. Beides ist genau das,
 * was hier gefehlt hat.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) Eine Schluckstelle wieder auf console.error umgestellt → Schritt 1 rot.
 *   b) Den Vermerk aus dem else-Zweig herausgezogen            → Schritt 2 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./helpers/sources');

const QUELLE = fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8');
// Ohne Kommentare: Der Erklärtext oben in database.ts ZITIERT die alte
// Schreibweise, und ohne diesen Schnitt meldete die Regel ihren eigenen
// Begründungstext. Die bekannte Falle dieses Baums.
const CODE = QUELLE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

test('1. jede Schluckstelle geht über den Zähler', () => {
  // Die alte Form: .catch(e => console.error('[db] xyz:', e.message))
  const roh = [...CODE.matchAll(/\.catch\((?:\(e: any\)|e) => console\.error\('\[db\] ([^']+):'/g)]
    .map(m => m[1]);
  assert.deepEqual(roh, [],
    'Diese Schema-Schritte schlucken ihren Fehlschlag, ohne ihn zu melden:\n  ' +
    roh.join('\n  ') +
    '\nDamit wird die Fassung vermerkt, obwohl etwas fehlt — und initSchema() ' +
    'läuft erst bei der nächsten Versionsänderung wieder.');

  // Selbstbeweis: Findet die Suche überhaupt Schluckstellen? Ohne ihn wäre die
  // Regel grün, sobald jemand den Helfer umbenennt. GEMESSEN: 12.
  const gezaehlt = (CODE.match(/\.catch\(schlucke\('/g) || []).length;
  assert.ok(gezaehlt >= 10,
    `Nur ${gezaehlt} gezählte Schluckstellen gefunden (gemessen waren es 12) — Helfer umbenannt?`);
});

test('2. der Vermerk hängt am Zähler', () => {
  const i = CODE.indexOf('INSERT INTO schema_meta (id, applied_version');
  assert.ok(i > 0, 'Der Vermerk in schema_meta ist verschwunden — dann läuft initSchema() bei JEDEM Start.');

  // Zwischen der Prüfung des Zählers und dem Vermerk darf nichts anderes
  // stehen als der else-Zweig. Gesucht wird rückwärts ab dem INSERT.
  const davor = CODE.slice(Math.max(0, i - 600), i);
  assert.match(davor, /if \(_geschluckt\.length\)/,
    'Der Vermerk steht nicht hinter der Prüfung auf geschluckte Fehlschläge. ' +
    'Genau so wurde am 25.09. ein Fehlschlag als Erfolg gebucht.');
  assert.match(davor, /\}\s*else\s*\{/,
    'Der Vermerk liegt nicht im else-Zweig — dann läuft er auch bei einem Fehlschlag.');

  // Und der Zähler wird vor dem Lauf geleert, sonst zählt er den vorigen mit.
  assert.match(CODE, /_geschluckt = \[\];\s*\n\s*await initSchema\(\);/,
    'Der Zähler wird vor initSchema() nicht geleert.');
});
