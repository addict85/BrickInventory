/**
 * Without NODE_ENV all rules of operation apply, not only a part of them:
 * start bans, superuser ban, hidden 5xx texts, secure cookie.
 * Checked on the real server (dist/server.js), started without NODE_ENV.
 *
 * Counter-check (measured 05.11.2026, three places back to
 * `production` at once): starte() in server.ts → red “MAIL_CONSOLE_WITH_TOKEN=1 …”;
 * warnAtSuperuser() → red “as superuser …”; handleRouteError → red
 * “a 5xx …”. One red part for each place.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (connected as superuser).
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const { environment } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const URL_DB = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATABASE_URL = URL_DB;
const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { startBans, loadConfig, cookieSafe } = _req('src/infra/config.js');

/** Start without NODE_ENV; `PATH` alone, so that nothing from the test environment falls in. */
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
    const clock = setTimeout(() => {
      srv.kill('SIGKILL');
    }, ms);
    srv.on('exit', code => {
      clearTimeout(clock);
      fertig({ code, log });
    });
  });
}

test('startBans without NODE_ENV', () => {
  assert.ok(startBans({ MAIL_CONSOLE_WITH_TOKEN: '1', APP_BASE_URL: 'https://x.example' }).length >= 1);
  assert.deepEqual(startBans({ NODE_ENV: 'test', MAIL_CONSOLE_WITH_TOKEN: '1' }), []);
  const k = loadConfig({});
  assert.equal(k.operation, true);
  assert.equal(cookieSafe(k), true, 'without NODE_ENV a secure cookie as in production');
});

test('MAIL_CONSOLE_WITH_TOKEN=1 without NODE_ENV: startup refused', { timeout: 40_000 }, async () => {
  const r = await starte({ DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x', MAIL_CONSOLE_WITH_TOKEN: '1' });
  assert.notEqual(r.code, 0, r.log.slice(-400));
  assert.match(r.log, /❌ \[mail\] MAIL_CONSOLE_WITH_TOKEN=1 .*Start verweigert/);
  assert.doesNotMatch(r.log, /Database initialisation failed/, 'the ban comes before the database');
});

test('as superuser without NODE_ENV: startup refused', { timeout: 60_000 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  t.after(() => db.pool.end().catch(() => {}));
  const isSuper = (await db.get('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rolsuper;
  assert.equal(isSuper, true, 'precondition: the test DB connects as superuser');
  const r = await starte({ DATABASE_URL: URL_DB });
  assert.equal(r.code, 1, r.log.slice(-600));
  assert.match(r.log, /als Superuser — Start verweigert/);
});

test('a 5xx names no internals without NODE_ENV', () => {
  const alt = process.env.NODE_ENV;
  environment({ NODE_ENV: undefined });
  try {
    const { handleRouteError } = _req('src/http/httpResponse.js');
    let response;
    const res = {
      headersSent: false,
      status: () => ({
        json: b => {
          response = b;
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
    assert.equal(response.code, 'internal_error');
    assert.doesNotMatch(response.error, /geheim_intern/);
  } finally {
    environment({ NODE_ENV: alt });
  }
});
