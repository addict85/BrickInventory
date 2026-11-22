/**
 * scripts/setup-secrets.sh creates the files that compose.yaml mounts as
 * Docker secrets: newly generated, taken over from an old .env, never
 * overwritten, and not at all without the password of an existing database.
 * The script really runs (sh in a sandbox).
 *
 * Counter-checks (measured 03.11.2026, each on its own):
 *   A  `chmod 700 "$ORDNER"` deleted → red: “a second run …” (an
 *      existing folder with 755 stays open)
 *   B  the check for ./pgdata18 without DB_PASSWORD deleted → red: “an
 *      existing database without DB_PASSWORD …” (new password generated)
 *   C  in richte_ein the query `[ -s "$ORDNER/$1" ]` deleted → red: “a
 *      second run …” (session_secret newly generated)
 *   D  compose.yaml: file ./geheimnisse/pgweb_passwort instead of …_password → red: “compose.yaml
 *      mounts exactly these files”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'setup-secrets.sh');
const NAMEN = [
  'db_app_password',
  'db_migration_password',
  'db_password',
  'db_system_password',
  'db_system_web_password',
  'pgweb_db_password',
  'session_secret',
];

function sandbox(t) {
  const location = fs.mkdtempSync(path.join(os.tmpdir(), 'geheimnisse-'));
  t.after(() => fs.rmSync(location, { recursive: true, force: true }));
  const lauf = (mehr = {}) =>
    spawnSync('sh', ['-c', 'umask 022; exec sh "$0"', SCRIPT], {
      cwd: location,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...mehr },
    });
  const lies = n => fs.readFileSync(path.join(location, 'geheimnisse', n), 'utf8');
  return { location, lauf, lies };
}

test('a new installation gets random secrets, only reachable by the owner', t => {
  const s = sandbox(t);
  const r = s.lauf();
  assert.equal(r.status, 0, r.stderr);
  const ordner = path.join(s.location, 'geheimnisse');
  assert.deepEqual(fs.readdirSync(ordner).sort(), NAMEN);
  assert.equal(fs.statSync(ordner).mode & 0o777, 0o700, 'the folder is open to others');
  for (const n of NAMEN) assert.equal(fs.statSync(path.join(ordner, n)).mode & 0o777, 0o444, `${n}: Modus`);
  assert.match(s.lies('session_secret'), /^[0-9a-f]{96}$/);
  assert.match(s.lies('db_password'), /^[0-9a-f]{48}$/);
  assert.match(s.lies('db_app_password'), /^[0-9a-f]{48}$/);
  assert.notEqual(s.lies('db_password'), s.lies('db_app_password'));
  assert.match(s.lies('db_migration_password'), /^[0-9a-f]{48}$/);
  // Empty means: the reader role does not log in.
  assert.equal(s.lies('pgweb_db_password'), '');
});

test('an existing installation takes over the values from .env', t => {
  const s = sandbox(t);
  fs.mkdirSync(path.join(s.location, 'pgdata18'));
  fs.writeFileSync(
    path.join(s.location, '.env'),
    [
      'BRICK_HOST=nas.example.lan',
      'SESSION_SECRET="alt-sitzung-mindestens-zweiunddreissig-zeichen"',
      'DB_PASSWORD=su+/=pw',
      "DB_APP_PASSWORD='app pw'",
      'PGWEB_PASSWORD=browser',
      '',
    ].join('\n'),
  );
  const r = s.lauf({ PGWEB: 'ja' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.lies('session_secret'), 'alt-sitzung-mindestens-zweiunddreissig-zeichen');
  assert.equal(s.lies('db_password'), 'su+/=pw');
  assert.equal(s.lies('db_app_password'), 'app pw');
  // The migration role was added later; db-rolle sets its password, so a new one fits.
  assert.match(s.lies('db_migration_password'), /^[0-9a-f]{48}$/);
  assert.match(s.lies('db_system_password'), /^[0-9a-f]{48}$/);
  assert.match(s.lies('db_system_web_password'), /^[0-9a-f]{48}$/);
  assert.match(s.lies('pgweb_db_password'), /^[0-9a-f]{48}$/);
  assert.match(r.stderr, /aus \.env löschen.*SESSION_SECRET DB_PASSWORD DB_APP_PASSWORD PGWEB_PASSWORD/);
});

test('an existing database without DB_PASSWORD does not get a new one', t => {
  const s = sandbox(t);
  fs.mkdirSync(path.join(s.location, 'pgdata18'));
  const r = s.lauf();
  assert.notEqual(r.status, 0, 'a new superuser password did not match the database');
  assert.match(r.stderr, /DB_PASSWORD/);
  assert.equal(fs.existsSync(path.join(s.location, 'geheimnisse', 'db_password')), false);
});

test('a second run changes nothing, PGWEB=ja only fills the empty ones', t => {
  const s = sandbox(t);
  assert.equal(s.lauf().status, 0);
  const vorher = Object.fromEntries(NAMEN.map(n => [n, s.lies(n)]));
  fs.chmodSync(path.join(s.location, 'geheimnisse'), 0o755);
  const r = s.lauf({ PGWEB: 'ja' });
  assert.equal(r.status, 0, r.stderr);
  for (const n of NAMEN.filter(n => n !== 'pgweb_db_password'))
    assert.equal(s.lies(n), vorher[n], `${n} newly generated`);
  assert.match(s.lies('pgweb_db_password'), /^[0-9a-f]{48}$/);
  assert.equal(fs.statSync(path.join(s.location, 'geheimnisse')).mode & 0o777, 0o700, 'an open folder stays open');
  const pw = s.lies('pgweb_db_password');
  assert.equal(s.lauf({ PGWEB: 'ja' }).status, 0);
  assert.equal(s.lies('pgweb_db_password'), pw);
});

test('compose.yaml mounts exactly these files', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  const teil = compose.slice(compose.search(/^secrets:/m));
  const dateien = [...teil.matchAll(/^\s+file:\s*\.\/geheimnisse\/(\S+)\s*$/gm)].map(m => m[1]).sort();
  assert.deepEqual(dateien, NAMEN);
});
