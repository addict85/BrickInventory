/**
 * Die Bremsen je Adresse zählen ein IPv6-/64 als EINE Adresse: Ein Anschluss
 * mit eigenem /64 hat 2^64 Adressen und wechselte sonst je Versuch die Adresse.
 * IPv4 in IPv6 (::ffff:a.b.c.d) zählt wie die IPv4-Adresse selbst.
 *
 * Gegenproben (01.11.2026 gemessen, je einzeln):
 *   A  drosselAdresse() gibt die Adresse unverändert zurück → rot: „ipThrottle:
 *      der sechste Versuch aus demselben /64 wird abgewiesen", „Anmeldung:
 *      Spraying aus einem /64 trifft die Grenze je Adresse" und „Schlüssel …"
 *   B  in zaehleAnfrage drosselAdresse() weggelassen → rot nur „ipThrottle: …"
 *   C  die ::ffff:-Erkennung entfernt → rot: „IPv4 in IPv6 zählt wie IPv4"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testDaten();
const { ipThrottle } = _req('src/konto/http/anmeldung.js');
const L = _req('src/konto/loginLimiter.js');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

test.after(() => db.pool.end().catch(() => {}));

async function dbDa(t) {
  try {
    await db.initSchema();
    return true;
  } catch (e) {
    keineDb(t, e);
    return false;
  }
}

test('ipThrottle: der sechste Versuch aus demselben /64 wird abgewiesen', async t => {
  if (!(await dbDa(t))) return;
  const raeumen = () => db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'v6-probe|%'`);
  await raeumen();
  t.after(raeumen);
  const app = express();
  app.set('trust proxy', true); // X-Forwarded-For setzt req.ip
  app.post('/probe', ipThrottle('v6-probe', 5, 60 * 60 * 1000), (_req, res) => res.json({ ok: true }));
  const srv = app.listen(0);
  t.after(() => new Promise(r => srv.close(r)));
  const basis = `http://localhost:${srv.address().port}`;
  const von = ip => fetch(`${basis}/probe`, { method: 'POST', headers: { 'x-forwarded-for': ip } }).then(r => r.status);

  const status = [];
  for (let i = 1; i <= 6; i++) status.push(await von(`2001:db8:aa:bb:${i}::${i}`));
  assert.deepEqual(
    status,
    [200, 200, 200, 200, 200, 429],
    'ipThrottle: der sechste Versuch aus demselben /64 wird abgewiesen',
  );
  assert.equal(await von('2001:db8:aa:cc::1'), 200, 'ein anderes /64 ist nicht betroffen');
});

test('Anmeldung: Spraying aus einem /64 trifft die Grenze je Adresse', async t => {
  if (!(await dbDa(t))) return;
  const raeumen = () =>
    db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE '%2001:db8:5:%' OR key LIKE '%v6\\_spray\\_%'`);
  await raeumen();
  t.after(raeumen);
  for (let i = 0; i < L.MAX_JE_ADRESSE; i++) {
    const ip = `2001:db8:5:0:${(i + 1).toString(16)}::1`;
    const name = `v6_spray_${i}`;
    assert.equal(await L.checkLoginAllowed(ip, name), null, `Versuch ${i + 1} darf noch`);
    await L.recordLoginFailure(ip, name);
  }
  const sperre = await L.checkLoginAllowed('2001:db8:5:0:ffff::9', 'v6_spray_neu');
  assert.ok(sperre, 'Anmeldung: Spraying aus einem /64 trifft die Grenze je Adresse');
  assert.equal(sperre.code, 'zu_viele_fehlversuche');
});

test('Schlüssel je Adresse: /64, IPv4 in IPv6, anderes bleibt', () => {
  assert.equal(L.drosselAdresse('2001:0db8:0000:0042:1:2:3:4'), '2001:db8:0:42::/64');
  assert.equal(L.drosselAdresse('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(L.drosselAdresse('::1'), '0:0:0:0::/64');
  assert.equal(L.drosselAdresse('::ffff:192.0.2.7'), '192.0.2.7', 'IPv4 in IPv6 zählt wie IPv4');
  assert.equal(L.drosselAdresse('192.0.2.7'), '192.0.2.7');
  assert.equal(L.drosselAdresse('konto:7'), 'konto:7');
  assert.equal(L.drosselAdresse('?'), '?');
});
