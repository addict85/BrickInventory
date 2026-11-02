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

const { ROOT } = require('./helpers/sources');
const _req = require('./helpers/sources').buildAndRequire();
const { haeltSet, haeltTeil, mengeVon, teilmengeVon } = require('./helpers/bestand');
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
  /**
   * Die Fassung eines Klienten — gehört in die Fehlermeldung.
   *
   * pg_dump und psql verweigern die Arbeit an einem NEUEREN Server, und genau
   * das ist ein Unterschied zwischen hier und dem CI-Lauf: lokal PostgreSQL 16,
   * im Lauf 18 (compose.yaml, geprüft in test/build-tooling.test.js). Steht die
   * Zahl in der Meldung, ist die Frage in einer Zeile beantwortet statt in
   * einer Runde.
   */
  const fassung = (bin) => {
    if (!bin) return '—';
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
    return (r.stdout || r.stderr || '').trim() || '?';
  };
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

  // ── psql mit einem Dump füttern ──────────────────────────────────────────
  //
  // Der Rückgabewert war NUR der Exit-Code, und `stdio: 'pipe'` verschluckt,
  // was psql zu sagen hatte. Ein Fehlschlag las sich dann als „1 !== 0" —
  // ohne einen Hinweis darauf, WELCHE Anweisung gescheitert ist.
  //
  // GEMESSEN: Genau so ist dieser Test im CI-Lauf rot geworden, und weder das
  // Protokoll noch die Meldung sagten, woran. Ein Test, der nur „ging nicht"
  // meldet, kostet eine ganze Runde.
  //
  // Der Parameter `mitStopp` ist dabei mit weggefallen: Er wurde nie
  // ausgewertet — ON_ERROR_STOP stand ohnehin fest drin, und für den anderen
  // Fall gibt es einspielenOhneStopp(). Ein Argument, das nichts tut, behauptet
  // etwas.
  const lauf = (args, datei) => spawnSync(psql, [...args, url, '-f', datei],
    { encoding: 'utf8', stdio: 'pipe', env: { ...process.env } });
  /** Exit-Code; `grund()` liefert danach die Meldung von psql dazu. */
  let letzterLauf = null;
  const einspielen = (datei) => (letzterLauf = lauf(['-v', 'ON_ERROR_STOP=1'], datei)).status;
  const einspielenOhneStopp = (datei) => (letzterLauf = lauf([], datei)).status;
  /** Was psql gesagt hat — die letzten Zeilen, damit die Meldung lesbar bleibt. */
  const grund = () => (letzterLauf?.stderr || '').trim().split('\n').slice(-8).join('\n')
    || '(psql hat nichts nach stderr geschrieben)';

  await t.test('Aufbau: Schema und ein paar Daten', async () => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const client = await db.pool.connect();
    try { await _req('db/migrate.js').runMigrations(client); }
    finally { client.release(); }

    await db.run(`INSERT INTO users (username, password_hash) VALUES ('sicherung','x')`);
    const uid = (await db.get(`SELECT id FROM users WHERE username='sicherung'`)).id;
    await haeltSet(db, uid, '10214-1', 0);  // Menge 0: die Erfassung dahinter traegt sie
    // Der Name steht seit Migration 0033 im Katalog. Auch ihn muss die
    // Sicherung zurueckbringen — und zwar aus einer ANDEREN Tabelle als die
    // Menge. Genau das ist der Fall, an dem eine unvollstaendige Sicherung
    // auffaellt: Ein Dump, der nur den Bestand nimmt, laesst jedes Set
    // namenlos zurueck.
    await db.run(
      `INSERT INTO set_catalog (set_number, name, year) VALUES ('10214-1','Tower Bridge',2010)
       ON CONFLICT (set_number) DO UPDATE SET name = EXCLUDED.name, year = EXCLUDED.year`);
    // Der Zustand steht seit Migration 0032 in der Erfassung. Die Sicherung
    // muss ihn von DORT zurueckbringen — sonst prueft dieser Test nach dem
    // Umbau eine Spalte, die es nicht mehr gibt, und waere stillschweigend
    // schwaecher geworden.
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition)
       VALUES ($1,'10214-1',2,44.50,'U')`, [uid]);
    await haeltTeil(db, uid, '3001', { menge: 17, colorId: 4 });
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

    assert.equal(einspielen(dump), 0,
      `Das Zurückspielen scheiterte. psql sagt:\n${grund()}\n` +
      `pg_dump: ${fassung(pgDump)} · psql: ${fassung(psql)}`);

    const s = await db.get(`SELECT user_id, set_number FROM sets`);
    assert.equal(s.set_number, '10214-1');
    // Die Menge aus den Erfassungen (Migration 0036) — und dadurch ist sie
    // hier eine zweite Aussage ueber eine zweite Tabelle, genau wie Name und
    // Jahr darunter: Ein Dump, der nur `sets` mitnimmt, laesst jedes Set bei
    // null Exemplaren zurueck.
    assert.equal(await mengeVon(db, s.user_id, '10214-1'), 2,
      'Die Stückzahl ist nicht zurückgekommen — set_acquisitions fehlt im Dump');
    // Name und Jahr aus dem Katalog — eine ANDERE Tabelle als die Menge
    // darueber. Genau daran faellt eine unvollstaendige Sicherung auf: Ein
    // Dump, der nur den Bestand nimmt, laesst jedes Set namenlos zurueck.
    const k = await db.get(
      `SELECT c.name, c.year FROM sets s
         JOIN set_catalog c ON c.set_number = s.set_number
        WHERE s.set_number='10214-1'`);
    assert.equal(k?.name, 'Tower Bridge');
    assert.equal(Number(k?.year), 2010);
    const a = await db.get(`SELECT purchase_price, condition FROM set_acquisitions`);
    assert.equal(a?.condition, 'U', 'Der Zustand ging beim Wiederherstellen verloren');
    assert.equal(Number(a?.purchase_price), 44.50,
      'Der Kaufpreis ging beim Wiederherstellen verloren');
    const p2 = await db.get(`SELECT user_id, part_number, color_id FROM parts`);
    assert.equal(p2.part_number, '3001');
    assert.equal(await teilmengeVon(db, p2.user_id, '3001', p2.color_id), 17,
      'Die Stückzahl ist nicht zurückgekommen — part_acquisitions fehlt im Dump');
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
    assert.notEqual(einspielen(kaputt), 0,
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
    assert.match(bCode, /^umask 077$/m,
      'Die Sicherung enthält Klartext-Schlüssel — sie darf nur für den Besitzer lesbar entstehen');
  });

  await t.test('aufräumen', async () => {
    await db.run('DROP TABLE IF EXISTS sicherungsprobe').catch(() => {});
    fs.rmSync(arbeit, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });
});

/**
 * backup.sh selbst, mit einem nachgebauten `docker` auf dem PATH: Der
 * Datenschlüssel neben dem Dump machte dessen Verschlüsselung wertlos.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  --exclude für data/.datenschluessel entfernt → rot: „der Schlüssel
 *      liegt im Archiv"
 *   B  das Kopieren nach BACKUP_SCHLUESSEL_ZIEL entfernt → rot: „… fehlt am
 *      getrennten Ort"
 *   C  (01.11.2026) SCHLUESSEL wieder fest auf data/.datenschluessel → rot:
 *      „schluessel/datenschluessel …" (meldet „keine Schlüsseldatei")
 */
test('backup.sh: der Datenschlüssel kommt nicht ins Archiv', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sicherung-schluessel-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'),
    "#!/bin/sh\nprintf -- '-- Dump\\n-- PostgreSQL database dump complete\\n'\n", { mode: 0o755 });
  const arbeit = path.join(tmp, 'installation');
  fs.mkdirSync(path.join(arbeit, 'data', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(arbeit, 'data', 'uploads', 'anleitung.pdf'), '%PDF-1.4');
  const schluessel = 'k'.repeat(44);
  fs.writeFileSync(path.join(arbeit, 'data', '.datenschluessel'), schluessel, { mode: 0o600 });

  const sichern = (env) => spawnSync('sh', [path.join(ROOT, 'scripts', 'backup.sh'), path.join(tmp, 'ziel')],
    { cwd: arbeit, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env } });

  const ohne = sichern({});
  assert.equal(ohne.status, 0, ohne.stderr);
  const archiv = fs.readdirSync(path.join(tmp, 'ziel')).find(n => n.startsWith('data_'));
  const inhalt = execFileSync('tar', ['tzf', path.join(tmp, 'ziel', archiv)], { encoding: 'utf8' });
  assert.match(inhalt, /data\/uploads\/anleitung\.pdf/, 'Vorbedingung: data/ ist im Archiv');
  assert.doesNotMatch(inhalt, /datenschluessel/, 'der Schlüssel liegt im Archiv');
  assert.match(ohne.stderr, /NICHT in der Sicherung/, 'ohne getrennten Ort muss das Skript es sagen');

  const tresor = path.join(tmp, 'tresor');
  const mit = sichern({ BACKUP_SCHLUESSEL_ZIEL: tresor });
  assert.equal(mit.status, 0, mit.stderr);
  const kopie = path.join(tresor, 'datenschluessel');
  assert.equal(fs.existsSync(kopie) && fs.readFileSync(kopie, 'utf8'), schluessel,
    'der Schlüssel fehlt am getrennten Ort');
  assert.equal(fs.statSync(kopie).mode & 0o077, 0, 'der Schlüssel ist für andere lesbar');
  assert.doesNotMatch(mit.stderr, /NICHT in der Sicherung/);
});

test('backup.sh: schluessel/datenschluessel geht nur an den getrennten Ort', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sicherung-schluessel-neu-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'docker'),
    "#!/bin/sh\nprintf -- '-- Dump\\n-- PostgreSQL database dump complete\\n'\n", { mode: 0o755 });
  const arbeit = path.join(tmp, 'installation');
  fs.mkdirSync(path.join(arbeit, 'data', 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(arbeit, 'schluessel'));
  fs.writeFileSync(path.join(arbeit, 'data', 'uploads', 'rechnung.pdf'), '%PDF-1.4');
  const schluessel = 'n'.repeat(44);
  fs.writeFileSync(path.join(arbeit, 'schluessel', 'datenschluessel'), schluessel, { mode: 0o600 });
  const tresor = path.join(tmp, 'tresor');
  const r = spawnSync('sh', [path.join(ROOT, 'scripts', 'backup.sh'), path.join(tmp, 'ziel')], { cwd: arbeit, encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKUP_SCHLUESSEL_ZIEL: tresor } });
  assert.equal(r.status, 0, r.stderr);
  const archiv = fs.readdirSync(path.join(tmp, 'ziel')).find(n => n.startsWith('data_'));
  const inhalt = execFileSync('tar', ['tzf', path.join(tmp, 'ziel', archiv)], { encoding: 'utf8' });
  assert.match(inhalt, /data\/uploads\/rechnung\.pdf/);
  assert.doesNotMatch(inhalt, /schluessel/);
  assert.equal(fs.readFileSync(path.join(tresor, 'datenschluessel'), 'utf8'), schluessel, 'schluessel/datenschluessel fehlt am getrennten Ort');
  assert.doesNotMatch(r.stderr, /Datenordner|keine Schlüsseldatei/);
});

/**
 * restore.sh mit echter Datenbank: `docker` ist ein Stellvertreter, der psql
 * und postgres/app-rolle.sh gegen die Test-DB aufruft. Der Dump stammt wie bei
 * backup.sh vom Superuser und enthält eine Prüfregel, deren Funktion der
 * App-Rolle gehört; als Superuser eingespielt, legte sie eine Superuser-Rolle an.
 *
 * Gegenproben (02.11.2026 gemessen):
 *   A  restore.sh spielt wieder als Superuser ein (`-U "$DB_APP_USER"` durch
 *      `-U tester` ersetzt) → rot: „Code der App-Rolle lief als Superuser“
 *   B  die Zeile mit `OWNER TO` im awk-Filter entfernt → rot: „ein Dump von
 *      vor der App-Rolle“ (must be able to SET ROLE)
 */
test('restore.sh spielt als App-Rolle ein', { timeout: 240_000 }, async (t) => {
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const basis = new URL(process.env.TEST_DB_BASIS || process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest');
  const admin = new Client({ connectionString: basis.toString() });
  try { await admin.connect(); } catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const su = (await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0]?.rolsuper;
  if (!su || !klient('pg_dump')) {
    await admin.end();
    if (process.env.REQUIRE_DB === '1') throw new Error('REQUIRE_DB=1, aber kein Superuser oder kein pg_dump');
    t.skip('kein Superuser oder pg_dump'); return;
  }
  const name = `${decodeURIComponent(basis.pathname.slice(1))}_rst_${process.pid}`.toLowerCase();
  const [ziel, alt, APP, LESEN, BOESE] = [name, `${name}_alt`, `${name}_app`, `${name}_lesen`, `${name}_boese`];
  const id = (s) => `"${s}"`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-rolle-'));
  t.after(async () => {
    for (const d of [ziel, alt]) await admin.query(`DROP DATABASE IF EXISTS ${id(d)} WITH (FORCE)`).catch(() => {});
    for (const r of [APP, LESEN, BOESE]) await admin.query(`DROP ROLE IF EXISTS ${id(r)}`).catch(() => {});
    await admin.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const suNutzer = decodeURIComponent(basis.username), suPw = decodeURIComponent(basis.password);
  const umgebung = { ...process.env, PGHOST: basis.hostname, PGPORT: basis.port || '5432', PGUSER: suNutzer,
    PGPASSWORD: suPw, PGDATABASE: ziel, DB_APP_USER: APP, DB_APP_PASSWORD: `app-${process.pid}`,
    DB_LESEN_USER: LESEN, PGWEB_DB_PASSWORD: '' };
  const dbUrl = (db, nutzer = suNutzer, pw = suPw) => {
    const u = new URL(basis); u.pathname = '/' + db; u.username = nutzer; u.password = pw; return u.toString();
  };
  const schema = (url) => spawnSync(process.execPath, ['-e',
    "const db = require('./dist/db/database.js'); db.initSchemaOnce().then(() => db.pool.end()).catch(e => { console.error(e.message); process.exit(1); })"],
  { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url } });
  const rolle = () => spawnSync('sh', [path.join(ROOT, 'postgres', 'app-rolle.sh')], { encoding: 'utf8', env: umgebung });

  await admin.query(`CREATE DATABASE ${id(ziel)}`);
  assert.equal(rolle().status, 0);
  const s = schema(dbUrl(ziel, APP, umgebung.DB_APP_PASSWORD));
  assert.equal(s.status, 0, s.stderr);
  const app = new Client({ connectionString: dbUrl(ziel, APP, umgebung.DB_APP_PASSWORD) });
  await app.connect();
  try {
    await app.query(`INSERT INTO users (username, password_hash) VALUES ('rueckspiel', 'x')`);
    await app.query(`CREATE FUNCTION public.falle(int) RETURNS boolean LANGUAGE plpgsql AS $f$
      BEGIN EXECUTE 'CREATE ROLE ${id(BOESE)} SUPERUSER'; RETURN true;
      EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN RETURN true; END $f$`);
    await app.query(`CREATE TABLE public.falle (x int CHECK (public.falle(x)))`);
    await app.query(`INSERT INTO public.falle VALUES (1)`);
  } finally { await app.end(); }
  assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [BOESE])).rowCount, 0, 'Vorbedingung');

  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(tmp, 'pgpass'), `*:*:*:${APP}:${umgebung.DB_APP_PASSWORD}\n*:*:*:${suNutzer}:${suPw}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
