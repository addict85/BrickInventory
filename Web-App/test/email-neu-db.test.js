/**
 * Eine neue E-Mail-Adresse gilt erst nach dem Link an sie (Sicherheitsprüfung
 * Runde 12, N1). Bis dahin bleibt die alte, und die neue belegt nichts: Ihr
 * Inhaber kann sich mit ihr registrieren, und Passwort-vergessen findet über
 * eine unbestätigte Adresse kein Konto. Seit Runde 13 (N1) legt auch eine …
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  PUT /profile schreibt die Adresse wieder sofort nach users.email → rot:
 *      „eine neue Adresse gilt erst nach dem Link“
 *   B  registerAccount() schreibt die Adresse wieder nach users.email → rot:
 *      „die ausstehende Adresse belegt nichts“ und „beim Einlösen …“
 *   C  activeAccountAfterEmail() ohne `AND email_verified` → rot: „Passwort
 *      vergessen nur für bestätigte Adressen“
 *   D  assertLoginAllowed() ohne die Bedingung `registration_pending` → rot: „eine
 *      fremde Registrierung sperrt die Adresse nicht“ (mallory meldet sich an)
 *   E  adoptEmailNew() ohne OHNE_RUECKSETZLINK → rot: „eingelöst gilt die
 *      neue Adresse“ (der Rücksetzlink an die alte Adresse gilt weiter)
 *   F  in 0096 die Bedingung `NOT registration_pending` gestrichen → rot:
 *      „Migration 0096 …“; in 0097 `email = NULL` gestrichen → rot: „Migrationen
 *      0096 und 0097 …“ (auf frischer DB gemessen, sonst greift die Prüfsumme)
 *   G  reportPendingAddresses() ohne Abfrage (leere Liste) → rot: dieselbe Prüfung
 *   H  renewEmailTokenIfFree() ohne `HAVING COUNT(*) = 1` → rot: „ein neuer
 *      Link nur für die einzige offene Registrierung“
 *   I  die Vorschau nennt auch new_email (Name und Adresse) → rot: „die
 *      Vorschau nennt nur den Benutzernamen“
 *   K  die Vorschau ruft verifyEmailToken() → rot: „… löst nicht ein“
 *   L  POST /register übergibt `mehrere` nicht → rot: „bei mehreren offenen
 *      Registrierungen trägt die Mail den Hinweis“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';
process.env.APP_BASE_URL = 'http://localhost';

const ROOT = path.join(__dirname, '..');
const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { keineDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { enterMailServer } = require('./helpers/mail-attrappe');

const post = [];
require('./helpers/sources').replaceServices('mail', {
  mailVerification: async (an, token, _b, _l, art, mehrere) => {
    post.push({ an, art: art ?? 'registrierung', token, mehrere: !!mehrere });
    return { success: true, mode: 'smtp' };
  },
  mailEmailChanged: async (an, _n, neu) => {
    post.push({ an, art: 'hinweis', neu });
    return { success: true };
  },
  mailRegistrationAttempt: async an => {
    post.push({ an, art: 'versuch' });
    return { success: true, mode: 'smtp' };
  },
  mailPasswordReset: async an => {
    post.push({ an, art: 'reset' });
    return { success: true };
  },
});

const db = S.testData();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const P = `en${process.pid}`,
  PASS = 'Passwort-Carol-2026';
const adr = n => `${n}_${P}@example.org`;
const COUNTER = [
  'register|%',
  'register-ziel|%',
  'forgot%',
  'profil-vergabe%',
  'email-bestaetigen|%',
  '%-bestaetigen|%',
  'login%',
  'bestaetigung%',
  'email-vorschau|%',
];

test('neue E-Mail-Adresse erst nach Bestätigung', { concurrency: 1 }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const clean = async () => {
    await db.run('DELETE FROM users WHERE username LIKE $1', [`%_${P}`]);
    for (const k of COUNTER) await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [k]);
  };
  await clean();
  const regBefore = (await db.get("SELECT value FROM global_settings WHERE key = 'registration_enabled'"))?.value;
  await db.run(`INSERT INTO global_settings (key, value) VALUES ('registration_enabled', '1')
                ON CONFLICT (key) DO UPDATE SET value = '1'`);
  const mailBack = await enterMailServer(db);
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`,
      [`carol_${P}`, adr('alt'), bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await clean();
    if (regBefore === undefined) await db.run("DELETE FROM global_settings WHERE key = 'registration_enabled'");
    else await db.run("UPDATE global_settings SET value = $1 WHERE key = 'registration_enabled'", [regBefore]);
    await mailBack();
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid, username: `carol_${P}` }, t });
  const ruf = async (methode, weg, body) => {
    const r = await fetch(`${base}/api/v1/auth${weg}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const carol = () => db.get('SELECT email, email_verified, new_email, reset_token FROM users WHERE id = $1', [uid]);
  const konto = name => db.get('SELECT id, email, new_email FROM users WHERE username = $1', [`${name}_${P}`]);
  const register = (name, email) =>
    ruf('POST', '/register', { username: `${name}_${P}`, email, password: 'Opfer-Passwort-2026!' });
  const linkAn = (an, art = 'adresse') => post.filter(m => m.an === an && m.art === art).at(-1)?.token;
  const anmelden = name =>
    ruf('POST', '/login', { username: `${name}_${P}`, password: 'Opfer-Passwort-2026!', ohne_token: true });

  await t.test('eine neue Adresse gilt erst nach dem Link', async () => {
    const r = await ruf('PUT', '/profile', { username: `carol_${P}`, email: adr('opfer'), password_current: PASS });
    assert.deepEqual([r.status, r.body.emailChanged, r.body.emailSent], [200, true, true], JSON.stringify(r.body));
    assert.deepEqual(await carol(), {
      email: adr('alt'),
      email_verified: true,
      new_email: adr('opfer'),
      reset_token: null,
    });
    assert.ok(linkAn(adr('opfer')), 'der Link geht an die neue Adresse');
    assert.deepEqual(
      post.filter(m => m.art === 'hinweis'),
      [{ an: adr('alt'), art: 'hinweis', neu: adr('opfer') }],
    );
    const profil = await ruf('GET', '/profile');
    assert.deepEqual([profil.body.user.email, profil.body.user.new_email], [adr('alt'), adr('opfer')]);
  });

  await t.test('die ausstehende Adresse belegt nichts', async () => {
    const r = await register('opfer', adr('opfer'));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(
      await konto('opfer'),
      { id: (await konto('opfer')).id, email: null, new_email: adr('opfer') },
      'der Inhaber bekommt ein Konto, die Adresse bis zum Link nur ausstehend',
    );
    assert.equal((await carol()).email, adr('alt'));
  });

  await t.test('Passwort vergessen nur für bestätigte Adressen', async () => {
    for (const email of [adr('opfer'), adr('alt')])
      assert.equal((await ruf('POST', '/forgot-password', { email })).status, 200);
    const opfer = await db.get('SELECT reset_token FROM users WHERE username = $1', [`opfer_${P}`]);
    assert.equal(opfer.reset_token, null, 'Rücksetzlink über eine unbestätigte Adresse');
    // Gegenstück: Über die bestätigte Adresse entsteht einer, sonst prüfte der Fall nichts.
    assert.notEqual((await carol()).reset_token, null);
  });

  await t.test('beim Einlösen wird erneut geprüft', async () => {
    const opfer = await ruf('POST', '/email-bestaetigen', { token: linkAn(adr('opfer'), 'registrierung') });
    assert.equal(opfer.status, 200, 'die erste Bestätigung gewinnt');
    assert.equal((await konto('opfer')).email, adr('opfer'));
    const r = await ruf('POST', '/email-bestaetigen', { token: linkAn(adr('opfer')) });
    assert.deepEqual([r.status, r.body.code], [400, 'email_vergeben'], JSON.stringify(r.body));
    const c = await carol();
    assert.deepEqual([c.email, c.new_email], [adr('alt'), null]);
  });

  await t.test('eingelöst gilt die neue Adresse', async () => {
    assert.equal((await ruf('PUT', '/profile', { email: adr('neu'), password_current: PASS })).status, 200);
    const token = linkAn(adr('neu'));
    assert.equal((await ruf('POST', '/email-bestaetigen', { token })).status, 200);
    assert.deepEqual(await carol(), { email: adr('neu'), email_verified: true, new_email: null, reset_token: null });
    const nochmal = await ruf('POST', '/email-bestaetigen', { token });
    assert.deepEqual([nochmal.status, nochmal.body.code], [400, 'bestaetigungslink_ungueltig']);
  });

  const unlinkBrakes = () => db.run("DELETE FROM rate_limit_attempts WHERE key LIKE 'register%' OR key LIKE 'login%'");
  await t.test('eine fremde Registrierung sperrt die Adresse nicht', async () => {
    await unlinkBrakes();
    assert.equal((await register('mallory1', adr('ziel'))).status, 200);
    await db.run("UPDATE users SET created_at = NOW() - INTERVAL '25 hours' WHERE username = $1", [`mallory1_${P}`]);
    assert.equal((await register('mallory2', adr('ziel'))).status, 200);
    assert.equal((await register('ziel', adr('ziel'))).status, 200);
    assert.deepEqual(await konto('ziel'), { id: (await konto('ziel')).id, email: null, new_email: adr('ziel') });
    assert.ok(
      !post.some(m => m.an === adr('ziel') && m.art === 'versuch'),
      'eine unbestätigte Registrierung gilt als Inhaber',
    );
    const login = await anmelden('mallory2');
    assert.deepEqual(
      [login.status, login.body.code],
      [401, 'anmeldedaten_ungueltig'],
      'eine offene Registrierung meldet sich an',
    );
    assert.equal(
      (await ruf('POST', '/email-bestaetigen', { token: linkAn(adr('ziel'), 'registrierung') })).status,
      200,
    );
    assert.equal((await konto('ziel')).email, adr('ziel'));
    assert.equal((await anmelden('ziel')).status, 200);
    await unlinkBrakes();
    const spaeter = await register('mallory3', adr('ziel'));
    assert.equal(spaeter.status, 200);
    assert.equal(await konto('mallory3'), undefined, 'nach der Bestätigung ist die Adresse vergeben');
    assert.equal(post.filter(m => m.an === adr('ziel') && m.art === 'versuch').length, 1);
  });

  await t.test('ein neuer Link nur für die einzige offene Registrierung', async () => {
    await unlinkBrakes();
    const erneut = async email => {
      const vorher = post.length;
      await ruf('POST', '/bestaetigung-erneut', { email });
      return post.slice(vorher);
    };
    assert.equal((await register('allein', adr('allein'))).status, 200);
    await db.run("UPDATE users SET new_email_until = NOW() + INTERVAL '1 hour' WHERE username = $1", [`allein_${P}`]);
    assert.deepEqual(
      (await erneut(adr('allein'))).map(m => [m.an, m.art]),
      [[adr('allein'), 'registrierung']],
    );
    assert.equal((await register('doppel', adr('allein'))).status, 200);
    await db.run("UPDATE users SET new_email_until = NOW() + INTERVAL '1 hour' WHERE username LIKE $1", [`%_${P}`]);
    assert.deepEqual(await erneut(adr('allein')), [], 'bei zwei offenen Registrierungen ginge ein fremder Link mit');
  });

  await t.test('vor dem Einlösen nennt der Link nur sein Konto', async () => {
    await unlinkBrakes();
    assert.equal((await register('mallory4', adr('zwei'))).status, 200);
    assert.equal((await register('zwei', adr('zwei'))).status, 200);
    const [fremd, eigen] = post.filter(m => m.an === adr('zwei'));
    assert.deepEqual(
      [fremd.mehrere, eigen.mehrere],
      [false, true],
      'bei mehreren offenen Registrierungen trägt die Mail den Hinweis',
    );
    const vorschau = token => ruf('POST', '/email-bestaetigen/vorschau', { token });
    const v = await vorschau(fremd.token);
    assert.deepEqual(
      [v.status, v.body],
      [200, { success: true, username: `mallory4_${P}` }],
      'die Vorschau nennt nur den Benutzernamen',
    );
    assert.deepEqual(
      await konto('mallory4'),
      { id: (await konto('mallory4')).id, email: null, new_email: adr('zwei') },
      'die Vorschau löst nicht ein',
    );
    for (const falsch of ['falsch', '', undefined]) {
      const r = await vorschau(falsch);
      assert.deepEqual([r.status, r.body.code, r.body.username], [400, 'bestaetigungslink_ungueltig', undefined]);
    }
    const login = await ruf('POST', '/login', { username: `mallory4_${P}`, password: 'Opfer-Passwort-2026!' });
    assert.deepEqual(
      [login.status, login.body.token],
      [401, undefined],
      'vor der Bestätigung keine Anmeldung, also auch kein zweiter Faktor',
    );
    assert.equal((await ruf('POST', '/email-bestaetigen', { token: eigen.token })).status, 200);
    assert.equal((await vorschau(eigen.token)).status, 400, 'ein eingelöster Link nennt nichts mehr');
  });

  await t.test('Migrationen 0096 und 0097 machen den Altbestand ausstehend, der Start meldet ihn', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db/migrations/0096-email-neu.sql'), 'utf8');
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      const neu = async (name, spalten) =>
        (
          await c.query(
            `INSERT INTO users (username, password_hash, email, email_verified,
        registration_pending, verification_token, token_expires) VALUES ($1, 'x', $2, $3, $4, $5, NOW() + $6::interval) RETURNING id`,
            [`${name}_${P}`, adr(name), ...spalten],
          )
        ).rows[0].id;
      const ids = {
        gueltig: await neu('gueltig', [false, false, 'h1', '2 hours']),
        alt: await neu('altlink', [false, false, 'h2', '-2 hours']),
        offen: await neu('offen', [false, true, 'h3', '2 hours']),
        fest: await neu('fest', [true, false, null, '0 hours']),
      };
      // Migration 0096 ist Geschichte und nennt die Spalten noch unter ihrem
      // alten Namen; 0124 (längst angewandt) hätte sie sonst gleich danach
      // umbenannt, wie bei einer echten Reihenfolge der Migrationen.
      await c.query(`ALTER TABLE users RENAME COLUMN new_email TO email_neu`);
      await c.query(`ALTER TABLE users RENAME COLUMN new_email_token TO email_neu_token`);
      await c.query(`ALTER TABLE users RENAME COLUMN new_email_until TO email_neu_bis`);
      await c.query(`ALTER TABLE users RENAME COLUMN registration_pending TO registrierung_offen`);
      await c.query(sql.slice(sql.indexOf('UPDATE users')));
      await c.query(`ALTER TABLE users RENAME COLUMN email_neu TO new_email`);
      await c.query(`ALTER TABLE users RENAME COLUMN email_neu_token TO new_email_token`);
      await c.query(`ALTER TABLE users RENAME COLUMN email_neu_bis TO new_email_until`);
      await c.query(`ALTER TABLE users RENAME COLUMN registrierung_offen TO registration_pending`);
      const z = Object.fromEntries(
        (
          await c.query(
            `SELECT id, email, new_email, new_email_token, new_email_until IS NOT NULL AS bis,
        verification_token FROM users WHERE id = ANY($1)`,
            [Object.values(ids)],
          )
        ).rows.map(r => [r.id, r]),
      );
      assert.deepEqual(z[ids.gueltig], {
        id: ids.gueltig,
        email: null,
        new_email: adr('gueltig'),
        new_email_token: 'h1',
        bis: true,
        verification_token: null,
      });
      assert.deepEqual(z[ids.alt], {
        id: ids.alt,
        email: null,
        new_email: adr('altlink'),
        new_email_token: null,
        bis: false,
        verification_token: null,
      });
      assert.equal(z[ids.offen].email, adr('offen'), 'eine offene Registrierung behält ihre Adresse');
      assert.equal(z[ids.fest].email, adr('fest'));
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    const c2 = await db.pool.connect();
    try {
      await c2.query('BEGIN');
      const m97 = fs.readFileSync(path.join(ROOT, 'db/migrations/0097-registrierung-ausstehend.sql'), 'utf8');
      const ids = (
        await c2.query(
          `INSERT INTO users (username, password_hash, email, email_verified, registration_pending,
        verification_token, token_expires) VALUES ($1, 'x', $2, false, true, 'h4', NOW() + INTERVAL '2 hours'),
        ($3, 'x', $4, true, false, NULL, NULL) RETURNING id`,
          [`reg_${P}`, adr('reg'), `best_${P}`, adr('best')],
        )
      ).rows.map(r => r.id);
      // Migration 0097 ist Geschichte und nennt die Spalten noch unter ihrem
      // alten Namen; siehe Begründung bei Migration 0096 weiter oben.
      await c2.query(`ALTER TABLE users RENAME COLUMN new_email TO email_neu`);
      await c2.query(`ALTER TABLE users RENAME COLUMN new_email_token TO email_neu_token`);
      await c2.query(`ALTER TABLE users RENAME COLUMN new_email_until TO email_neu_bis`);
      await c2.query(`ALTER TABLE users RENAME COLUMN registration_pending TO registrierung_offen`);
      await c2.query(m97);
      await c2.query(`ALTER TABLE users RENAME COLUMN email_neu TO new_email`);
      await c2.query(`ALTER TABLE users RENAME COLUMN email_neu_token TO new_email_token`);
      await c2.query(`ALTER TABLE users RENAME COLUMN email_neu_bis TO new_email_until`);
      await c2.query(`ALTER TABLE users RENAME COLUMN registrierung_offen TO registration_pending`);
      const z = (
        await c2.query(
          `SELECT email, new_email, new_email_token, new_email_until IS NOT NULL AS bis, verification_token
        FROM users WHERE id = ANY($1) ORDER BY id`,
          [ids],
        )
      ).rows;
      assert.deepEqual(
        z,
        [
          { email: null, new_email: adr('reg'), new_email_token: 'h4', bis: true, verification_token: null },
          { email: adr('best'), new_email: null, new_email_token: null, bis: false, verification_token: null },
        ],
        'Migration 0097 …',
      );
    } finally {
      await c2.query('ROLLBACK');
      c2.release();
    }
    const h5 = (
      await db.get(`INSERT INTO users (username, password_hash, new_email) VALUES ($1, 'x', $2) RETURNING id`, [
        `h5_${P}`,
        adr('h5'),
      ])
    ).id;
    const { reportPendingAddresses } = _req('src/account/accounts.js');
    assert.ok((await reportPendingAddresses()).includes(h5));
    assert.ok(!(await reportPendingAddresses()).includes(uid));
  });
});
