/**
 * Es läuft genau ein Web-Prozess je Datenbank (startup/einzelinstanz.ts): Drossel,
 * PDF-Tickets und Zwischenspeicher liegen in seinem Speicher. Ein zweiter wartet
 * auf das Ende des ersten und gibt dann mit klarer Meldung auf; reisst die Sperr-
 * verbindung ab, holt der Prozess die Sperre zurück oder gibt auf.
 *
 * Gegenproben (12.11.2026 gemessen, je einzeln):
 *   A  in server.ts den Aufruf halteWebSperre() gestrichen → rot: „der echte Server
 *      wartet, solange ein anderer die Sperre hält“
 *   B  in versuche() pg_try_advisory_lock durch `SELECT true AS ok` ersetzt → rot:
 *      „ein zweiter Zugang bekommt die Sperre nicht …“
 *   C  im Fehlerzuhörer von halte() nichts zurückholen (nur `client = null`) → rot:
 *      „nach einem Abriss holt der Prozess die Sperre zurück“
 *   D  bei einem Verbindungsfehler aufgeben statt es erneut zu versuchen → rot: „fehlt
 *      die Datenbank eine Weile, holt er die Sperre danach zurück“
 *   E  (13.11.2026) ohne `database =` in halter(), während eine ANDERE Datenbank
 *      im Cluster die Sperre hält → rot: „ein zweiter Zugang …“ (2 statt 1); mit
 *      der Bedingung unter derselben Störung grün
 *
 * @superuser (Ratsche in test/rollen-trennung-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const _req = require('./helpers/sources').buildAndRequire();
const { zugangOderSkip } = require('./helpers/db');
const { bis } = require('./helpers/zeit');
const modul = require(path.join(__dirname, '..', 'dist', 'db', 'database.js'));

const ROOT = path.join(__dirname, '..');
const KURZ = { wartenMs: 300, taktMs: 50 };

test('ein Web-Prozess je Datenbank', { concurrency: 1 }, async t => {
  const db = await zugangOderSkip(t, _req);
  if (!db) return;
  const { halteWebSperre: echteSperre, ZweiterWebProzess } = _req('startup/einzelinstanz.js');
  // Jede gehaltene Sperre wird am Ende freigegeben, auch wenn ein Fall vorher scheitert.
  const offen = new Set();
  const halteWebSperre = async (zugang, o) => {
    const f = await echteSperre(zugang, o);
    offen.add(f);
    return async () => {
      offen.delete(f);
      await f();
    };
  };
  const { LOCKS } = _req('src/infra/lockNamespaces.js');
  const a = modul.erzeugeDb(modul.dbKonfigAusUmgebung()),
    b = modul.erzeugeDb(modul.dbKonfigAusUmgebung());
  t.after(async () => {
    for (const f of offen) await f();
    await a.pool.end();
    await b.pool.end();
    await db.pool.end().catch(() => {});
  });
  const halter = () =>
    // pg_locks gilt für den ganzen Cluster: Parallele Testdateien halten dieselbe Sperre auf ihrer Kopie.
    db.all(
      `SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = $1 AND objid = 0 AND granted
              AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      [LOCKS.WEB_PROZESS],
    );
  const stumm = async f => {
    const echt = console.warn;
    console.warn = () => {};
    try {
      return await f();
    } finally {
      console.warn = echt;
    }
  };

  await t.test('ein zweiter Zugang bekommt die Sperre nicht und sagt warum', async () => {
    const frei = await halteWebSperre(a, KURZ);
    try {
      await stumm(() => assert.rejects(halteWebSperre(b, KURZ), ZweiterWebProzess));
      await stumm(() => assert.rejects(halteWebSperre(b, KURZ), /zweiter Web-Prozess.*ROLLE=jobs/s));
      assert.equal((await halter()).length, 1);
    } finally {
      await frei();
    }
    assert.equal((await halter()).length, 0, 'freigegeben');
  });

  await t.test('er wartet auf einen endenden Vorgänger', async () => {
    const frei = await halteWebSperre(a, KURZ);
    const zweiter = stumm(() => halteWebSperre(b, { wartenMs: 5000, taktMs: 50 }));
    setTimeout(() => void frei(), 200);
    const frei2 = await zweiter;
    assert.equal((await halter()).length, 1);
    await frei2();
  });

  await t.test('nach einem Abriss holt der Prozess die Sperre zurück', async () => {
    const verluste = [];
    const frei = await halteWebSperre(a, { ...KURZ, beiVerlust: e => verluste.push(e) });
    const [{ pid }] = await halter();
    await db.get('SELECT pg_terminate_backend($1)', [pid]);
    assert.ok(await bis(async () => (await halter()).some(h => h.pid !== pid), 3000), 'Sperre zurückgeholt');
    assert.deepEqual(verluste, []);
    await frei();
  });

  await t.test('… oder gibt auf, wenn inzwischen ein anderer sie hält', async () => {
    const verluste = [];
    const frei = await halteWebSperre(a, { ...KURZ, beiVerlust: e => verluste.push(e) });
    const [{ pid }] = await halter();
    const fremd = await b.eigeneVerbindung();
    try {
      const wartet = fremd.query('SELECT pg_advisory_lock($1, 0)', [LOCKS.WEB_PROZESS]);
      await db.get('SELECT pg_terminate_backend($1)', [pid]);
      await wartet;
      await stumm(() => bis(() => verluste.length > 0, 3000));
      assert.equal(verluste.length, 1);
      assert.ok(verluste[0] instanceof ZweiterWebProzess, String(verluste[0]));
    } finally {
      await fremd.end();
      await frei();
    }
  });

  await t.test('fehlt die Datenbank eine Weile, holt er die Sperre danach zurück', async () => {
    const verluste = [];
    const frei = await halteWebSperre(a, { ...KURZ, beiVerlust: e => verluste.push(e) });
    const [{ pid }] = await halter();
    const name = new URL(process.env.DATABASE_URL).pathname.slice(1);
    const wartung = new URL(process.env.DATABASE_URL);
    wartung.pathname = '/postgres';
    const { Client } = require('pg');
    const admin = new Client({ connectionString: wartung.toString() });
    await admin.connect();
    try {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS false`);
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      // Länger als die Wartefrist (300 ms): Ein Verbindungsfehler ist kein zweiter Prozess.
      await bis(() => false, 800);
    } finally {
      await admin.query(`ALTER DATABASE "${name}" ALLOW_CONNECTIONS true`);
      await admin.end();
    }
    assert.ok(await bis(async () => (await halter().catch(() => [])).length === 1, 5000), 'Sperre zurückgeholt');
    assert.deepEqual(verluste, []);
    await frei();
  });

  await t.test('der echte Server wartet, solange ein anderer die Sperre hält', async () => {
    const frei = await halteWebSperre(a, KURZ);
    let freigegeben = false;
    t.after(() => (freigegeben ? undefined : frei()));
    const port = await new Promise(r => {
      const s = net.createServer().listen(0, () => {
        const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
        s.close(() => r(p));
      });
    });
    const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SESSION_SECRET: 'einzelinstanz-test-geheimnis-lang-genug-1',
        PORT: String(port),
        ROLLE: 'web',
        NODE_ENV: 'production',
        DB_SUPERUSER_ERLAUBT: '1',
        APP_BASE_URL_FEHLT_OK: '1',
        COOKIE_SECURE: '0',
      },
    });
    let log = '';
    srv.stdout.on('data', d => {
      log += d;
    });
    srv.stderr.on('data', d => {
      log += d;
    });
    t.after(() => {
      if (srv.exitCode === null) srv.kill('SIGKILL');
    });
    const lebt = async () => (await fetch(`http://127.0.0.1:${port}/api/v1/health/live`).catch(() => null))?.ok;
    assert.ok(await bis(() => /anderer Web-Prozess hält die Sperre/.test(log), 30_000), log.slice(-1500));
    assert.equal(await lebt(), undefined, 'er nimmt keine Anfragen an, solange der andere lebt');
    freigegeben = true;
    await frei();
    assert.ok(await bis(lebt, 30_000), `nach dem Ende des anderen startet er:\n${log.slice(-1500)}`);
    srv.kill('SIGTERM');
  });
});
