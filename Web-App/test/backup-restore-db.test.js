/**
 * Backup and restore — played through for real once.
 *
 * Counter-check that a truncated dump would silently get through without
 * them.
 *
 * Counter-check (measured 05.11.2026): in DUMP_OPTIONEN of backup.sh
 * `--exclude-table-data=user_sessions` deleted → red: “sessions, counters
 * and log come back empty …”.
 *
 * Counter-check (measured 13.11.2026): CALL_DEADLINE at 1 ms → 9 cases red instead of a
 * hang (backup, backup.sh, restore.sh).
 *
 * Prerequisite: test DB via TEST_DATABASE_URL AND the PostgreSQL clients
 * (pg_dump/psql). Without DB: skip, unless REQUIRE_DB=1.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { testName, cleanRemainder } = require('./helpers/test-names');
const { execFileSync, spawnSync } = require('node:child_process');

/** A synchronous call blocks the whole file: if psql or restore.sh waits for
 * a lock, the file deadline from test/helpers/expiry.js never gets its turn either,
 * and the run hangs until the CI aborts. With a deadline it becomes a red test. */
const CALL_DEADLINE = 120_000;

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { ROOT, testData } = require('./helpers/sources');
const _req = require('./helpers/sources').buildAndRequire();
const { noDb, missingPrecondition } = require('./helpers/db');
const { holdsSet, holdsPart, quantityOf, subsetOf, catalogSet } = require('./helpers/inventory');
const db = testData();

