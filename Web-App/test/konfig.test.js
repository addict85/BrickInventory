/**
 * The database connection stands in ONE place (src/infra/config.ts). The
 * CSV worker had its own defaults (brickinv instead of brickinventory) and
 * connected outside Docker to a different database.
 *
 * Counter-checks (measured on 27.10.):
 *   A  in jobs/csvImportWorker.ts again `process.env.PGUSER || 'brickinv'`
 *      → red: “nobody else reads the connection variables"
 *   B  in databaseConnection the line for DATABASE_URL removed →
 *      red: “DATABASE_URL takes precedence"
 *   C  in standardPasswordInUse the branch for connectionString set to
 *      `return false` → red: “the example password is recognized"
 *
 * Since 30.10. ONLY src/infra/config.ts reads the environment; an invalid value
 * ends the start with one message per variable. Counter-checks (D–F measured in one
 * run):
 *   D  in src/http/fileUpload.ts again `Number(process.env.UPLOAD_QUOTA_MB)`
 *      → red: “nobody except the configuration reads process.env”
 *   E  in ganzzahl() the bounds check `n < min || n > max` removed → red:
 *      “invalid values: all at once, with names” (PORT=0 got through)
 *   F  the import of startup/checkConfig removed from server.ts → red:
 *      “the server does not start with a wrong value” (stack trace from
 *      src/account/sessionDeadline instead of the message)
 *   G  (30.10.) in loadConfig `veraltet` always empty → red: “invalid values:
 *      all at once, with names” (WEB_WORKERS was no longer named)
 *   H  (11.11.2026) in attestationRoots() the check for developmentEnvironment
 *      deleted → red: “own attestation roots only in development and test”
 *   I  (15.11.2026) in legacyKeyUntil() the comparison with the cutoff date deleted
 *      (every valid date applies) → red in the same test (2099-12-31 got through)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { databaseConnection, standardPasswordInUse, loadConfig, ConfigError, VARIABLES } = _req('src/infra/config.js');
const { ohneKommentare } = require('./helpers/sources');
const { spawnSync } = require('node:child_process');

test('without values the same defaults as compose.yaml', () => {
  assert.deepEqual(databaseConnection({}), {
    host: 'postgres',
    port: 5432,
    user: 'brickinventory',
    password: 'brickinventory_secret',
    database: 'brickinventory',
  });
});

test('the example password is recognized — individually and in DATABASE_URL', () => {
  assert.equal(standardPasswordInUse({}), true);
  assert.equal(standardPasswordInUse({ PGPASSWORD: 'eigenes' }), false);
  assert.equal(standardPasswordInUse({ DATABASE_URL: 'postgres://brickinventory:brickinventory_secret@db/x' }), true);
  assert.equal(standardPasswordInUse({ DATABASE_URL: 'postgres://brickinventory:anderes@db/x' }), false);
  assert.equal(standardPasswordInUse({ DATABASE_URL: 'kaputt' }), false);
});

test('DATABASE_URL takes precedence', () => {
  assert.deepEqual(databaseConnection({ DATABASE_URL: 'postgres://a:b@c/d', PGUSER: 'x' }), {
    connectionString: 'postgres://a:b@c/d',
  });
  assert.equal(databaseConnection({ PGPORT: '6543', PGUSER: 'u' }).port, 6543);
});

test('nobody else reads the connection variables', () => {
  const funde = [];
  const durch = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', 'dist', 'test', 'public', '.git'].includes(e.name)) durch(p);
        continue;
      }
      if (!e.name.endsWith('.ts')) continue;
      const rel = path.relative(ROOT, p);
      if (rel === path.join('src/infra/config.ts')) continue;
      const s = fs.readFileSync(p, 'utf8');
      for (const m of s.matchAll(/process\.env\.(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|DATABASE_URL)\b/g))
        funde.push(`${rel}: ${m[1]}`);
    }
  };
  durch(ROOT);
  assert.deepEqual(funde, []);
});

test('nobody except the configuration reads process.env', () => {
  const funde = [];
  const durch = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!['node_modules', 'dist', 'test', 'public', 'scripts', '.git'].includes(e.name)) durch(p);
        continue;
      }
      if (!e.name.endsWith('.ts')) continue;
      const rel = path.relative(ROOT, p);
      if (rel === path.join('src/infra/config.ts')) continue;
      const zeilen = ohneKommentare(fs.readFileSync(p, 'utf8')).split('\n');
      zeilen.forEach((z, i) => {
        if (/process\.env\b/.test(z.replace(/\/\/.*$/, ''))) funde.push(`${rel}:${i + 1}`);
      });
    }
  };
  durch(ROOT);
  assert.deepEqual(funde, []);
});

test('invalid values: all at once, with names', () => {
  assert.throws(
    () =>
      loadConfig({ PORT: '0', SESSION_IDLE_MINUTES: 'viel', COOKIE_SECURE: 'ja', APP_BASE_URL: 'lego.example.org' }),
    (/** @type {any} */ e) => {
      assert.ok(e instanceof ConfigError);
      assert.deepEqual(
        e.error.map(f => f.split('=')[0]),
        ['APP_BASE_URL', 'PORT', 'COOKIE_SECURE', 'SESSION_IDLE_MINUTES'],
      );
      assert.match(e.message, /PORT="0" ist keine ganze Zahl von 1 bis 65535/);
      return true;
    },
  );
  const k = loadConfig({
    PORT: '8080',
    ROLE: 'Jobs',
    WEB_WORKERS: '3',
    COOKIE_SECURE: '0',
    APP_BASE_URL: 'https://lego.example.org//',
  });
  assert.equal(k.port, 8080);
  assert.equal(k.rolle, 'jobs');
  assert.deepEqual(k.veraltet, ['WEB_WORKERS'], 'WEB_WORKERS wirkt nicht mehr, der Start nennt es');
  assert.equal(loadConfig({}).rolle, 'both', 'ohne Angabe ein Prozess für alles');
  assert.throws(() => loadConfig({ ROLE: 'primary' }), /ROLE="primary" ist weder web noch jobs noch both/);
  assert.equal(k.cookieSecure, false);
  assert.equal(k.appBaseUrl, 'https://lego.example.org');
  assert.equal(loadConfig({}).sessionIdleMin, 240, 'ohne Angabe die Vorgabe');
});

