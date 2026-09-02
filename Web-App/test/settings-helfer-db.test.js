/**
 * Die drei Schreib-/Löschwege in utils/settings.ts gegen eine echte Datenbank.
 *
 * ── Warum dieser Test sein muss ─────────────────────────────────────────────
 * setGlobalTrigger() und deleteGlobalSetting() sind beim Zentralisieren neu
 * entstanden und tragen SQL, das es vorher nirgends gab:
 *   • `WHERE key = ANY($1)` mit einem Array als Parameter,
 *   • `VALUES ($1, NOW()::TEXT)`.
 * Beides übersetzt der pg-Treiber selbst. Ob er ein JS-Array als Postgres-Array
 * abliefert, sagt kein Typprüfer — das sagt nur ein Aufruf.
 *
 * Der eigentliche Grund für den Test ist aber der Löschweg: Wer `key = ANY($1)`
 * mit einem falschen Parameter aufruft, bekommt keine Fehlermeldung, sondern
 * im schlimmsten Fall eine leere Tabelle — und damit ein Konto ohne
 * Registrierungssperre, ohne API-Grenzen und ohne BrickLink-Zugang. Deshalb
 * prüft Teilschritt 4 ausdrücklich, dass ein Aufruf OHNE Schlüssel nichts
 * anfasst.
 *
 * Gegenproben (durchgeführt):
 *   a) `if (keys.length === 0) return;` in deleteGlobalSetting entfernt und den
 *      Parameter auf `[keys]` gelassen → Teilschritt 4 blieb grün (ANY('{}')
 *      trifft nichts). Erst mit `WHERE key = ANY($1) OR $1 IS NULL` wurde er
 *      rot — die Probe misst also wirklich den Tabelleninhalt.
 *   b) In setGlobalTrigger `NOW()::TEXT` durch `''` ersetzt → Teilschritt 2 rot.
 *   c) In deleteGlobalSetting nur den ERSTEN Schlüssel gelöscht
 *      (`WHERE key = $1`, `[keys[0]]`) → Teilschritt 3 rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const {
  getGlobalSetting, setGlobalSetting, setGlobalTrigger, deleteGlobalSetting,
} = _req('utils/settings.js');

test('globale Einstellungen: schreiben, auslösen, löschen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

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

    // 2. Auslöser: Der Wert muss nicht leer sein — die Leser prüfen genau
    //    darauf ("if (!ausloeser) return"). Und er muss beim zweiten Aufruf
    //    einen NEUEN Zeitpunkt tragen, sonst bliebe ein zweiter Anstoss ohne
    //    Wirkung, wenn der erste noch nicht abgeräumt war.
    await setGlobalTrigger(T);
    const erst = await getGlobalSetting(T);
    assert.ok(erst && erst.length > 0, 'Auslöser darf nicht leer sein');
    await new Promise(r => setTimeout(r, 5));
    await setGlobalTrigger(T);
    const zweit = await getGlobalSetting(T);
    assert.notEqual(zweit, erst, 'der zweite Anstoss muss einen neuen Zeitpunkt schreiben');
    // updated_at wird mitgeführt — daran hängt die Anzeige „zuletzt geändert".
    const zeile = await db.get(`SELECT updated_at FROM global_settings WHERE key=$1`, [T]);
    assert.ok(zeile.updated_at, 'updated_at muss gesetzt sein');

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
    await db.pool.end().catch(() => {});
  }
});