/** Find pg_dump/psql — on the PATH or in a distribution installation. */
function clientApp(name) {
  const direct = spawnSync('which', [name], { encoding: 'utf8', timeout: CALL_DEADLINE });
  if (direct.status === 0) return direct.stdout.trim();
  const basis = '/usr/lib/postgresql';
  if (!fs.existsSync(basis)) return null;
  for (const v of fs.readdirSync(basis).sort().reverse()) {
    const p = path.join(basis, v, 'bin', name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function dbReachable() {
  try {
    await db.get('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

test('backup and restore', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    noDb(t);
    return;
  }

  const pgDump = clientApp('pg_dump');
  const psql = clientApp('psql');
  /**
   * The version of a client — belongs in the error message.
   */
  const variant = bin => {
    if (!bin) return '—';
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8', stdio: 'pipe', timeout: CALL_DEADLINE });
    return (r.stdout || r.stderr || '').trim() || '?';
  };
  if (!pgDump || !psql) {
    await db.pool.end().catch(() => {});
    missingPrecondition(t, 'pg_dump/psql nicht gefunden — Suite übersprungen');
    return;
  }

  const url = process.env.DATABASE_URL;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-backup-'));
  const dump = path.join(work, 'db.sql');

  // feed psql with a dump
  const lauf = (args, datei) =>
    spawnSync(psql, [...args, url, '-f', datei], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env },
      timeout: CALL_DEADLINE,
    });
  /** Exit code; `grund()` afterwards delivers psql's message for it. */
  let lastRun = null;
  const restoreIt = datei => {
    lastRun = lauf(['-v', 'ON_ERROR_STOP=1'], datei);
    return lastRun.status;
  };
  const applyWithoutStop = datei => {
    lastRun = lauf([], datei);
    return lastRun.status;
  };
  /** What psql said — the last lines, so that the message stays readable. */
  const reason = () =>
    (lastRun?.stderr || '').trim().split('\n').slice(-8).join('\n') || '(psql hat nichts nach stderr geschrieben)';

  await t.test('setup: schema and some data', async () => {
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await db.initSchema();
    const client = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(client);
    } finally {
      client.release();
    }

    await db.run(`INSERT INTO users (username, password_hash) VALUES ('sicherung','x')`);
    const uid = (await db.get(`SELECT id FROM users WHERE username='sicherung'`)).id;
    await holdsSet(db, uid, '10214-1', 0); // Quantity 0: the entry behind it carries it
    // Since migration 0033 the name is in the catalog. The backup must
    // bring it back too — and from a DIFFERENT table than the
    // quantity. Exactly this is the case where an incomplete backup
    // shows: a dump that only takes the stock brings every set back
    // nameless.
    await catalogSet(db, '10214-1', { name: 'Tower Bridge', year: 2010 });
    // Since migration 0032 the condition is in the entry. The backup
    // must bring it back from THERE — otherwise after the rebuild this test checks
    // a column that no longer exists and would have silently
    // become weaker.
    await db.run(
      `INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition)
       VALUES ($1,'10214-1',2,44.50,'U')`,
      [uid],
    );
    await holdsPart(db, uid, '3001', { quantity: 17, colorId: 4 });
    // What does not belong in the backup: a session, a login counter, a log line.
    await db.run(
      `INSERT INTO user_sessions (sid, sess, expire) VALUES ('sicherung-sid', '{"userId":1}', NOW() + INTERVAL '1 day')`,
    );
    await db.run(`INSERT INTO rate_limit_attempts (key, count, first_at) VALUES ('login-name|name:abc', 1, NOW())`);
    await db.run(`INSERT INTO app_logs (level, message) VALUES ('warn', '[anmeldung] sicherung')`);
  });

  // The same options as backup.sh: what is measured is what the script backs up.
  const options = (
    fs.readFileSync(path.join(ROOT, 'scripts', 'backup.sh'), 'utf8').match(/^DUMP_OPTIONEN="([^"]+)"$/m)?.[1] ?? ''
  )
    .split(' ')
    .filter(Boolean);

  await t.test('pg_dump creates a complete dump', () => {
    assert.ok(options.includes('--clean'), `backup.sh: DUMP_OPTIONEN nicht gefunden (${options})`);
    execFileSync(pgDump, [...options, '-f', dump, url], { stdio: 'pipe', timeout: CALL_DEADLINE });
    const inhalt = fs.readFileSync(dump, 'utf8');
    assert.match(
      inhalt.slice(-500),
      /PostgreSQL database dump complete/,
      'Die Endmarke fehlt — genau daran erkennen backup.sh und restore.sh einen Torso',
    );
    assert.match(
      inhalt,
      /DROP TABLE IF EXISTS public\.sets/,
      '--clean --if-exists fehlt: Der Dump liesse sich nicht in eine bestehende DB einspielen',
    );
  });

  await t.test('after restoring the data is back', async () => {
    // Devastate — exactly as it would look in an emergency: everything gone.
    await db.run('DROP SCHEMA public CASCADE');
    await db.run('CREATE SCHEMA public');
    await assert.rejects(
      () => db.get('SELECT COUNT(*) FROM sets'),
      'Der Aufbau der Gegenprobe stimmt nicht — die Tabellen sind noch da',
    );

    assert.equal(
      restoreIt(dump),
      0,
      `Das Zurückspielen scheiterte. psql sagt:\n${reason()}\n` +
        `pg_dump: ${variant(pgDump)} · psql: ${variant(psql)}`,
    );

    const s = await db.get(`SELECT user_id, set_number FROM sets`);
    assert.equal(s.set_number, '10214-1');
    // The quantity from the entries (migration 0036) — and thereby it is
    // here a second statement about a second table, just like name and
    // year below: a dump that only takes `sets` brings every set back at
    // zero copies.
    assert.equal(
      await quantityOf(db, s.user_id, '10214-1'),
      2,
      'Die Stückzahl ist nicht zurückgekommen — set_acquisitions fehlt im Dump',
    );
    // Name and year from the catalog — a DIFFERENT table than the quantity
    // above. Exactly this is where an incomplete backup shows: a
    // dump that only takes the stock brings every set back nameless.
    const k = await db.get(
      `SELECT r.name, r.year FROM sets s
         JOIN set_catalog c ON c.set_number = s.set_number
         JOIN rb_sets r ON r.set_num = c.set_number
        WHERE s.set_number='10214-1'`,
    );
    assert.equal(k?.name, 'Tower Bridge');
    assert.equal(Number(k?.year), 2010);
    const a = await db.get(`SELECT purchase_price, condition FROM set_acquisitions`);
    assert.equal(a?.condition, 'U', 'Der Zustand ging beim Wiederherstellen verloren');
    assert.equal(Number(a?.purchase_price), 44.5, 'Der Kaufpreis ging beim Wiederherstellen verloren');
    const p2 = await db.get(`SELECT user_id, part_number, color_id FROM parts`);
    assert.equal(p2.part_number, '3001');
    assert.equal(
      await subsetOf(db, p2.user_id, '3001', p2.color_id),
      17,
      'Die Stückzahl ist nicht zurückgekommen — part_acquisitions fehlt im Dump',
    );
  });

  await t.test('sessions, counters and log come back empty, the app starts', async () => {
    for (const tabelle of ['user_sessions', 'rate_limit_attempts', 'app_logs']) {
      assert.ok(
        (await db.get('SELECT to_regclass($1) AS t', [`public.${tabelle}`])).t,
        `${tabelle} fehlt nach dem Zurückspielen`,
      );
      assert.equal(
        (await db.get(`SELECT count(*)::int n FROM ${tabelle}`)).n,
        0,
        `${tabelle} steht mit Zeilen in der Sicherung`,
      );
    }
    // As at server start: check the schema and apply migrations, without errors.
    await db.initSchema();
    const c = await db.pool.connect();
    try {
      assert.deepEqual(await _req('db/migrate.js').runMigrations(c), []);
    } finally {
      c.release();
    }
  });

  await t.test('a truncated dump is recognized by the end marker', () => {
    // The case the check in backup.sh guards against: pg_dump fails at the
    // start of the pipe, gzip runs through, the file is formally valid.
    const torso = path.join(work, 'torso.sql');
    const inhalt = fs.readFileSync(dump, 'utf8');
    fs.writeFileSync(torso, inhalt.slice(0, Math.floor(inhalt.length * 0.6)));

    assert.doesNotMatch(
      fs.readFileSync(torso, 'utf8').slice(-500),
      /PostgreSQL database dump complete/,
      'Ein halber Dump darf die Endmarke nicht tragen',
    );
  });

  await t.test('ON_ERROR_STOP is the difference between success and fake success', () => {
    // A dump that breaks off in the middle of a statement. WITHOUT ON_ERROR_STOP
    // psql reports exit 0 for it — that is the whole rationale for the variable in
    // restore.sh, and here it stands as a measurement instead of a claim.
    const kaputt = path.join(work, 'kaputt.sql');
    fs.writeFileSync(
      kaputt,
      'CREATE TABLE sicherungsprobe (id int);\n' +
        'INSERT INTO gibtesnicht VALUES (1);\n' + // fails
        'INSERT INTO sicherungsprobe VALUES (2);\n',
    );

    assert.equal(
      applyWithoutStop(kaputt),
      0,
      'Ohne ON_ERROR_STOP müsste psql den Fehler verschlucken — tut es das nicht ' +
        'mehr, ist die Begründung in restore.sh überholt und gehört angepasst',
    );
    assert.notEqual(
      restoreIt(kaputt),
      0,
      'MIT ON_ERROR_STOP muss psql mit einem Fehler abbrechen — sonst schützt die Variable nichts',
    );
  });

  await t.test('the scripts really use both precautions', () => {
    // The scripts themselves run via `docker compose exec` and are not
    // executable here. What is checked therefore is that they use the mechanism
    // MEASURED above — the measurement says it works, this says it is used.
    const backup = fs.readFileSync(path.join(ROOT, 'scripts', 'backup.sh'), 'utf8');
    const restore = fs.readFileSync(path.join(ROOT, 'scripts', 'restore.sh'), 'utf8');

    // Pinned to the COMMAND LINE, not to the occurrence in the text: both
    // scripts explain the end marker at length in a comment. A pattern over
    // the whole file would have been fulfilled by the explanation alone — on the
    // first attempt it was, and the counter-check stayed green although
    // the check had been removed.
    const withoutComment = t =>
      t
        .split('\n')
        .filter(z => !/^\s*#/.test(z))
        .join('\n');
    const bCode = withoutComment(backup);
    const rCode = withoutComment(restore);

    assert.match(
      bCode,
      /grep -q 'PostgreSQL database dump complete'/,
      'backup.sh prüft die Endmarke nicht mehr — ein Torso ginge als Sicherung durch',
    );
    assert.match(
      rCode,
      /grep -q 'PostgreSQL database dump complete'/,
      'restore.sh prüft die Endmarke nicht, BEVOR es etwas überschreibt',
    );
    assert.match(rCode, /ON_ERROR_STOP=1/, 'Ohne ON_ERROR_STOP meldet ein halber Restore Erfolg');
    assert.match(
      bCode,
      /^umask 077$/m,
      'Die Sicherung enthält Klartext-Schlüssel — sie darf nur für den Besitzer lesbar entstehen',
    );
  });

  await t.test('clean up', async () => {
    await db.run('DROP TABLE IF EXISTS sicherungsprobe').catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });
});

/**
 * backup.sh itself, with a rebuilt `docker` on the PATH: the
 * data key next to the dump made its encryption worthless.
 *
 * Counter-checks (measured on 29.10.2026):
 *   A  --exclude for data/.datenschluessel removed → red: “the key
 *      is in the archive"
 *   B  copying to BACKUP_SCHLUESSEL_ZIEL removed → red: “… missing at the
 *      separate place"
 *   C  (01.11.2026) SCHLUESSEL fixed to data/.datenschluessel again → red:
 *      “schluessel/datenschluessel …" (reports “no key file")
 */
test('backup.sh: the data key does not go into the archive', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sicherung-schluessel-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'docker'),
    "#!/bin/sh\nprintf -- '-- Dump\\n-- PostgreSQL database dump complete\\n'\n",
    { mode: 0o755 },
  );
  const work = path.join(tmp, 'installation');
  fs.mkdirSync(path.join(work, 'data', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(work, 'data', 'uploads', 'anleitung.pdf'), '%PDF-1.4');
  const schluessel = 'k'.repeat(44);
  fs.writeFileSync(path.join(work, 'data', '.datenschluessel'), schluessel, { mode: 0o600 });

  const sichern = env =>
    spawnSync('sh', [path.join(ROOT, 'scripts', 'backup.sh'), path.join(tmp, 'ziel')], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKUP_KLARTEXT: 'ja', ...env },
      timeout: CALL_DEADLINE,
    });

  const ohne = sichern({});
  assert.equal(ohne.status, 0, ohne.stderr);
  const archive = fs.readdirSync(path.join(tmp, 'ziel')).find(n => n.startsWith('data_'));
  const inhalt = execFileSync('tar', ['tzf', path.join(tmp, 'ziel', archive)], {
    encoding: 'utf8',
    timeout: CALL_DEADLINE,
  });
  assert.match(inhalt, /data\/uploads\/anleitung\.pdf/, 'Vorbedingung: data/ ist im Archiv');
  assert.doesNotMatch(inhalt, /datenschluessel/, 'der Schlüssel liegt im Archiv');
  assert.match(ohne.stderr, /NICHT in der Sicherung/, 'ohne getrennten Ort muss das Skript es sagen');

  const tresor = path.join(tmp, 'tresor');
  const mit = sichern({ BACKUP_SCHLUESSEL_ZIEL: tresor });
  assert.equal(mit.status, 0, mit.stderr);
  const kopie = path.join(tresor, 'datenschluessel');
  assert.equal(
    fs.existsSync(kopie) && fs.readFileSync(kopie, 'utf8'),
    schluessel,
    'der Schlüssel fehlt am getrennten Ort',
  );
  assert.equal(fs.statSync(kopie).mode & 0o077, 0, 'der Schlüssel ist für andere lesbar');
  assert.doesNotMatch(mit.stderr, /NICHT in der Sicherung/);
});

