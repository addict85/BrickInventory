/**
 * The brakes per address count an IPv6 /64 as ONE address: a connection
 * with its own /64 has 2^64 addresses and would otherwise switch the address per attempt.
 * IPv4 in IPv6 (::ffff:a.b.c.d) counts like the IPv4 address itself.
 *
 * Counter-checks (measured 01.11.2026, each on its own):
 *   A  throttleAddress() returns the address unchanged → red: „ipThrottle:
 *      der sechste Versuch aus demselben /64 wird abgewiesen", „Anmeldung:
 *      Spraying aus einem /64 trifft die Grenze je Adresse" and „Schlüssel …"
 *   B  throttleAddress() left out in countRequest → red only „ipThrottle: …"
 *   C  the ::ffff: detection removed → red: „IPv4 in IPv6 zählt wie IPv4"
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const db = testData();
const ipThrottle = (...a) =>
  _req('src/account/http/login.js').ipThrottle(require('./helpers/sources').testServices().account, ...a);
const L = _req('src/account/loginLimiter.js');
const { throttleAddress } = _req('src/infra/throttleAddress.js');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test.after(() => db.pool.end().catch(() => {}));

async function dbDa(t) {
  try {
    await db.initSchema();
    return true;
  } catch (e) {
    noDb(t, e);
    return false;
  }
}

test('ipThrottle: the sixth attempt from the same /64 is rejected', async t => {
  if (!(await dbDa(t))) return;
  const clean = () => db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'v6-probe|%'`);
  await clean();
  t.after(clean);
  const app = express();
  app.set('trust proxy', true); // X-Forwarded-For sets req.ip
  app.post('/probe', ipThrottle('v6-probe', 5, 60 * 60 * 1000), (_req, res) => res.json({ ok: true }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://localhost:${srv.address().port}`;
  const from = ip =>
    fetch(`${basis}/probe`, { method: 'POST', headers: { 'x-forwarded-for': ip } }).then(r => r.status);

  const status = [];
  for (let i = 1; i <= 6; i++) status.push(await from(`2001:db8:aa:bb:${i}::${i}`));
  assert.deepEqual(
    status,
    [200, 200, 200, 200, 200, 429],
    'ipThrottle: the sixth attempt from the same /64 is rejected',
  );
  assert.equal(await from('2001:db8:aa:cc::1'), 200, 'another /64 is not affected');
});

test('login: spraying from a /64 hits the per-address limit', async t => {
  if (!(await dbDa(t))) return;
  const clean = () =>
    db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE '%2001:db8:5:%' OR key LIKE '%v6\\_spray\\_%'`);
  await clean();
  t.after(clean);
  for (let i = 0; i < L.MAX_PER_ADDRESS; i++) {
    const ip = `2001:db8:5:0:${(i + 1).toString(16)}::1`;
    const name = `v6_spray_${i}`;
    assert.equal(await L.loginAllowed(ip, name), null, `attempt ${i + 1} is still allowed`);
    await L.loginFailed(ip, name);
  }
  const lock = await L.loginAllowed('2001:db8:5:0:ffff::9', 'v6_spray_neu');
  assert.ok(lock, 'login: spraying from one /64 hits the per-address limit');
  assert.equal(lock.code, 'too_many_failed_attempts');
});

test('key per address: /64, IPv4 in IPv6, others stay', () => {
  assert.equal(throttleAddress('2001:0db8:0000:0042:1:2:3:4'), '2001:db8:0:42::/64');
  assert.equal(throttleAddress('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(throttleAddress('::1'), '0:0:0:0::/64');
  assert.equal(throttleAddress('::ffff:192.0.2.7'), '192.0.2.7', 'IPv4 in IPv6 counts like IPv4');
  assert.equal(throttleAddress('192.0.2.7'), '192.0.2.7');
  assert.equal(throttleAddress('konto:7'), 'konto:7');
  assert.equal(throttleAddress('?'), '?');
});
