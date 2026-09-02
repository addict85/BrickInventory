const test = require('node:test');
const assert = require('node:assert/strict');

// Voraussetzung: Test-DB via TEST_DATABASE_URL — wie in den uebrigen
// *-db.test.js. Ohne diese Zeile griffe der Start auf DATABASE_URL zu und
// damit auf die echte Datenbank.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

/**
 * Der Schemastart darf keinen Fehler verschlucken.
 *
 * ── Wie das aufgefallen ist ─────────────────────────────────────────────────
 * Beim Umstellen der stillen catch-Bloecke auf `logAndContinue` protokollierte
 * der Start plötzlich zwei Zeilen, die vorher niemand sah:
 *
 *   [weiter-trotz-fehler] start:erfassungen fuer Teile nachtragen:
 *       syntax error at or near "das"
 *   [weiter-trotz-fehler] start:erfassungen fuer Minifiguren nachtragen:
 *       column m.added_at does not exist
 *
 * Beides waren echte Fehler, und beide liefen seit jeher ins Leere:
 *
 *  - Der Teile-Nachtrag stand VOR den ALTER TABLEs, die parts.added_at und
 *    parts.condition anlegen. Auf jeder Datenbank ohne diese Spalten — also
 *    bei jedem Hochziehen von einem aelteren Stand — scheiterte er und lief
 *    erst beim naechsten Start.
 *  - Der Minifiguren-Nachtrag las m.added_at. Diese Spalte gibt es GAR NICHT:
 *    weder im Schema noch in einer Migration. Manuell erfasste Minifiguren aus
 *    der Zeit vor den Erfassungen haben deshalb bis heute keine
 *    Erst-Erfassung; ihr Kaufpreis fehlt in Historie und Finanzansicht.
 *
 * ── Warum als VERHALTEN und nicht als Quelltextpruefung ─────────────────────
 * Eine Regex haette weder das eine noch das andere gefunden. Der eine Fehler
 * war ein Kommentar INNERHALB der Zeichenkette, der andere eine Spalte, die es
 * anderswo sehr wohl gibt (parts.added_at). Beides sagt einem nur die
 * Datenbank selbst. Deshalb wird hier der Start wirklich ausgefuehrt und
 * mitgehoert, was er meldet.
 *
 * Der Test gilt fuer ALLE Aufrufe von logAndContinue im Schemastart, nicht nur
 * fuer diese zwei — jeder kuenftige verschluckte Fehler faellt hier auf.
 */
test('der Schemastart meldet keinen verschluckten Fehler', async (t) => {
  // Der Pool wird IM NACHLAUF geschlossen, nicht am Ende des Rumpfes: Sonst
  // bleibt er bei einer scheiternden Zusicherung offen, der Prozess endet
  // nicht, und aus einem roten Test wird ein haengender — der schlechteste
  // aller Ausgaenge, weil niemand die Meldung zu sehen bekommt.
  t.after(async () => { await db.pool.end().catch(() => {}); });

  const gemeldet = [];
  const echtesWarn = console.warn;
  console.warn = (...args) => {
    const text = args.map((a) => (typeof a === 'string' ? a : String(a?.message ?? a))).join(' ');
    if (text.includes('[weiter-trotz-fehler]')) gemeldet.push(text);
    echtesWarn.apply(console, args);
  };

  try {
    try { await db.initSchema(); }
    catch (e) {
      if (process.env.REQUIRE_DB === '1')
        throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
      t.skip('Test-DB nicht erreichbar'); return;
    }
  } finally {
    console.warn = echtesWarn;
  }

  assert.deepEqual(gemeldet, [],
    'Der Schemastart hat Fehler verschluckt und nur protokolliert:\n  ' +
    gemeldet.join('\n  ') +
    '\nJede dieser Zeilen ist ein Schritt, der NICHT gelaufen ist — die ' +
    'Datenbank steht danach anders da, als der Start behauptet.');
});