test('backup.sh: schluessel/datenschluessel only goes to the separate location', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sicherung-schluessel-neu-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'docker'),
    "#!/bin/sh\nprintf -- '-- Dump\\n-- PostgreSQL database dump complete\\n'\n",
    { mode: 0o755 },
  );
  const work = path.join(tmp, 'installation');
  fs.mkdirSync(path.join(work, 'data', 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(work, 'schluessel'));
  fs.writeFileSync(path.join(work, 'data', 'uploads', 'rechnung.pdf'), '%PDF-1.4');
  const schluessel = 'n'.repeat(44);
  fs.writeFileSync(path.join(work, 'schluessel', 'datenschluessel'), schluessel, { mode: 0o600 });
  const tresor = path.join(tmp, 'tresor');
  const r = spawnSync('sh', [path.join(ROOT, 'scripts', 'backup.sh'), path.join(tmp, 'ziel')], {
    cwd: work,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKUP_KLARTEXT: 'ja', BACKUP_SCHLUESSEL_ZIEL: tresor },
    timeout: CALL_DEADLINE,
  });
  assert.equal(r.status, 0, r.stderr);
  const archive = fs.readdirSync(path.join(tmp, 'ziel')).find(n => n.startsWith('data_'));
  const inhalt = execFileSync('tar', ['tzf', path.join(tmp, 'ziel', archive)], {
    encoding: 'utf8',
    timeout: CALL_DEADLINE,
  });
  assert.match(inhalt, /data\/uploads\/rechnung\.pdf/);
  assert.doesNotMatch(inhalt, /schluessel/);
  assert.equal(
    fs.readFileSync(path.join(tresor, 'datenschluessel'), 'utf8'),
    schluessel,
    'schluessel/datenschluessel fehlt am getrennten Ort',
  );
  assert.doesNotMatch(r.stderr, /Datenordner|keine Schlüsseldatei/);
});