case "$2" in
  exec) shift 5; unset PGPASSWORD; PGPASSFILE='${path.join(tmp, 'pgpass')}' exec psql "$@" ;;
  run) exec sh '${path.join(ROOT, 'postgres', 'app-rolle.sh')}' ;;
esac
`, { mode: 0o755 });
  fs.mkdirSync(path.join(tmp, 'schluessel'));
  fs.writeFileSync(path.join(tmp, 'schluessel', 'datenschluessel'), 'k');
  const zurueck = (dump) => spawnSync('sh', [path.join(ROOT, 'scripts', 'restore.sh'), dump], { cwd: tmp, input: 'ja\n',
    encoding: 'utf8', env: { ...umgebung, PATH: `${bin}:${process.env.PATH}` } });
  const sichern = (db, datei) => {
    execFileSync(klient('pg_dump'), ['--clean', '--if-exists', '-f', datei, dbUrl(db)], { stdio: 'pipe' });
    execFileSync('gzip', [datei]);
    return `${datei}.gz`;
  };

  await t.test('Code der App-Rolle läuft beim Einspielen nicht als Superuser', async () => {
    const r = zurueck(sichern(ziel, path.join(tmp, 'db.sql')));
    assert.deepEqual((await admin.query('SELECT rolname FROM pg_roles WHERE rolname = $1', [BOESE])).rows, [],
      'Code der App-Rolle lief als Superuser');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = new Client({ connectionString: dbUrl(ziel) });
    await c.connect();
    try {
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM users WHERE username = 'rueckspiel'`)).rows[0].n, 1);
      assert.equal((await c.query(`SELECT pg_get_userbyid(relowner) AS e FROM pg_class WHERE oid = 'public.falle'::regclass`)).rows[0].e, APP);
    } finally { await c.end(); }
  });

  await t.test('ein Dump von vor der App-Rolle (alles gehört dem Superuser)', async () => {
    await admin.query(`CREATE DATABASE ${id(alt)}`);
    const a = schema(dbUrl(alt));
    assert.equal(a.status, 0, a.stderr);
    const dump = sichern(alt, path.join(tmp, 'alt.sql'));
    assert.match(execFileSync('gunzip', ['-c', dump], { encoding: 'utf8' }), new RegExp(`OWNER TO ${suNutzer};`), 'Vorbedingung');
    const r = zurueck(dump);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = new Client({ connectionString: dbUrl(ziel) });
    await c.connect();
    try {
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM users WHERE username = 'admin'`)).rows[0].n, 1);
      assert.deepEqual((await c.query(`SELECT DISTINCT pg_get_userbyid(relowner) AS e FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'S', 'v')
          AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = pg_class.oid AND d.deptype = 'e')`)).rows, [{ e: APP }]);
    } finally { await c.end(); }
  });
});
