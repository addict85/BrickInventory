/**
 * Sicherung und Wiederherstellung — einmal wirklich durchgespielt.
 *
 * ── Warum (Nachtrag 152) ────────────────────────────────────────────────────
 * Es gibt scripts/backup.sh und scripts/restore.sh, beide mit sorgfältig
 * begründeten Vorkehrungen. Und im README steht der Satz „Den Restore-Weg
 * einmal ausprobieren". Genau die Sorte Anweisung, die niemand befolgt — und
 * ein Backup, das nie zurückgespielt wurde, ist eine Vermutung, kein Backup.
 *
 * Dieser Test spielt den Weg gegen eine echte Datenbank durch: Daten anlegen,
 * pg_dump, Datenbank verwüsten, zurückspielen, vergleichen. Er ruft die
 * Skripte nicht auf — die gehen über `docker compose exec` und brauchen den
 * laufenden Stapel. Geprüft wird stattdessen die MECHANIK, auf der beide
 * beruhen, plus (am Quelltext) dass die Skripte diese Mechanik auch benutzen.
 *
 * Die zwei Vorkehrungen sind der eigentliche Gegenstand:
 *
 *   • Die Endmarke. In POSIX-sh gibt es kein pipefail: Scheitert pg_dump am
 *     ANFANG der Pipe, läuft gzip trotzdem durch und hinterlässt eine kleine,
 *     formal gültige .gz-Datei. Ohne die Prüfung auf
 *     "PostgreSQL database dump complete" meldet backup.sh Erfolg — per Cron
 *     wochenlang wertlose Sicherungen.
 *
 *   • ON_ERROR_STOP=1. Ohne diese Variable beendet sich psql auch bei einem
 *     halben Dump mit 0. Man glaubt wiederhergestellt zu haben und merkt es
 *     erst beim Benutzen.
 *
 * Beide sind unten nicht nur behauptet, sondern gemessen — inklusive der
 * Gegenprobe, dass ein abgeschnittener Dump ohne sie stillschweigend
 * durchginge.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL UND die PostgreSQL-Klienten
 * (pg_dump/psql). Ohne DB: skip, ausser REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const { ROOT } = require('./helpers/sources');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

/** pg_dump/psql finden — auf dem PATH oder in einer Distributions-Installation. */
function klient(name) {
  const direkt = spawnSync('which', [name], { encoding: 'utf8' });
  if (direkt.status === 0) return direkt.stdout.trim();
  const basis = '/usr/lib/postgresql';
  if (!fs.existsSync(basis)) return null;
  for (const v of fs.readdirSync(basis).sort().reverse()) {
    const p = path.join(basis, v, 'bin', name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function dbReachable() {
  try { await db.get('SELECT 1'); return true; } catch { return false; }
}

test('Sicherung und Wiederherstellung', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }

  const pgDump = klient('pg_dump');
  const psql   = klient('psql');
  if (!pgDump || !psql) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber pg_dump/psql sind nicht installiert. ' +
                      'Ohne sie ist der Sicherungsweg ungeprüft.');
    }
    t.skip('pg_dump/psql nicht gefunden — Suite übersprungen');
    return;
  }

  const url = process.env.DATABASE_URL;
  const arbeit = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-backup-'));
  const dump = path.join(arbeit, 'db.sql');

  /** psql mit einem Dump füttern; gibt den Exit-Code zurück. */
  const einspielen = (datei, mitStopp) => spawnSync(psql, ['-v', 'ON_ERROR_STOP=1', url, '-f', datei],
    { encoding: 'utf8', stdio: 'pipe', env: { ...process.env } }).status;
  const einspielenOhneStopp = (datei) => spawnSync(psql, [url, '-f', datei],
    { encoding: 'utf8', stdio: 'pipe', env: { ...process.env } }).status;

  await t.test('Aufbau: Schema und ein paar Daten', async () => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const client = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(client); }
    finally { client.release(); }

    await db.run(`INSERT INTO users (username, password_hash) VALUES ('sicherung','x')`);
    const uid = (await db.get(`SELECT id FROM users WHERE username='sicherung'`)).id;
    await db.run(
      `INSERT INTO sets (user_id, set_number, name, year, quantity, condition)
       VALUES ($1,'10214-1','Tower Bridge',2010,2,'U')`, [uid]);
    await db.run(
      `INSERT INTO parts (user_id, part_number, color_id, quantity, source)
       VALUES ($1,'3001',4,17,'manual')`, [uid]);
  });

  await t.test('pg_dump erzeugt einen vollständigen Dump', () => {
    execFileSync(pgDump, ['--clean', '--if-exists', '-f', dump, url], { stdio: 'pipe' });
    const inhalt = fs.readFileSync(dump, 'utf8');
    assert.match(inhalt.slice(-500), /PostgreSQL database dump complete/,
      'Die Endmarke fehlt — genau daran erkennen backup.sh und restore.sh einen Torso');
    assert.match(inhalt, /DROP TABLE IF EXISTS public\.sets/,
      '--clean --if-exists fehlt: Der Dump liesse sich nicht in eine bestehende DB einspielen');
  });

  await t.test('nach dem Zurückspielen sind die Daten wieder da', async () => {
    // Verwüsten — und zwar so, wie es im Ernstfall aussähe: alles weg.
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await assert.rejects(() => db.get('SELECT COUNT(*) FROM sets'),
      'Der Aufbau der Gegenprobe stimmt nicht — die Tabellen sind noch da');

    assert.equal(einspielen(dump, true), 0, 'Das Zurückspielen scheiterte');

    const s = await db.get(`SELECT set_number, name, quantity, condition FROM sets`);
    assert.equal(s.set_number, '10214-1');
    assert.equal(s.name, 'Tower Bridge');
    assert.equal(Number(s.quantity), 2);
    assert.equal(s.condition, 'U', 'Der Zustand ging beim Wiederherstellen verloren');
    const p = await db.get(`SELECT part_number, quantity FROM parts`);
    assert.equal(p.part_number, '3001');
    assert.equal(Number(p.quantity), 17);
  });

  await t.test('ein abgeschnittener Dump wird an der Endmarke erkannt', () => {
    // Der Fall, gegen den die Prüfung in backup.sh steht: pg_dump scheitert am
    // Anfang der Pipe, gzip läuft durch, die Datei ist formal gültig.
    const torso = path.join(arbeit, 'torso.sql');
    const inhalt = fs.readFileSync(dump, 'utf8');
    fs.writeFileSync(torso, inhalt.slice(0, Math.floor(inhalt.length * 0.6)));

    assert.doesNotMatch(fs.readFileSync(torso, 'utf8').slice(-500),
      /PostgreSQL database dump complete/,
      'Ein halber Dump darf die Endmarke nicht tragen');
  });

  await t.test('ON_ERROR_STOP ist der Unterschied zwischen Erfolg und Schein-Erfolg', () => {
    // Ein Dump, der mitten in einem Befehl abbricht. OHNE ON_ERROR_STOP meldet
    // psql dafür Exit 0 — das ist die ganze Begründung für die Variable in
    // restore.sh, und hier steht sie als Messung statt als Behauptung.
    const kaputt = path.join(arbeit, 'kaputt.sql');
    fs.writeFileSync(kaputt,
      'CREATE TABLE sicherungsprobe (id int);\n' +
      'INSERT INTO gibtesnicht VALUES (1);\n' +          // schlägt fehl
      'INSERT INTO sicherungsprobe VALUES (2);\n');

    assert.equal(einspielenOhneStopp(kaputt), 0,
      'Ohne ON_ERROR_STOP müsste psql den Fehler verschlucken — tut es das nicht ' +
      'mehr, ist die Begründung in restore.sh überholt und gehört angepasst');
    assert.notEqual(einspielen(kaputt, true), 0,
      'MIT ON_ERROR_STOP muss psql mit einem Fehler abbrechen — sonst schützt die Variable nichts');
  });

  await t.test('die Skripte benutzen beide Vorkehrungen auch wirklich', () => {
    // Die Skripte selbst laufen über `docker compose exec` und sind hier nicht
    // ausführbar. Geprüft wird deshalb, dass sie die oben GEMESSENE Mechanik
    // einsetzen — die Messung sagt, dass sie wirkt, das hier, dass sie benutzt wird.
    const backup  = fs.readFileSync(path.join(ROOT, 'scripts', 'backup.sh'), 'utf8');
    const restore = fs.readFileSync(path.join(ROOT, 'scripts', 'restore.sh'), 'utf8');

    // Auf die BEFEHLSZEILE festgemacht, nicht auf das Vorkommen im Text: Beide
    // Skripte erklären die Endmarke ausführlich im Kommentar. Ein Muster über
    // die ganze Datei wäre allein durch die Erklärung erfüllt gewesen — beim
    // ersten Versuch war es das auch, und die Gegenprobe blieb grün, obwohl
    // die Prüfung entfernt war.
    const ohneKommentar = t => t.split('\n').filter(z => !/^\s*#/.test(z)).join('\n');
    const bCode = ohneKommentar(backup);
    const rCode = ohneKommentar(restore);

    assert.match(bCode, /grep -q 'PostgreSQL database dump complete'/,
      'backup.sh prüft die Endmarke nicht mehr — ein Torso ginge als Sicherung durch');
    assert.match(bCode, /rm -f .*\$TARGET/,
      'Ein unvollständiger Dump muss gelöscht werden, nicht bloss gemeldet');
    assert.match(rCode, /grep -q 'PostgreSQL database dump complete'/,
      'restore.sh prüft die Endmarke nicht, BEVOR es etwas überschreibt');
    assert.match(rCode, /ON_ERROR_STOP=1/,
      'Ohne ON_ERROR_STOP meldet ein halber Restore Erfolg');
  });

  await t.test('aufräumen', async () => {
    await db.run('DROP TABLE IF EXISTS sicherungsprobe').catch(() => {});
    fs.rmSync(arbeit, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });
});