/**
 * restore.sh with a real database: `docker` is a stand-in that calls psql,
 * postgres/app-role.sh and the migration service against the test DB. The
 * dump, as with backup.sh, comes from the superuser and contains a check rule whose
 * function belongs to the migration role; restored as superuser, it created a
 * superuser role.
 *
 * Counter-checks (measured 02.11.2026):
 *   A  restore.sh restores as superuser again (`-U "$DB_MIGRATION_USER"` replaced
 *      by `-U tester`) → red: “code of the migration role ran as superuser”
 *   B  the line with `OWNER TO` removed in the awk filter → red: “a dump from
 *      before the app role” (must be able to SET ROLE)
 *   C  (04.11.) the prepended \restrict removed → red: “a backslash command
 *      in the middle of a line does not run” (the file was created)
 */
test('restore.sh loads as the migration role', { timeout: 240_000 }, async t => {
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const basis = new URL(
    process.env.TEST_DB_BASIS || process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest',
  );
  const admin = new Client({ connectionString: basis.toString() });
  try {
    await admin.connect();
  } catch (e) {
    noDb(t, e);
    return;
  }
  const su = (await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0]?.rolsuper;
  if (!su || !clientApp('pg_dump')) {
    await admin.end();
    missingPrecondition(t, 'kein Superuser oder pg_dump');
    return;
  }
  const name = testName('rst');
  await cleanRemainder(admin, 'rst');
  const [ziel, alt, APP, MIG, LESEN, BOESE, SYS, SYSWEB] = [
    name,
    `${name}_alt`,
    `${name}_app`,
    `${name}_mig`,
    `${name}_lesen`,
    `${name}_boese`,
    `${name}_sys`,
    `${name}_sysweb`,
  ];
  const id = s => `"${s}"`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-rolle-'));
  t.after(async () => {
    for (const d of [ziel, alt]) await admin.query(`DROP DATABASE IF EXISTS ${id(d)} WITH (FORCE)`).catch(() => {});
    for (const r of [APP, MIG, LESEN, BOESE, SYS, SYSWEB])
      await admin.query(`DROP ROLE IF EXISTS ${id(r)}`).catch(() => {});
    await admin.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const suUser = decodeURIComponent(basis.username),
    suPw = decodeURIComponent(basis.password);
  const environment = {
    ...process.env,
    PGHOST: basis.hostname,
    PGPORT: basis.port || '5432',
    PGUSER: suUser,
    PGPASSWORD: suPw,
    PGDATABASE: ziel,
    DB_APP_USER: APP,
    DB_APP_PASSWORD: `app-${process.pid}`,
    DB_MIGRATION_USER: MIG,
    DB_MIGRATION_PASSWORD: `mig-${process.pid}`,
    DB_LESEN_USER: LESEN,
    PGWEB_DB_PASSWORD: '',
    DB_SYSTEM_USER: SYS,
    DB_SYSTEM_PASSWORD: `sys-${process.pid}`,
    DB_SYSTEM_WEB_USER: SYSWEB,
  };
  const dbUrl = (db, nutzer = suUser, pw = suPw) => {
    const u = new URL(basis);
    u.pathname = '/' + db;
    u.username = nutzer;
    u.password = pw;
    return u.toString();
  };
  const schema = url =>
    spawnSync(
      process.execPath,
      [
        '-e',
        "const { db } = require('./dist/startup/wiring.js').wireProcess(); db.initSchemaOnce().then(() => db.pool.end()).catch(e => { console.error(e.message); process.exit(1); })",
      ],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url }, timeout: CALL_DEADLINE },
    );
  const rolle = () =>
    spawnSync('sh', [path.join(ROOT, 'postgres', 'app-role.sh')], {
      encoding: 'utf8',
      env: environment,
      timeout: CALL_DEADLINE,
    });

  await admin.query(`CREATE DATABASE ${id(ziel)}`);
  assert.equal(rolle().status, 0);
  const s = schema(dbUrl(ziel, MIG, environment.DB_MIGRATION_PASSWORD));
  assert.equal(s.status, 0, s.stderr);
  const app = new Client({ connectionString: dbUrl(ziel, MIG, environment.DB_MIGRATION_PASSWORD) });
  await app.connect();
  try {
    await app.query(`INSERT INTO users (username, password_hash) VALUES ('rueckspiel', 'x')`);
    await app.query(`CREATE FUNCTION public.falle(int) RETURNS boolean LANGUAGE plpgsql AS $f$
      BEGIN EXECUTE 'CREATE ROLE ${id(BOESE)} SUPERUSER'; RETURN true;
      EXCEPTION WHEN insufficient_privilege OR duplicate_object THEN RETURN true; END $f$`);
    await app.query(`CREATE TABLE public.falle (x int CHECK (public.falle(x)))`);
    await app.query(`INSERT INTO public.falle VALUES (1)`);
  } finally {
    await app.end();
  }
  assert.equal((await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [BOESE])).rowCount, 0, 'Vorbedingung');

  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(tmp, 'pgpass'),
    `*:*:*:${MIG}:${environment.DB_MIGRATION_PASSWORD}\n*:*:*:${suUser}:${suPw}\n`,
    { mode: 0o600 },
  );
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh
case "$2 $4" in
  exec*) shift 5; unset PGPASSWORD; PGPASSFILE='${path.join(tmp, 'pgpass')}' exec psql "$@" ;;
  'run db-rolle') exec sh '${path.join(ROOT, 'postgres', 'app-role.sh')}' ;;
  'run migration') cd '${ROOT}' && DATABASE_URL='${dbUrl(ziel, MIG, environment.DB_MIGRATION_PASSWORD)}' exec '${process.execPath}' dist/startup/migrate.js ;;
  'run '*) echo "unbekannter Dienst $4" >&2; exit 9 ;;
