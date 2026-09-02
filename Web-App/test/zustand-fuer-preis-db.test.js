/**
 * Die Zustands-Staffelung Eingabe → Bestand → Standard, ausgeführt.
 *
 * ── Woher die Regel kommt ───────────────────────────────────────────────────
 * Nachträge 146 und 147. Der Kern steht als Kommentar in routes/parts.ts:
 * „Zustand der neuen Erfassung folgt dem Teil selbst (bzw. dem User-Default),
 * nicht hartkodiert 'N' — sonst bekäme ein als \"Gebraucht\" geführtes Teil bei
 * jeder Mengen-Erhöhung eine \"Neu\"-Erfassung."
 *
 * Die Staffelung stand VIERMAL im Baum, in zwei Fassungen: beim Bearbeiten mit
 * Eingabe, beim Erfassen ohne. Das ist nicht zweierlei Regel, sondern derselbe
 * Fall mit und ohne ersten Schritt. Dass es zwei getrennte Wege sind, hat schon
 * einmal Arbeit gekostet: 146 hat das Bearbeiten behoben, 147 musste das
 * Erfassen nachziehen.
 *
 * ── Warum gegen eine echte Datenbank ────────────────────────────────────────
 * Der letzte Schritt liest aus zwei Tabellen (user_settings, global_settings)
 * mit einer eigenen Vorrangregel. Ein Test mit erfundenen Werten prüfte davon
 * nichts. Und der interessanteste Fall ist gerade ein DB-Zustand: Die leere
 * Zeichenkette, die das Formular schreibt, darf den globalen Standard NICHT
 * verdrängen.
 *
 * ── Gegenproben (durchgeführt, siehe Kommentar im Commit) ───────────────────
 *   a) `if (bisher) return bisher;` → `if (bisher != null) return bisher;`
 *      (also ?? statt ||) → „ein leerer Bestandszustand zählt als nicht
 *      gesetzt" wird rot. Genau die Naht, an der in diesem Projekt schon
 *      mehrfach JS-Falsy und Kotlin-Null auseinandergelaufen sind.
 *   b) Die Eingabeprüfung auf `if (eingabe)` gelockert → „eine ungültige
 *      Eingabe zählt nicht" wird rot.
 *   c) Die Reihenfolge gedreht (erst Bestand, dann Eingabe) → „die Eingabe
 *      gewinnt" wird rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { zustandFuerPreis, setGlobalSetting, setUserSetting } = _req('utils/settings.js');

test('Zustand für den Marktpreis: Eingabe → Bestand → Standard', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  // Eigener Nutzer je Prozess — der Test läuft neben anderen auf derselben DB.
  const name = `zfp_${process.pid}`;
  const angelegt = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`, [name]);
  const uid = angelegt.id;

  const vorherGlobal = await db.get(
    `SELECT value FROM global_settings WHERE key='default_price_condition'`).catch(() => null);

  try {
    // ── Der Standard ganz unten ─────────────────────────────────────────────
    await setGlobalSetting('default_price_condition', 'U');
    await db.run(`DELETE FROM user_settings WHERE user_id=$1 AND key='user_default_condition'`, [uid]);

    assert.equal(await zustandFuerPreis(undefined, null, uid), 'U',
      'ohne Eingabe und ohne Bestand muss der globale Standard gelten');

    // ── Der Bestand schlägt den Standard ────────────────────────────────────
    assert.equal(await zustandFuerPreis(undefined, 'N', uid), 'N',
      'ein als "Neu" geführter Bestand darf nicht auf den Standard zurückfallen — ' +
      'genau das war der Fehler aus Nachtrag 147, nur andersherum');

    // ── Die Eingabe schlägt beides ──────────────────────────────────────────
    assert.equal(await zustandFuerPreis('N', 'U', uid), 'N', 'die Eingabe gewinnt');
    assert.equal(await zustandFuerPreis('U', 'N', uid), 'U', 'die Eingabe gewinnt');

    // ── Eine ungültige Eingabe zählt nicht ──────────────────────────────────
    // Der Rumpf kommt vom Client; dort kann alles stehen. Ein 'X' darf nicht
    // als Zustand durchgereicht werden, sonst landet es in der Erfassung.
    for (const müll of ['X', '', 'neu', 0, true, null, {}]) {
      assert.equal(await zustandFuerPreis(müll, 'U', uid), 'U',
        `Eingabe ${JSON.stringify(müll)} ist kein Zustand und muss übergangen werden`);
    }

    // ── Ein leerer Bestandszustand zählt als nicht gesetzt ──────────────────
    // So leert das Formular den Wert. Mit `??` statt `||` käme hier '' heraus
    // und würde als Zustand weitergereicht.
    assert.equal(await zustandFuerPreis(undefined, '', uid), 'U',
      'die leere Zeichenkette ist kein Zustand — sie muss auf den Standard durchfallen');

    // ── Der Nutzerwert schlägt den globalen Standard ────────────────────────
    await setUserSetting(uid, 'user_default_condition', 'N');
    assert.equal(await zustandFuerPreis(undefined, null, uid), 'N',
      'der eigene Standard des Nutzers muss den globalen verdrängen');
  } finally {
    await db.run(`DELETE FROM user_settings WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    if (vorherGlobal?.value !== undefined)
      await setGlobalSetting('default_price_condition', vorherGlobal.value).catch(() => {});
    else
      await db.run(`DELETE FROM global_settings WHERE key='default_price_condition'`).catch(() => {});
    // Ohne das endet der Prozess nie: Der Pool hält offene Verbindungen, und
    // node:test wartet darauf. Dieselbe Zeile steht am Ende jedes anderen
    // DB-Tests hier — sie zu vergessen sieht aus wie ein hängender Test.
    await db.pool.end().catch(() => {});
  }
});
