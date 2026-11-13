/**
 * Ohne NODE_ENV gelten alle Regeln des Betriebs, nicht nur ein Teil davon:
 * Startverbote, Superuser-Verbot, verborgene 5xx-Texte, sicheres Cookie.
 * Geprüft am echten Server (dist/server.js), gestartet ohne NODE_ENV.
 *
 * Gegenprobe (05.11.2026 gemessen, drei Stellen zugleich zurück auf
 * `produktion`): starte() in server.ts → rot „MAIL_KONSOLE_MIT_TOKEN=1 …“;
 * warneBeiSuperuser() → rot „als Superuser …“; handleRouteError → rot
 * „ein 5xx …“. Je ein roter Teil zu jeder Stelle.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL (als Superuser verbunden).
 *
 * @superuser (Ratsche in test/rollen-trennung-db.test.js)
 */
const test = require('node:test');
const { umgebung } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { startVerbote, ladeKonfig, cookieSicher } = _req('src/infra/konfig.js');

/** Ohne NODE_ENV starten; `PATH` allein, damit nichts aus der Testumgebung hineinfällt. */
function starte(env, ms = 25_000) {
  return new Promise(fertig => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        PORT: '39651',
        SESSION_SECRET: 'ohne-node-env-geheimnis-lang-genug-12345',
        APP_BASE_URL: 'https://lego.example.org',
        ...env,
      },
    });
    let log = '';
    srv.stdout.on('data', d => {
      log += d;
    });
    srv.stderr.on('data', d => {
      log += d;
    });
    const uhr = setTimeout(() => {
      srv.kill('SIGKILL');
    }, ms);
    srv.on('exit', code => {
      clearTimeout(uhr);
      fertig({ code, log });
    });
  });
}

test('startVerbote ohne NODE_ENV', () => {
  assert.ok(startVerbote({ MAIL_KONSOLE_MIT_TOKEN: '1', APP_BASE_URL: 'https://x.example' }).length >= 1);
  assert.deepEqual(startVerbote({ NODE_ENV: 'test', MAIL_KONSOLE_MIT_TOKEN: '1' }), []);
  const k = ladeKonfig({});
  assert.equal(k.betrieb, true);
  assert.equal(cookieSicher(k), true, 'ohne NODE_ENV ein sicheres Cookie wie im Betrieb');
});

test('MAIL_KONSOLE_MIT_TOKEN=1 ohne NODE_ENV: Start verweigert', { timeout: 40_000 }, async () => {
  const r = await starte({ DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x', MAIL_KONSOLE_MIT_TOKEN: '1' });
  assert.notEqual(r.code, 0, r.log.slice(-400));
  assert.match(r.log, /❌ \[mail\] MAIL_KONSOLE_MIT_TOKEN=1 .*Start verweigert/);
  assert.doesNotMatch(r.log, /Database initialisation failed/, 'das Verbot kommt vor der Datenbank');
});

test('als Superuser ohne NODE_ENV: Start verweigert', { timeout: 60_000 }, async t => {
  const db = await dbOderSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const istSuper = (await db.get('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rolsuper;
  assert.equal(istSuper, true, 'Vorbedingung: die Test-DB verbindet als Superuser');
  const r = await starte({ DATABASE_URL: URL_DB });
  assert.equal(r.code, 1, r.log.slice(-600));
  assert.match(r.log, /als Superuser — Start verweigert/);
});

test('ein 5xx nennt ohne NODE_ENV keine Interna', () => {
  const alt = process.env.NODE_ENV;
  umgebung({ NODE_ENV: undefined });
  try {
    const { handleRouteError } = _req('src/http/httpAntwort.js');
    let antwort;
    const res = {
      headersSent: false,
      status: () => ({
        json: b => {
          antwort = b;
        },
      }),
    };
    const warn = console.error;
    console.error = () => {};
    try {
      handleRouteError(res, new Error('relation "geheim_intern" does not exist'), 500);
    } finally {
      console.error = warn;
    }
    assert.equal(antwort.code, 'interner_fehler');
    assert.doesNotMatch(antwort.error, /geheim_intern/);
  } finally {
    umgebung({ NODE_ENV: alt });
  }
});
