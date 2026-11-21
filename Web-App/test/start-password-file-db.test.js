/**
 * The random initial password of the first admin does not stand in the log but
 * in a file with 0600 in the data directory; the log only names the path. With
 * the first own password change the file disappears.
 *
 * Counter-checks (measured 09.11.2026, each on its own):
 *   A  in putStartAdminAn() (src/account/startAdmin.ts) the password additionally output via
 *      console.log → red: “the log names the path, not the password”
 *   B  in writeStartpasswort() `mode: 0o644` → red: “only the service can read it”
 *   C  in aendereEigenesPasswort() (src/account/accounts.ts) startpasswortDone()
 *      deleted → red: “the first password change deletes the file”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL (the schema is created anew).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
delete process.env.ADMIN_PASSWORD;
const wurzel = fs.mkdtempSync(path.join(os.tmpdir(), 'startpasswort-'));
process.env.APP_ROOT = wurzel;

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();
const { keineDb } = require('./helpers/db');

test('initial password in a file instead of the log', async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  t.after(async () => {
    await db.pool.end().catch(() => {});
    fs.rmSync(wurzel, { recursive: true, force: true });
  });
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  const output = [];
  const echt = { log: console.log, warn: console.warn, schreib: process.stdout.write };
  console.log = console.warn = (...a) => {
    output.push(a.join(' '));
  };
  process.stdout.write = s => {
    output.push(String(s));
    return true;
  };
  try {
    await db.initSchemaOnce();
  } finally {
    console.log = echt.log;
    console.warn = echt.warn;
    process.stdout.write = echt.schreib;
  }

  const datei = path.join(wurzel, 'data', 'admin-startpasswort.txt');
  const [name, passwort] = fs.readFileSync(datei, 'utf8').split('\n');
  const admin = await db.get("SELECT id, password_hash, must_change_password FROM users WHERE username = 'admin'");

  await t.test("the file carries the account's password", async () => {
    assert.equal(name, 'admin');
    assert.ok(await _req('src/account/passwordHash.js').passwordFits(passwort, admin.password_hash));
    assert.equal(admin.must_change_password, true);
  });
  await t.test('only the service can read it', () => {
    assert.equal(fs.statSync(datei).mode & 0o777, 0o600);
  });
  await t.test('the log names the path, not the password', () => {
    const log = output.join('\n');
    assert.ok(log.includes(datei), log);
    assert.ok(!log.includes(passwort), 'Passwort im Log');
  });
  await t.test('the first password change deletes the file', async () => {
    await _req('src/account/accounts.js').aendereEigenesPasswort(admin.id, 'ein-neues-langes-Passwort-42');
    assert.equal(fs.existsSync(datei), false);
  });
});
