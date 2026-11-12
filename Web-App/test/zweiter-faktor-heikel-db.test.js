/**
 * Bei aktivem zweitem Faktor verlangen Passwortwechsel, Passkey löschen und
 * E-Mail ändern zusätzlich einen Code (bestaetigeMitFaktor in
 * src/konto/http/anmeldung.ts). Ein fehlender Code wird abgewiesen, bevor
 * etwas geprüft wird; ein falscher zählt in der Bremse. Ohne zweiten Faktor …
 *
 * Gegenproben (01.11.2026 gemessen, je einzeln):
 *   A  change-password wieder mit bestaetigePasswort ohne Code → rot:
 *      „Passwortwechsel ohne Code" (die Folgeteile mit, das Passwort ist neu)
 *   B  DELETE /passkeys/:id ohne Code → rot: „Passkey löschen ohne Code"
 *   C  PUT /profile (E-Mail) ohne Code → rot: „E-Mail ändern"
 *   D  in bestaetigeMitFaktor die Absage für fehlenden Code entfernt (der
 *      Code geht leer in die Prüfung) → rot: die drei „ohne Code" und
 *      „fehlender Code zählt nicht in der Bremse" (429 statt 200)
 *   E  `felder.email_verified = user.is_admin` zurück → rot: „Verwalter-
 *      Adresse gilt erst nach dem Link" (seit 04.11.2026 über email_neu,
 *      Gegenproben dazu in email-neu-db)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

// Keine echten Mails: vor dem Laden von routes/auth ersetzen.
const echterMailer = _req('src/mail/mailer.js');
const mailerPfad = require.resolve(path.join(S.DIST, 'src/mail/mailer.js'));
require.cache[mailerPfad].exports = Object.assign({}, echterMailer, {
  sendEmailGeaendertMail: async () => ({ success: true }),
  sendVerificationMail: async () => ({ success: true }),
});

const db = _req('db/database.js');
const zf = _req('src/konto/zweiterFaktor.js');
const { entschluessele } = _req('src/infra/geheimnis.js');
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const PASS = 'Faktor-Passwort-1';

async function konto(name, { admin = false } = {}) {
  await db.run('DELETE FROM users WHERE username = $1', [name]);
  return (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, $3, $4, true, true) RETURNING id`,
      [name, `${name}@alt.example`, await bcrypt.hash(PASS, 4), admin],
    )
  ).id;
}

/** Zweiten Faktor einschalten; liefert die Wiederherstellungscodes. */
async function mitFaktor(uid) {
  await zf.beginneEinrichtung(uid);
  const z = await db.get('SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1', [uid]);
  const code = zf.hotp(zf.ausBase32(entschluessele(z.geheimnis, zf.faktorKontext(uid))), zf.zeitschritt());
  const codes = await zf.bestaetigeEinrichtung(uid, code);
  assert.ok(Array.isArray(codes) && codes.length >= 3, 'Vorbedingung: Faktor aktiv');
  return codes;
}

