/**
 * Der Anstoss der Anleitungs-Warteschlange kommt per Zuruf, nicht per Nachfragen.
 *
 * ── Was gemessen wurde ──────────────────────────────────────────────────────
 * Vorher stand in jobs/instructionQueue.ts ein setInterval(…, 3000), das
 * `instr_queue_trigger` abfragte. Im Leerlauf gezählt, 30 Sekunden lang, ohne
 * eine einzige Anfrage von aussen:
 *
 *     9x SELECT value FROM global_settings WHERE key = $1
 *
 * Also rund 28'800 Abfragen pro Tag, die praktisch immer nichts finden.
 *
 * Genau diese Zahl steht im Kopf von utils/pgNotify.ts als Begründung dafür,
 * dass es das Modul überhaupt gibt — es hat zwei solche Schleifen abgelöst
 * (csv_sync_trigger, job_reschedule_trigger). Diese dritte war übrig geblieben.
 *
 * Nebenwirkung, die mehr wiegt als die Abfragen: Der Auslöser wirkte bis zu
 * drei Sekunden später als nötig. Jetzt sofort.
 *
 * ── Was dieser Test prüft, und was nicht ────────────────────────────────────
 * Zwei Hälften, weil eine allein still falsch werden kann:
 *
 *  1. FUNKTIONAL: requestRun() legt den Eintrag an UND schickt das Signal.
 *     Empfangen wird über utils/pgNotify selbst — beide Richtungen laufen
 *     also durch den echten Weg, nicht durch einen Nachbau.
 *  2. AM QUELLTEXT: start() meldet sich auf demselben Kanal an und pollt
 *     nicht mehr. Ein Signal ohne Zuhörer wäre die teuerste Art, nichts zu
 *     tun — und Hälfte 1 bliebe dabei grün.
 *
 * start() wird bewusst NICHT aufgerufen: Liegen Einträge in der Warteschlange,
 * plant es drei Sekunden später einen echten Durchlauf, und der lädt
 * Anleitungen aus dem Netz. Ein Test darf das nicht auslösen.
 *
 * Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
 * Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');
const iq = _req('jobs/instructionQueue.js');
const pgNotify = _req('utils/pgNotify.js');

const KANAL = 'instr_queue_trigger';

test('Anleitungen: Anstoss per NOTIFY statt im Dreisekundentakt', async (t) => {
  try { await db.get('SELECT 1'); }
  catch { return t.skip('keine Test-Datenbank erreichbar'); }

  try {
    await db.run('DELETE FROM global_settings WHERE key = $1', [KANAL]).catch(() => {});

    // ── 1. requestRun() legt den Eintrag an UND weckt ──────────────────────
    const geweckt = new Promise((auf, ab) => {
      const uhr = setTimeout(() => ab(new Error(
        `kein NOTIFY auf Kanal "${KANAL}" innerhalb von 5 s — der Primary erfährt vom Anstoss nichts`)), 5000);
      // Der Handler läuft auch beim VERBINDEN einmal ohne Signal (siehe
      // utils/pgNotify.ts). Dieser erste Aufruf zählt nicht als Weckruf —
      // sonst wäre die Zusicherung schon erfüllt, bevor requestRun() lief.
      let verbunden = false;
      pgNotify.listen(KANAL, () => {
        if (!verbunden) { verbunden = true; return; }
        clearTimeout(uhr); auf(true);
      });
    });
    // Kurz warten, damit die LISTEN-Verbindung wirklich steht: Ein NOTIFY, das
    // vor dem LISTEN abgeht, ist verloren — es wird nicht nachgereicht.
    await new Promise(r => setTimeout(r, 500));

    await iq.requestRun();

    const eintrag = await db.get('SELECT value FROM global_settings WHERE key = $1', [KANAL]);
    assert.ok(eintrag, 'requestRun() muss den Eintrag anlegen — er ist die belastbare Quelle, nicht das Signal');

    assert.equal(await geweckt, true);

    // ── 2. Und der Primary hört auf demselben Kanal zu, statt zu fragen ────
    // OHNE Kommentare gesucht: Der Kommentar an der Fundstelle erklärt, was
    // dort stand — und enthält das Wort. Ohne dieses Abstreifen fände die
    // Prüfung ihre eigene Begründung und meldete rot.
    const quelle = ohneKommentare(fs.readFileSync(path.join(ROOT, 'jobs/instructionQueue.ts'), 'utf8'));
    assert.match(quelle, /require\('\.\.\/utils\/pgNotify'\)\.listen\(AUSLOESER/,
      'start() meldet sich nicht auf dem Kanal an — das NOTIFY liefe ins Leere');
    assert.equal((quelle.match(/setInterval\(/g) || []).length, 0,
      'in jobs/instructionQueue.ts steht wieder ein setInterval — die Schleife ist zurück');

    // GEGENPROBE zur Quelltextprüfung: Sie darf nicht alles durchwinken.
    assert.equal((`${quelle}\nsetInterval(() => {}, 3000);`.match(/setInterval\(/g) || []).length, 1,
      'Gegenprobe: das Suchmuster findet ein setInterval nicht');
  } finally {
    await pgNotify.close().catch(() => {});
    await db.run('DELETE FROM global_settings WHERE key = $1', [KANAL]).catch(() => {});
    await db.pool.end().catch(() => {});
  }
});
