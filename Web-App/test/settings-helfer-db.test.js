/**
 * Die Schreib-/Löschwege in src/einstellungen/settings.ts und der Auslöser in
 * src/auftraege/repository/laufzustand.ts (seit Migration 0063 dort) gegen eine echte Datenbank.
 * Ausführlich: docs/begruendungen/test/settings-helfer-db.test.js.md#kopf
 *
 * Gegenproben (durchgeführt):
 *   a) `if (keys.length === 0) return;` in deleteGlobalSetting entfernt und den
 *      Parameter auf `[keys]` gelassen → Teilschritt 4 blieb grün (ANY('{}')
 *      trifft nichts). Erst mit `WHERE key = ANY($1) OR $1 IS NULL` wurde er
 *      rot — die Probe misst also wirklich den Tabelleninhalt.
 *   b) entfällt mit setzeAusloeser (30.10.2026): Anstösse sind Aufträge.
 *   c) In deleteGlobalSetting nur den ERSTEN Schlüssel gelöscht
 *      (`WHERE key = $1`, `[keys[0]]`) → Teilschritt 3 rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const { getGlobalSetting, setGlobalSetting, deleteGlobalSetting } = _req('src/einstellungen/settings.js');
const { setzeZustand, liesZustand, loescheZustand } = _req('src/auftraege/repository/laufzustand.js');

test('globale Einstellungen: schreiben, auslösen, löschen', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req, { migrieren: false })) return;
  { const c = await db.pool.connect(); try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); } }

  // Eigene Schlüssel je Prozess: Der Test läuft neben anderen auf derselben DB.
  const A = `probe_a_${process.pid}`, B = `probe_b_${process.pid}`, T = `probe_t_${process.pid}`;
  const alle = [A, B, T];
  const bestand = async () =>
    (await db.get(`SELECT COUNT(*)::int AS c FROM global_settings`)).c;

  try {
    // 1. Hin und zurück — inklusive der Umwandlung in eine Zeichenkette.
    await setGlobalSetting(A, 42);
    assert.equal(await getGlobalSetting(A), '42',
      'die Spalte ist TEXT; eine Zahl muss als Zeichenkette zurückkommen');
    await setGlobalSetting(A, 'zwei');
    assert.equal(await getGlobalSetting(A), 'zwei', 'der zweite Aufruf muss überschreiben');
    assert.equal(await getGlobalSetting(`gibt_es_nicht_${process.pid}`, 'ersatz'), 'ersatz');

    // 2. Laufzustand: gelöscht heisst, die Zeile ist weg.
    await setzeZustand(T, 'x');
    assert.equal(await liesZustand(T), 'x');
    await loescheZustand(T);
    assert.equal(await liesZustand(T), null, 'abgearbeitet heisst: die Zeile ist weg');
    await setGlobalSetting(T, 'bleibt');

    // 3. Mehrere Schlüssel in EINEM Aufruf — der Grund für `key = ANY($1)`.
    await setGlobalSetting(B, 'x');
    await deleteGlobalSetting(A, B);
    assert.equal(await getGlobalSetting(A), null, 'A muss weg sein');
    assert.equal(await getGlobalSetting(B), null, 'B muss weg sein');
    assert.ok(await getGlobalSetting(T), 'T war nicht genannt und muss stehen bleiben');

    // 4. Der gefährliche Fall: kein Schlüssel genannt. Die Tabelle trägt die
    //    Registrierungssperre, die API-Grenzen und die BrickLink-Zugangsdaten —
    //    ein versehentliches Leeren wäre nicht rückholbar.
    const vorher = await bestand();
    assert.ok(vorher > 0, 'für diese Probe muss die Tabelle etwas enthalten');
    await deleteGlobalSetting();
    assert.equal(await bestand(), vorher,
      'ein Aufruf ohne Schlüssel darf NICHTS löschen');
    await deleteGlobalSetting(...[]);
    assert.equal(await bestand(), vorher,
      'auch ein leeres Array darf NICHTS löschen');
  } finally {
    await db.run(`DELETE FROM global_settings WHERE key = ANY($1)`, [alle]).catch(() => {});
    await loescheZustand(T).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
