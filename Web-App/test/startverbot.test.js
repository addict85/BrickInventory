/**
 * In production the server does not start with the example password of the
 * database or a TRUST_PROXY that believes whole networks. Checked on the
 * real server: it must exit with code 1 and a clear message
 * before it needs a database.
 *
 * Counter-checks (measured on 30.10.2026):
 *   A  the call of startBans() removed in server.ts → red: „der Server
 *      läuft mit dem Beispielpasswort weiter“ (both subchecks)
 *   B  the TRUST_PROXY branch removed in startBans() → red only at
 *      „TRUST_PROXY=docker“
 *   C  startBans() without the query on NODE_ENV → red: „ausserhalb von
 *      Produktion kein Verbot“
 * Counter-checks (measured 04.11.2026):
 *   D  sitzungsGeheimnis() again with `!konfig().production` instead of
 *      `konfig().entwicklung` → red: “without NODE_ENV no public
 *      session secret” (both cases start)
 *   E  the early call of sitzungsGeheimnis() deleted in starte() → red:
 *      the same check (the start only fails at the database, without a reason)
 *   F  `start` in package.json without NODE_ENV=production → red: „npm start …“
 *   G  the message on APP_BASE_URL deleted in server.ts → red: “without
 *      APP_BASE_URL in production …” (with the exception no message)
 * Counter-checks H4 (measured 04.11.2026, each on its own):
 *   H  the branch on APP_BASE_URL removed in startBans() → red: “without
 *      APP_BASE_URL in production …” (code instead of 1: database error)
 *   I  APP_BASE_URL_MISSING_OK not evaluated → red: the same check (refused
 *      with the exception)
 *   J  the exception for ROLE=jobs removed → red: the same check ({"ROLE":"jobs"})
 * Counter-checks (measured 08.11.2026, each on its own):
 *   K  'change-me-to-a-long-random-string' deleted from PLACEHOLDER_SECRETS
 *      → red: “example value and too short session secret …”
 *   L  the minimum length deleted in sitzungsGeheimnis() → red: the same check
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { startBans } = _req('src/infra/config.js');

/** Start the server and wait for its end — at most `ms`, then it counts as running. */
function starte(env, ms = 8000) {
  return new Promise(fertig => {
    const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        PORT: '39648',
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
      fertig({ code, log });
    });
  });
}

test('example database password: startup refused', { timeout: 30_000 }, async () => {
  for (const env of [
    { PGPASSWORD: 'brickinventory_secret', PGHOST: '127.0.0.1', PGPORT: '1' },
    { DATABASE_URL: 'postgres://brickinventory:brickinventory_secret@127.0.0.1:1/x' },
  ]) {
    const { code, log } = await starte(env);
    assert.equal(code, 1, `the server keeps running with the example password: ${log.slice(-400)}`);
    assert.match(log, /Beispielpasswort .*Start verweigert/);
  }
});

test('TRUST_PROXY=docker: startup refused', { timeout: 30_000 }, async () => {
  const { code, log } = await starte({ DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x', TRUST_PROXY: 'docker' });
  assert.equal(code, 1, log.slice(-400));
  assert.match(log, /TRUST_PROXY enthält „docker/);
});

test('without NODE_ENV no public session secret', { timeout: 30_000 }, async () => {
  const ohne = {
    NODE_ENV: undefined,
    DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x',
    APP_BASE_URL: 'https://lego.example.org',
  };
  for (const secret of [undefined, 'brickinventory-manager-dev-secret']) {
    const { code, log } = await starte({ ...ohne, SESSION_SECRET: secret });
    assert.equal(code, 1, log.slice(-400));
    assert.match(log, /SESSION_SECRET .*Start verweigert/);
  }
  // Explicitly in development the development secret applies; the start
  // then only fails at the database, which does not exist here.
  const { log } = await starte({ ...ohne, NODE_ENV: 'development', SESSION_SECRET: undefined });
  assert.doesNotMatch(log, /SESSION_SECRET/);
  assert.match(log, /Database initialisation failed/);
});

test('example value and too short session secret: startup refused', { timeout: 30_000 }, async () => {
  const env = { DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x', APP_BASE_URL: 'https://lego.example.org' };
  for (const [secret, reason] of /** @type {[string, RegExp][]} */ ([
    ['change-me-to-a-long-random-string', /Beispielwert/],
    ['nur-31-zeichen-lang-1234567890x', /zu kurz \(nötig sind mindestens 32 Zeichen/],
  ])) {
    const { code, log } = await starte({ ...env, SESSION_SECRET: secret });
    assert.equal(code, 1, log.slice(-400));
    assert.match(log, reason);
  }
});

test('without APP_BASE_URL in production: startup refused, only explicitly allowed', { timeout: 60_000 }, async () => {
  const db = { DATABASE_URL: 'postgres://u:eigenes@127.0.0.1:1/x' };
  const ohne = await starte(db);
  assert.equal(ohne.code, 1, ohne.log.slice(-400));
  assert.match(ohne.log, /APP_BASE_URL fehlt im Betrieb: .*Start verweigert/);
  assert.doesNotMatch(ohne.log, /Database initialisation failed/, 'the ban comes before the database');
  // With the exception it starts up to the database, reported loudly.
  const erlaubt = await starte({ ...db, APP_BASE_URL_MISSING_OK: '1' });
  assert.match(
    erlaubt.log,
    /❌ \[start\] APP_BASE_URL fehlt im Betrieb \(APP_BASE_URL_MISSING_OK=1\): Der Host-Filter/,
  );
  assert.match(erlaubt.log, /Database initialisation failed/);
  for (const env of [{ APP_BASE_URL: 'https://lego.example.org' }, { ROLE: 'jobs' }, { NODE_ENV: 'development' }]) {
    const r = await starte({ ...db, ...env });
    assert.doesNotMatch(r.log, /APP_BASE_URL fehlt/, JSON.stringify(env));
    assert.match(r.log, /Database initialisation failed/, JSON.stringify(env));
  }
});

test('npm start sets NODE_ENV=production', () => {
  const start = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.start;
  assert.match(start, /^NODE_ENV=production node dist\/server\.js$/);
});

test('outside production no ban, with an own password none', () => {
  assert.deepEqual(startBans({ NODE_ENV: 'development' }), [], 'outside production no ban');
  const basis = { NODE_ENV: 'production', PGPASSWORD: 'eigenes', APP_BASE_URL: 'https://lego.example.org' };
  assert.deepEqual(startBans({ ...basis, TRUST_PROXY: '172.28.73.10' }), []);
  assert.equal(startBans({ ...basis, TRUST_PROXY: '1' }).length, 1);
});