esac
`,
    { mode: 0o755 },
  );
  fs.mkdirSync(path.join(tmp, 'schluessel'));
  fs.writeFileSync(path.join(tmp, 'schluessel', 'datenschluessel'), 'k');
  const zurueck = dump =>
    spawnSync('sh', [path.join(ROOT, 'scripts', 'restore.sh'), dump], {
      cwd: tmp,
      input: 'ja\n',
      encoding: 'utf8',
      env: { ...environment, PATH: `${bin}:${process.env.PATH}` },
      timeout: CALL_DEADLINE,
    });
  const sichern = (db, datei) => {
    execFileSync(clientApp('pg_dump'), ['--clean', '--if-exists', '-f', datei, dbUrl(db)], {
      stdio: 'pipe',
      timeout: CALL_DEADLINE,
    });
    execFileSync('gzip', [datei]);
    return `${datei}.gz`;
  };

  await t.test('code of the app role does not run as superuser when loading', async () => {
    const r = zurueck(sichern(ziel, path.join(tmp, 'db.sql')));
    assert.deepEqual(
      (await admin.query('SELECT rolname FROM pg_roles WHERE rolname = $1', [BOESE])).rows,
      [],
      'Code der Migrationsrolle lief als Superuser',
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = new Client({ connectionString: dbUrl(ziel) });
    await c.connect();
    try {
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM users WHERE username = 'rueckspiel'`)).rows[0].n, 1);
      assert.equal(
        (await c.query(`SELECT pg_get_userbyid(relowner) AS e FROM pg_class WHERE oid = 'public.falle'::regclass`))
          .rows[0].e,
        MIG,
      );
      // The row privileges of the runtime role come along (default privileges of the migration role, db-rolle afterwards).
      assert.equal(
        (
          await c.query(
            `SELECT has_table_privilege($1, 'public.sets', 'INSERT') AND NOT has_table_privilege($1, 'public.sets', 'TRUNCATE')
        AND NOT has_table_privilege($1, 'public.users', 'INSERT')
        AND NOT has_schema_privilege($1, 'public', 'CREATE') AS ok`,
            [APP],
          )
        ).rows[0].ok,
        true,
        'die Laufzeitrolle hat nach dem Restore andere Rechte',
      );
    } finally {
      await c.end();
    }
  });

  await t.test('a dump from before the app role (everything belongs to the superuser)', async () => {
    await admin.query(`CREATE DATABASE ${id(alt)}`);
    const a = schema(dbUrl(alt));
    assert.equal(a.status, 0, a.stderr);
    const dump = sichern(alt, path.join(tmp, 'alt.sql'));
    assert.match(
      execFileSync('gunzip', ['-c', dump], { encoding: 'utf8' }),
      new RegExp(`OWNER TO ${suUser};`),
      'Vorbedingung',
    );
    const r = zurueck(dump);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const c = new Client({ connectionString: dbUrl(ziel) });
    await c.connect();
    try {
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM users WHERE username = 'admin'`)).rows[0].n, 1);
      assert.deepEqual(
        (
          await c.query(`SELECT DISTINCT pg_get_userbyid(relowner) AS e FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'S', 'v')
          AND NOT EXISTS (SELECT FROM pg_depend d WHERE d.objid = pg_class.oid AND d.deptype = 'e')`)
        ).rows,
        [{ e: MIG }],
      );
    } finally {
      await c.end();
    }
  });

  await t.test('a backslash command in the middle of a line does not run', async () => {
    const geknackt = path.join(tmp, 'geknackt');
    const sql = path.join(tmp, 'fremd.sql');
    execFileSync(clientApp('pg_dump'), ['--clean', '--if-exists', '-f', sql, dbUrl(ziel)], {
      stdio: 'pipe',
      timeout: CALL_DEADLINE,
    });
    const inhalt = fs.readFileSync(sql, 'utf8');
    const ende = inhalt.lastIndexOf('--\n-- PostgreSQL database dump complete');
    fs.writeFileSync(sql, `${inhalt.slice(0, ende)}SELECT 1; \\! touch '${geknackt}'\n${inhalt.slice(ende)}`);
    execFileSync('gzip', ['-f', sql]);
    const r = zurueck(`${sql}.gz`);
    assert.ok(!fs.existsSync(geknackt), 'ein Backslash-Befehl mitten in einer Zeile lief');
    assert.notEqual(r.status, 0, 'der fremde Dump galt als eingespielt');
    assert.match(r.stderr, /restricted/);
  });
});