test('heikle Kontoänderungen mit zweitem Faktor', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;

  const NAME = `zfh_${process.pid}`,
    OHNE = `zfh_ohne_${process.pid}`,
    CHEF = `zfh_chef_${process.pid}`;
  const uid = await konto(NAME),
    ohne = await konto(OHNE),
    chef = await konto(CHEF, { admin: true });
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, ohne, chef]]).catch(() => {});
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'bestaetigung|%'`).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const codes = await mitFaktor(uid);

  const server = (id, name, admin = false) =>
    testServer(_req, {
      sitzung: { userId: id, username: name, isAdmin: admin },
      routen: { '/api/v1/auth': 'routes/auth.js' },
      t,
    }).base;
  const basis = server(uid, NAME);
  const ruf = async (b, methode, weg, body) => {
    const r = await fetch(`${b}/api/v1/auth${weg}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  await t.test('Passwortwechsel', async () => {
    const ohneCode = await ruf(basis, 'POST', '/change-password', { current: PASS, newPassword: 'Neues-Passwort-22' });
    assert.equal(ohneCode.body.code, 'zweiter_faktor_noetig', 'Passwortwechsel ohne Code');
    assert.equal(ohneCode.status, 400);
    const falsch = await ruf(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-22',
      code: '000000',
    });
    assert.equal(falsch.body.code, 'zweiter_faktor_falsch');
    const gut = await ruf(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-22',
      code: codes[0],
    });
    assert.equal(gut.status, 200, JSON.stringify(gut.body));
    // Zurück, damit die folgenden Teile dasselbe Passwort nehmen.
    await db.run('UPDATE users SET password_hash = $2 WHERE id = $1', [uid, await bcrypt.hash(PASS, 4)]);
  });

  await t.test('Passkey löschen', async () => {
    const pk = (
      await db.get(
        `INSERT INTO passkeys (user_id, credential_id, public_key, name)
      VALUES ($1, $2, '\\x00', 'Probe') RETURNING id`,
        [uid, `zfh-${process.pid}`],
      )
    ).id;
    const ohneCode = await ruf(basis, 'DELETE', `/passkeys/${pk}`, { password: PASS });
    assert.equal(ohneCode.body.code, 'zweiter_faktor_noetig', 'Passkey löschen ohne Code');
    assert.ok(await db.get('SELECT 1 FROM passkeys WHERE id = $1', [pk]), 'der Passkey steht noch');
    const gut = await ruf(basis, 'DELETE', `/passkeys/${pk}`, { password: PASS, code: codes[1] });
    assert.equal(gut.body.deleted, 1, JSON.stringify(gut.body));
  });

  await t.test('E-Mail ändern', async () => {
    const ohneCode = await ruf(basis, 'PUT', '/profile', {
      username: NAME,
      email: `${NAME}@neu.example`,
      password_current: PASS,
    });
    assert.equal(ohneCode.body.code, 'zweiter_faktor_noetig', 'E-Mail ändern ohne Code');
    assert.equal((await db.get('SELECT email FROM users WHERE id = $1', [uid])).email, `${NAME}@alt.example`);
    const gut = await ruf(basis, 'PUT', '/profile', {
      username: NAME,
      email: `${NAME}@neu.example`,
      password_current: PASS,
      code: codes[2],
    });
    assert.equal(gut.status, 200, JSON.stringify(gut.body));
    assert.equal((await db.get('SELECT email_neu FROM users WHERE id = $1', [uid])).email_neu, `${NAME}@neu.example`);
  });

  await t.test('fehlender Code zählt nicht in der Bremse', async () => {
    for (let i = 0; i < 7; i++)
      assert.equal(
        (await ruf(basis, 'POST', '/change-password', { current: PASS, newPassword: 'Neues-Passwort-33' })).status,
        400,
      );
    const gut = await ruf(basis, 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-33',
      code: codes[3],
    });
    assert.equal(gut.status, 200, `fehlender Code zählt nicht in der Bremse: ${JSON.stringify(gut.body)}`);
  });

  await t.test('ohne zweiten Faktor wie bisher', async () => {
    const r = await ruf(server(ohne, OHNE), 'POST', '/change-password', {
      current: PASS,
      newPassword: 'Neues-Passwort-44',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await t.test('Verwalter-Adresse gilt erst nach dem Link', async () => {
    const r = await ruf(server(chef, CHEF, true), 'PUT', '/profile', {
      username: CHEF,
      email: `${CHEF}@neu.example`,
      password_current: PASS,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const z = await db.get('SELECT email, email_neu FROM users WHERE id = $1', [chef]);
    assert.deepEqual(
      [z.email, z.email_neu],
      [`${CHEF}@alt.example`, `${CHEF}@neu.example`],
      'Verwalter-Adresse gilt erst nach dem Link',
    );
  });
});
