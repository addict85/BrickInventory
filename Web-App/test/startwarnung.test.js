/**
 * Switches that turn off a protection layer in production (security review
 * 16, L5): MAIL_CONSOLE_WITH_TOKEN=1 prevents the start with NODE_ENV=production,
 * COOKIE_SECURE=0 results in a warning line. On the real server; a file of its own
 * because startverbot.test.js moved closer to the file's deadline with every
 * start.
 *
 * Counter-checks (measured 05.11.2026, each on its own):
 *   K  the branch on MAIL_CONSOLE_WITH_TOKEN removed in startBans() → red:
 *      “MAIL_CONSOLE_WITH_TOKEN=1 in production …” (code instead of 1: database error)
 *   L  the loop over startWarnings() removed in server.ts → red:
 *      “COOKIE_SECURE=0 in production …” (no warning line)
 * Counter-checks N10/N11 (measured 05.11.2026, each on its own):
 *   M  the branch on HSTS_MAX_AGE removed in startWarnings() → red:
 *      „HSTS_MAX_AGE=0 …“
 *   N  dbWithoutTls() always delivers false → red: “remote database …”
 *   O  (06.11.2026) in dbWithoutTls() the rule for names without a dot deleted →
 *      red: “remote database …” ({"PGHOST":"db-brickinventory"})
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { startWarnings } = _req('src/infra/config.js');

/** Start the server and wait for its end — at most `ms`, then it counts as running. */
function start(env, ms = 20000) {
  return new Promise(done => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        PORT: '39649',
        SESSION_SECRET: 'startverbot-geheimnis-lang-genug-1234567',
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
      done({ code, log });
    });
  });
}

test('MAIL_CONSOLE_WITH_TOKEN=1 in production: startup refused', { timeout: 50_000 }, async () => {
  const db = { DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x', APP_BASE_URL: 'https://lego.example.org' };
  const r = await start({ ...db, MAIL_CONSOLE_WITH_TOKEN: '1' });
  assert.equal(r.code, 1, r.log.slice(-400));
  assert.match(r.log, /❌ \[mail\] MAIL_CONSOLE_WITH_TOKEN=1 .*Start verweigert/);
  assert.doesNotMatch(r.log, /Database initialisation failed/, 'the ban comes before the database');
  const draft = await start({ ...db, MAIL_CONSOLE_WITH_TOKEN: '1', NODE_ENV: 'development' });
  assert.doesNotMatch(draft.log, /MAIL_CONSOLE_WITH_TOKEN/);
  assert.match(draft.log, /Database initialisation failed/);
});

test('COOKIE_SECURE=0 in production: warning line at startup', { timeout: 50_000 }, async () => {
  const db = { DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x', APP_BASE_URL: 'http://lego.lan' };
  const withIt = await start({ ...db, COOKIE_SECURE: '0' });
  assert.match(withIt.log, /⚠️ \[start\] COOKIE_SECURE=0: Das Sitzungs-Cookie geht auch über http/);
  assert.match(withIt.log, /Database initialisation failed/, 'only a warning, no ban');
  const without = await start({ ...db, COOKIE_SECURE: '1' });
  assert.doesNotMatch(without.log, /COOKIE_SECURE/);
});

test('HSTS_MAX_AGE=0 in production: exactly one warning', () => {
  const w = startWarnings({ NODE_ENV: 'production', HSTS_MAX_AGE: '0' });
  assert.equal(w.length, 1, JSON.stringify(w));
  assert.match(w[0], /HSTS_MAX_AGE=0/);
  assert.deepEqual(startWarnings({ NODE_ENV: 'production', HSTS_MAX_AGE: '31536000' }), []);
});

test('remote database without verified TLS: warning', () => {
  const tls = env => startWarnings({ NODE_ENV: 'production', ...env }).filter(x => x.startsWith('[datenbank]'));
  assert.equal(tls({ PGHOST: 'db.example.org' }).length, 1);
  assert.equal(tls({ DATABASE_URL: 'postgres://u:p@db.example.org/x?sslmode=require' }).length, 1);
  assert.deepEqual(tls({ PGHOST: 'db.example.org', PGSSLMODE: 'verify-full' }), []);
  assert.deepEqual(tls({ DATABASE_URL: 'postgres://u:p@db.example.org/x?sslmode=verify-full' }), []);
  assert.equal(tls({ PGHOST: '192.168.1.20' }).length, 1, 'an address in the LAN');
  for (const near of [
    {},
    { PGHOST: 'postgres' },
    { PGHOST: '127.0.0.1' },
    { DATABASE_URL: 'postgres://u:p@localhost/x' },
    { PGHOST: 'db-brickinventory' },
    { DATABASE_URL: 'postgres://u:p@db-brickinventory:5432/x' },
  ])
    assert.deepEqual(tls(near), [], JSON.stringify(near));
});