test('own attestation roots only in development and test; the cutoff date is a date', () => {
  assert.throws(() => loadConfig({ ATTESTATION_ROOTS: 'PEM' }), /ATTESTATION_ROOTS gilt nur mit NODE_ENV/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', ATTESTATION_ROOTS: 'PEM' }), ConfigError);
  assert.equal(loadConfig({ NODE_ENV: 'test', ATTESTATION_ROOTS: 'PEM' }).attestationRoots, 'PEM');
  assert.equal(loadConfig({}).attestationRoots, null);
  assert.equal(loadConfig({}).deviceKeyLegacyUntil.toISOString(), '2027-02-01T00:00:00.000Z');
  assert.equal(loadConfig({ DEVICE_KEY_OLD_UNTIL: '2026-01-01' }).deviceKeyLegacyUntil.getUTCFullYear(), 2026);
  assert.throws(() => loadConfig({ DEVICE_KEY_OLD_UNTIL: 'bald' }), /DEVICE_KEY_OLD_UNTIL="bald"/);
  assert.equal(loadConfig({ DEVICE_KEY_OLD_UNTIL: '2027-02-01' }).deviceKeyLegacyUntil.getUTCMonth(), 1);
  for (const spaeter of ['2027-02-02', '2099-12-31'])
    assert.throws(() => loadConfig({ DEVICE_KEY_OLD_UNTIL: spaeter }), /liegt nach 2027-02-01/, spaeter);
});

test('the server does not start with a wrong value', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
    env: {
      PATH: process.env.PATH,
      SESSION_IDLE_MINUTES: '-5',
      PORT: 'achtzig',
      DATABASE_URL: 'postgres://niemand@127.0.0.1:1/x',
    },
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /Ungültige Konfiguration:\n {2}- PORT="achtzig"[^\n]*\n {2}- SESSION_IDLE_MINUTES="-5"/);
});

test('.env.example names every variable', () => {
  const beispiel = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  const fehlt = VARIABLES.filter(v => !new RegExp(`^#? ?${v}=`, 'm').test(beispiel));
  assert.deepEqual(fehlt, []);
});
