/**
 * New accesses and removed protection go out by mail: a new
 * app token and a QR access to the owner, a new administrator and a
 * removed second factor to all administrators (the removed factor also to
 * the affected account).
 *
 * Counter-checks (measured 03.11.2026, each alone):
 *   A  hintInBackground() removed in /token-create → red: “new token"
 *   B  hintInBackground() removed in /qr-token → red: “new QR access"
 *   C  adminHintInBackground() removed in PUT /users/:id/admin → red:
 *      “appointed administrator"
 *   D  in activeAdmin() `is_admin AND` removed → red: “new
 *      administrator account" (the mail also went to the ordinary account)
 *   E  hintInBackground() removed in PUT /users/:id/password → red:
 *      “foreign password by an administrator”
 * Counter-check (measured 04.11.2026):
 *   F  hintInBackground() removed in signedInResponses() (routes/auth.ts) →
 *      red: “token from login (new device)”
 *   G  hintInBackground() removed in /zweiter-faktor/bestaetigen or /abschalten
 *      → red: “own second factor set up and switched off”
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
process.env.APP_BASE_URL = 'https://lego.test';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { routerServer } = require('./helpers/server');

const gesendet = [];
require('./helpers/sources').replaceServices('mail', {
  mailConfigured: async () => true,
  mailAccountNotice: async (an, _name, type, o) => {
    gesendet.push({ an, type, ...o });
    return { success: true };
  },
});

const db = S.testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Hinweis-Passwort-1';

test('mails on new accesses', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const P = process.pid,
    NAMEN = [`zh_chef_${P}`, `zh_zwei_${P}`, `zh_nutzer_${P}`, `zh_neu_${P}`];
  const konto = async (name, admin) =>
    (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
        [name, `${name}@example.org`, await bcrypt.hash(PASS, 4), admin],
      )
    ).id;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]);
  const chef = await konto(NAMEN[0], true),
    zwei = await konto(NAMEN[1], true),
    nutzer = await konto(NAMEN[2], false);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE username = ANY($1)', [NAMEN]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const base = routerServer(_req, {
    sitzung: { userId: chef, username: NAMEN[0], isAdmin: true },
    routen: { '/api/v2/auth': 'routes/auth.js' },
    t,
  }).base;
  const ruf = async (methode, weg, body) => {
    const r = await fetch(`${base}/api/v2/auth${weg}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    assert.equal(r.status, 200, `${weg}: ${text}`);
    return JSON.parse(text);
  };
  /** The mails go out on the side; wait briefly until they arrive. */
  const mails = async (type, count) => {
    for (let i = 0; i < 60 && gesendet.filter(m => m.type === type).length < count; i++)
      await new Promise(r => setTimeout(r, 25));
    return gesendet
      .filter(m => m.type === type && NAMEN.some(n => m.an === `${n}@example.org`))
      .map(m => ({ an: m.an.split('@')[0], konto: m.konto, durch: m.durch, name: m.passkey }))
      .sort((a, b) => a.an.localeCompare(b.an));
  };

  await t.test('new token', async () => {
    await ruf('POST', '/token-create', { password: PASS, label: 'Tablet' });
    assert.deepEqual(await mails('token_neu', 1), [
      { an: NAMEN[0], konto: undefined, durch: undefined, name: 'Tablet' },
    ]);
  });

  await t.test('new QR access', async () => {
    await ruf('POST', '/qr-token', { password: PASS });
    assert.deepEqual(
      (await mails('qr_zugang_neu', 1)).map(m => m.an),
      [NAMEN[0]],
    );
  });

  await t.test('new admin account', async () => {
    await ruf('POST', '/users', {
      username: NAMEN[3],
      password: 'Lang-genug-Passwort-1',
      is_admin: true,
      admin_password: PASS,
    });
    assert.deepEqual(await mails('verwalter_ernannt', 2), [
      { an: NAMEN[0], konto: NAMEN[3], durch: NAMEN[0], name: undefined },
      { an: NAMEN[1], konto: NAMEN[3], durch: NAMEN[0], name: undefined },
    ]);
  });

  await t.test('appointed admin', async () => {
    gesendet.length = 0;
    await ruf('PUT', `/users/${nutzer}/admin`, { is_admin: true, admin_password: PASS });
    assert.deepEqual(
      (await mails('verwalter_ernannt', 3)).map(m => [m.an, m.konto]),
      [
        [NAMEN[0], NAMEN[2]],
        [NAMEN[2], NAMEN[2]],
        [NAMEN[1], NAMEN[2]],
      ],
    );
  });

  // `zwei` is an administrator: the change is announced and only applies in the cleanup run after the period.
  const faellig = async () => {
    await db.run(`UPDATE admin_takeovers SET effective_at = NOW() - INTERVAL '1 minute' WHERE target_id = $1`, [zwei]);
    assert.equal(await _req('src/account/adminActions.js').runDueTakeoversFrom(), 1);
  };

  await t.test('removed second factor', async () => {
    await db.run(`INSERT INTO second_factor (user_id, secret, active) VALUES ($1, 'x', true)`, [zwei]);
    await ruf('DELETE', `/users/${zwei}/second-factor`, { admin_password: PASS });
    assert.deepEqual(
      (await mails('uebernahme_angekuendigt', 1)).map(m => [m.an, m.durch]),
      [[NAMEN[1], NAMEN[0]]],
    );
    await faellig();
    assert.deepEqual(
      (await mails('zweiter_faktor_entfernt', 1)).map(m => [m.an, m.durch]),
      [[NAMEN[1], NAMEN[0]]],
    );
    assert.deepEqual(
      (await mails('verwaltung_faktor_entfernt', 3)).map(m => [m.an, m.konto]),
      [
        [NAMEN[0], NAMEN[1]],
        [NAMEN[2], NAMEN[1]],
        [NAMEN[1], NAMEN[1]],
      ],
    );
  });

  await t.test('password set by an admin', async () => {
    await ruf('PUT', `/users/${zwei}/password`, { password: 'Neues-Langes-Passwort-9', admin_password: PASS });
    await faellig();
    assert.deepEqual(
      (await mails('passwort_durch_verwalter', 1)).map(m => [m.an, m.durch]),
      [[NAMEN[1], NAMEN[0]]],
    );
    assert.deepEqual(
      (await mails('verwaltung_passwort_gesetzt', 3)).map(m => [m.an, m.konto]),
      [
        [NAMEN[0], NAMEN[1]],
        [NAMEN[2], NAMEN[1]],
        [NAMEN[1], NAMEN[1]],
      ],
    );
  });

  await t.test('token from login (new device)', async () => {
    gesendet.length = 0;
    await ruf('POST', '/login', { username: NAMEN[2], password: PASS, label: 'Handy' });
    assert.deepEqual(await mails('token_neu', 1), [
      { an: NAMEN[2], konto: undefined, durch: undefined, name: 'Handy' },
    ]);
  });

  await t.test('own second factor set up and switched off', async () => {
    const zf = _req('src/factors/secondFactor.js');
    const { secret } = await ruf('POST', '/second-factor/setup', { password: PASS });
    const code = versatz => zf.hotp(zf.fromBase32(secret), zf.timeStep() + versatz);
    await ruf('POST', '/second-factor/confirm', { code: code(0) });
    assert.deepEqual(
      (await mails('zweiter_faktor_eingerichtet', 1)).map(m => m.an),
      [NAMEN[0]],
    );
    await ruf('POST', '/second-factor/disable', { password: PASS, code: code(1) });
    assert.deepEqual(
      (await mails('zweiter_faktor_abgeschaltet', 1)).map(m => m.an),
      [NAMEN[0]],
    );
  });
});
