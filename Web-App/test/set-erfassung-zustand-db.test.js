/**
 * Beim Aufstocken eines Sets müssen Preis und vermerkter Zustand ZUSAMMEN passen.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * `addSet()` hat zwei Wege, und sie behandelten den fehlenden Zustand
 * verschieden:
 *
 *   NEU angelegt (setService.ts:347/367)
 *     const effectiveCondition = condition || await userDefaultCondition(...)
 *     → Preis UND Erfassung bekommen denselben Zustand.
 *
 *   AUFGESTOCKT (setService.ts:269/283)
 *     reAddPrice = getCurrentMarketPrice(..., condition || null)
 *         → dort drinnen: effectiveCond = condition || userDefault
 *     recordAcquisition(..., reAddPrice, condition || 'N')
 *         → hier hart 'N'
 *
 * Steht der Standard des Nutzers auf „Gebraucht", bekommt die Erfassung also
 * den GEBRAUCHT-Preis, wird aber als NEU verbucht. In der Finanzansicht steht
 * danach ein Neu-Eintrag mit einem Gebraucht-Preis — und die Erfassung zählt in
 * der falschen Gruppe.
 *
 * Es ist dieselbe Verwechslung wie in Nachtrag 68, nur andersherum. Der
 * Kommentar dort sagt: „Ein als gebraucht erfasstes Set bekam dadurch den
 * Neupreis als Kaufpreis eingetragen — im gemeldeten Fall 55 statt 33 CHF."
 * Damals war der Preis falsch, jetzt der Vermerk.
 *
 * ── Warum gegen eine echte Datenbank ────────────────────────────────────────
 * Die Regel liest aus zwei Einstellungstabellen und schreibt in eine dritte.
 * Der interessante Fall ist ein Datenbankzustand: „Standard steht auf U".
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

// Der Nachzug nach dem Erfassen (jobs/nachErfassung.ts) wird abgefangen.
//
// Er haengt an einem setTimeout von zwei bis fuenf Sekunden und laeuft damit
// NACH diesem Test — gegen einen dann geschlossenen Verbindungspool:
//   [weiter-trotz-fehler] instr-queue:trigger: Cannot use a pool after ...
// Sichtbar war nur dieser eine Schritt, weil nur er protokolliert; die
// uebrigen sechs schluckten ihren Fehler und liefen genauso ins Leere.
const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = _echtesRequire.apply(this, arguments);
  if (typeof name === 'string' && /jobs[/\\]nachErfassung(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) =>
      (k === 'zieheNach' || k === 'zieheNachNeuanlage') ? () => {} : t[k] });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { haeltSet } = require('./helpers/bestand');
const db = _req('db/database.js');
const { setUserSetting } = _req('utils/settings.js');
const { addSet } = _req('utils/setService.js');

test('aufstocken ohne Zustandsangabe folgt dem Standard des Nutzers', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const name = `zst_${process.pid}`;
  const SET = `90${String(process.pid).slice(-4)}-1`;
  const u = await db.get(
    `INSERT INTO users (username, password_hash) VALUES ($1,'x')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [name]);
  const uid = u.id;

  try {
    // Der Nutzer sammelt gebraucht.
    await setUserSetting(uid, 'user_default_condition', 'U');

    // ── Den Aufstock-Weg ISOLIEREN ──────────────────────────────────────
    //
    // Zwei addSet()-Aufrufe hintereinander messen ihn NICHT: Beide fallen auf
    // denselben Tag und denselben Zustand, die Tageszeile wird also
    // zusammengefasst. Die erste, korrekt geschriebene Zeile überdeckt dann
    // die zweite, und der Test ist grün, ohne den Pfad berührt zu haben.
    // (Genau das ist mir beim ersten Entwurf passiert.)
    //
    // Deshalb eine Vorbedingung mit AUSDRÜCKLICH anderem Zustand: Der
    // nächste Aufruf nimmt damit den „existing"-Zweig von addSetIntern (die
    // sets-Zeile ist da) und schreibt seine eigene Tageszeile.
    //
    // ── Was sich am 21.10. geändert hat ─────────────────────────────────
    //
    // Hier stand `haeltSet(db, uid, SET, 1)` ohne Zustand — der Helfer legt
    // dann eine Erfassung mit 'N' an, anders als der Kommentar daneben
    // behauptete („ohne Erfassung"). Der Test war trotzdem grün, aber aus
    // dem falschen Grund: recordAcquisitionForDay() fasste beide Zeilen zu
    // EINER zusammen, und „gebraucht gewinnt" machte daraus 'U'. Geprüft
    // war damit die Verschmelzung, nicht der Aufstock-Weg.
    //
    // Seit Migration 0040 ist der Zustand Teil des Schlüssels: Zwei
    // Zustände sind zwei Zeilen (Marcos Befund, siehe
    // test/erfassung-je-zustand-db.test.js). Die Prüfung gilt deshalb jetzt
    // der Zeile, die der GEPRÜFTE Pfad geschrieben hat — nicht allen.
    await haeltSet(db, uid, SET, 1, { zustand: 'N' });

    // Erfassung OHNE Zustandsangabe. Preis mitgeben, damit kein Netzaufruf
    // nötig ist; um den Preis geht es hier nicht.
    await addSet(SET, 1, uid, null, 20, null);

    const zeilen = await db.all(
      `SELECT id, quantity, condition FROM set_acquisitions
        WHERE user_id=$1 AND set_number=$2 ORDER BY id`, [uid, SET]);
    assert.equal(zeilen.length, 2,
      `${zeilen.length} Erfassung(en): ${JSON.stringify(zeilen)}. Erwartet sind ` +
      'ZWEI — die Vorbedingung mit "N" und die des Aufstock-Wegs mit dem ' +
      'Standard "U". Eine einzige hiesse, dass die beiden Zustände wieder ' +
      'verschmolzen werden.');
    assert.equal(zeilen[0].condition, 'N', 'Vorbedingung: die Zeile des Helfers');

    const neue = zeilen[1];
    assert.equal(neue.condition, 'U',
      `Die Erfassung des Aufstock-Wegs steht als "${neue.condition}" in der ` +
      'Datenbank, obwohl der Standard des Nutzers "U" ist und der Preis genau ' +
      'dafür geholt wurde. Preis und Vermerk müssen denselben Zustand meinen — ' +
      'sonst zählt der Eintrag in der Finanzansicht in der falschen Gruppe.');
  } finally {
    await db.run(`DELETE FROM set_acquisitions WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM sets WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM user_settings WHERE user_id=$1`, [uid]).catch(() => {});
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
