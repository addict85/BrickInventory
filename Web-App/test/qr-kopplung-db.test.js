/**
 * QR-Anmeldung mit Bestätigung im Browser: Der Scan allein gibt keinen Token.
 * Die App meldet sich und zeigt einen Code; erst wenn die angemeldete Sitzung
 * ihn eintippt, holt die App ihren Zugang ab. Ein falscher Code zählt, nach
 * drei ist die Kopplung abgelehnt; die Kopplung eines anderen Kontos ist nicht
 * zu sehen und nicht zu bestätigen.
 *
 * Gegenproben (09.11.2026 gemessen, je einzeln):
 *   A  in holeAb() (src/konto/qrKopplung.ts) auch `wartet` wie `bestaetigt`
 *      behandelt → rot: „ohne Bestätigung kein Token“
 *   B  codePasst() gibt immer true → rot: „ein falscher Code zählt …“
 *   C  desKontos() ohne `AND user_id = $2` → rot: „die Kopplung eines anderen Kontos …“
 *   D  in melde() `used_at IS NULL` gestrichen → rot: „ein Code meldet nur ein Gerät“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'http://localhost';
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test('QR-Kopplung mit Bestätigung', { concurrency: 1, timeout: 60_000 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;
  const NAMEN = [`qrk_${process.pid}`, `qrk2_${process.pid}`];
  const PASS = 'Kopplung-Passwort-1';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  // Die Drosseln zählen je Adresse über Testdateien hinweg (serieller Lauf auf einer Datenbank).
  await db.run(`DELETE FROM rate_limit_attempts WHERE key ~ '^(qr-login|qr-abholen)\\|'`);
  const ids = [];
  for (const n of NAMEN)
    ids.push((await db.get(`INSERT INTO users (username, password_hash, is_active, email_verified)
      VALUES ($1, $2, true, true) RETURNING id`, [n, await bcrypt.hash(PASS, 4)])).id);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
    await db.pool.end().catch(() => {});
  });
  const sitzung = { userId: ids[0], username: NAMEN[0] };
  const { base } = testServer(_req, { sitzung, routen: { '/api/v1/auth': 'routes/auth.js' }, t });
  const ruf = async (methode, pfad, body) => {
    const r = await fetch(`${base}/api/v1/auth${pfad}`, {
      method: methode, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  const neuerCode = async () => {
    const qr = await ruf('POST', '/qr-token', { password: PASS });
    assert.equal(qr.status, 200, JSON.stringify(qr.body));
    return qr.body;
  };
  const melde = async (qr) => {
    const m = await ruf('POST', '/qr-login', { token: qr.token, label: 'Pixel Probe' });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    return m.body;
  };
  const abholen = (m) => ruf('POST', '/qr-login/abholen', { abholung: m.abholung });
  const bestaetige = (qr, code) => ruf('POST', `/qr-kopplung/${qr.kopplung}/bestaetigen`, { code });

  await t.test('ohne Bestätigung kein Token, danach genau einer', async () => {
    const qr = await neuerCode();
    const m = await melde(qr);
    assert.equal(m.token, undefined, 'Der Scan allein gibt keinen Token');
    assert.match(m.code, /^\d{6}$/);
    const vorher = await abholen(m);
    assert.deepEqual([vorher.status, vorher.body.wartet, vorher.body.token], [200, true, undefined]);
    const stand = await ruf('GET', `/qr-kopplung/${qr.kopplung}`);
    assert.deepEqual([stand.body.stand, stand.body.geraet, stand.body.ip_bereich], ['wartet', 'Pixel Probe', '127.0.0.0/24']);
    assert.equal((await bestaetige(qr, m.code)).status, 200);
    const da = await abholen(m);
    assert.equal(da.status, 200, JSON.stringify(da.body));
    assert.equal(da.body.userId, ids[0]);
    assert.equal(da.body.token_info.scope, 'app');
    const zeile = await db.get('SELECT label FROM api_tokens WHERE token = $1', [_req('src/konto/auth.js').hashToken(da.body.token)]);
    assert.equal(zeile.label, 'Pixel Probe');
    assert.equal((await abholen(m)).status, 401, 'Ein zweites Abholen gibt keinen zweiten Token');
  });

  await t.test('ein Code meldet nur ein Gerät', async () => {
    const qr = await neuerCode();
    await melde(qr);
    assert.equal((await ruf('POST', '/qr-login', { token: qr.token })).status, 401);
  });

  await t.test('ein falscher Code zählt, nach drei ist die Kopplung abgelehnt', async () => {
    const qr = await neuerCode();
    const m = await melde(qr);
    const falsch = m.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 2; i++)
      assert.deepEqual([(await bestaetige(qr, falsch)).body.code], ['qr_code_falsch']);
    assert.equal((await bestaetige(qr, falsch)).body.code, 'qr_abgelehnt');
    assert.equal((await bestaetige(qr, m.code)).status, 409, 'Nach der Ablehnung hilft auch der richtige Code nicht');
    const r = await abholen(m);
    assert.deepEqual([r.status, r.body.code], [403, 'qr_abgelehnt']);
  });

  await t.test('Ablehnen im Browser beendet die Kopplung', async () => {
    const qr = await neuerCode();
    const m = await melde(qr);
    assert.equal((await ruf('POST', `/qr-kopplung/${qr.kopplung}/ablehnen`, {})).status, 200);
    assert.equal((await abholen(m)).status, 403);
  });

  await t.test('die Kopplung eines anderen Kontos ist nicht zu sehen und nicht zu bestätigen', async () => {
    const qr = await neuerCode();
    const m = await melde(qr);
    Object.assign(sitzung, { userId: ids[1], username: NAMEN[1] });
    try {
      assert.equal((await ruf('GET', `/qr-kopplung/${qr.kopplung}`)).status, 404);
      assert.equal((await bestaetige(qr, m.code)).status, 404);
    } finally { Object.assign(sitzung, { userId: ids[0], username: NAMEN[0] }); }
    assert.equal((await abholen(m)).body.wartet, true);
  });
});
