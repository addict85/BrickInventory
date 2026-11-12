/**
 * Mails an unbestätigte Adressen tragen keinen Text aus der Anfrage: keine
 * Anrede aus Vor-, Nach- oder Benutzername, die Konsole zeigt den echten Link,
 * und Registrierung wie „Passwort vergessen" sind je Zieladresse gedrosselt.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  routes/auth.ts und src/mail/mailer.ts auf Stand 2b73e33 → alle sechs
 *      Teile rot, darunter „die Bestätigungsmail nennt …“ („Hallo Anna,“)
 *   B  nameGueltig() in POST /register entfernt → rot: „Namen mit Adresse oder
 *      Steuerzeichen werden abgewiesen“ (200 statt 400)
 *   C  zielGedrosselt() in POST /register entfernt → rot: „je Zieladresse
 *      höchstens drei Registrierungen“ (200 statt 429)
 *   D  sendMail() gibt wieder den Text an die alte URL-Suche in
 *      linkFuerKonsole() → rot: „die Konsole zeigt den echten Link“
 *   E  zielGedrosselt() in /forgot-password entfernt → rot: „der vierte
 *      Rücksetzlink an dieselbe Adresse bleibt aus“
 *   F  sendVerificationMail() übergeht `mehrere` → rot: „die zweite Mail
 *      verweist auf die Bestätigungsseite“ (04.11.2026 gemessen)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.APP_BASE_URL = 'https://lego.example.org';

// Der Mailer baut den Transport erst beim Versand: hier abfangen statt senden.
const nodemailer = require(path.join(__dirname, '..', 'node_modules', 'nodemailer'));
const gesendet = [];
nodemailer.createTransport = () => ({
  sendMail: async m => {
    gesendet.push(m);
    return { messageId: 'x' };
  },
});

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const mailer = _req('src/mail/mailer.js');

const P = process.pid;
const BOESE = 'Gewinn-abholen.example';

test('Mails ohne fremden Text', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req))) return;

  const SCHLUESSEL = ['registration_enabled', 'smtp_host', 'smtp_user'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  const setze = async (k, v) =>
    db.run(
      `INSERT INTO global_settings (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $2`,
      [k, v],
    );
  await setze('registration_enabled', '1');
  await setze('smtp_host', '192.0.2.25'); // eine Adresse: Ein Name müsste auflösen (src/infra/zielAdresse.ts)
  await setze('smtp_user', 'versand');
  const leereZaehler = () => db.run("DELETE FROM rate_limit_attempts WHERE key ~ '^(register|forgot)'");
  await leereZaehler();
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE username LIKE $1', [`%_${P}`]);
    await leereZaehler();
    await db.pool.end().catch(() => {});
  });

  const sitzung = {};
  const { base } = testServer(_req, { sitzung, t, routen: { '/api/v1/auth': 'routes/auth.js' } });
  const rufe = (methode, pfad, body) =>
    fetch(`${base}/api/v1/auth${pfad}`, {
      method: methode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async r => ({ status: r.status, body: await r.json() }));
  const registriere = (u, email, extra = {}) =>
    rufe('POST', '/register', { username: u, email, password: 'Langes-Passwort-42', ...extra });
  const warteAufMail = async an => {
    for (let i = 0; i < 50; i++) {
      const m = gesendet.find(x => x.to === an);
      if (m) return m;
      await new Promise(r => setTimeout(r, 20));
    }
    return undefined;
  };

  await t.test('Namen mit Adresse oder Steuerzeichen werden abgewiesen', async () => {
    for (const [i, extra] of [
      { first_name: `Hallo ${BOESE}: https://boese.example/x` },
      { last_name: 'Meier\nKlick hier' },
      { first_name: 'www.boese.example' },
    ].entries()) {
      const r = await registriere(`name${i}_${P}`, `name${i}_${P}@example.org`, extra);
      assert.equal(r.status, 400, JSON.stringify(r.body));
      assert.equal(r.body.code, 'name_ungueltig');
    }
    const lang = await registriere(`lang_${P}`, `lang_${P}@example.org`, { first_name: 'x'.repeat(101) });
    assert.equal(lang.status, 400, 'über 100 Zeichen weist der Eingabevertrag ab');
    const hash = await require(require('node:path').join(__dirname, '..', 'node_modules', 'bcryptjs')).hash(
      'Profil-Passwort-1',
      4,
    );
    sitzung.userId = (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified)
      VALUES ($1, $2, true, true) RETURNING id`,
        [`profil_${P}`, hash],
      )
    ).id;
    const p = await rufe('PUT', '/profile', { first_name: 'Anna\u0007' });
    assert.equal(p.status, 400, JSON.stringify(p.body));
    assert.equal(p.body.code, 'name_ungueltig');
    assert.equal(
      (
        await rufe('PUT', '/profile', {
          first_name: 'Anna-Lena',
          last_name: "O'Brien",
          password_current: 'Profil-Passwort-1',
        })
      ).status,
      200,
    );
    await leereZaehler();
  });

  await t.test('die Bestätigungsmail nennt keinen gewählten Namen', async () => {
    const an = `anna_${P}@example.org`;
    const r = await registriere(`${BOESE.slice(0, 14)}_${P}`, an, { first_name: 'Anna', last_name: 'Beispiel' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = await warteAufMail(an);
    assert.ok(m, 'keine Bestätigungsmail');
    for (const teil of [m.text, m.html]) {
      assert.ok(!teil.includes('Anna') && !teil.includes(BOESE.slice(0, 14)), teil.slice(0, 300));
    }
    assert.match(m.text, /https:\/\/lego\.example\.org\/verify\?token=[0-9a-f]{64}/);
  });

  await t.test('die Mail zum vergebenen Benutzernamen nennt ihn nicht', async () => {
    const an = `zweiter_${P}@example.org`;
    const r = await registriere(`${BOESE.slice(0, 14)}_${P}`, an);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const m = await warteAufMail(an);
    assert.ok(m, 'keine Mail an die zweite Adresse');
    assert.ok(!m.text.includes(BOESE.slice(0, 14)) && !m.html.includes(BOESE.slice(0, 14)), m.text);
  });

  await t.test('mehrere Registrierungen: die Mail verweist ohne Namen auf die Bestätigungsseite', async () => {
    await leereZaehler();
    const an = `doppelt_${P}@example.org`;
    for (const n of [`${BOESE.slice(0, 14)}x_${P}`, `echt_${P}`]) assert.equal((await registriere(n, an)).status, 200);
    for (let i = 0; i < 50 && gesendet.filter(m => m.to === an).length < 2; i++)
      await new Promise(r => setTimeout(r, 20));
    const [erste, zweite] = gesendet.filter(m => m.to === an);
    assert.ok(zweite, 'keine zweite Mail');
    assert.doesNotMatch(erste.text, /Mehrere Registrierungen/);
    for (const teil of [zweite.text, zweite.html]) {
      assert.match(
        teil,
        /Mehrere Registrierungen nennen diese Adresse/,
        'die zweite Mail verweist auf die Bestätigungsseite',
      );
      assert.ok(!teil.includes(BOESE.slice(0, 14)) && !teil.includes(`echt_${P}`), 'die Mail nennt keinen Namen');
    }
    await leereZaehler();
  });

  await t.test('je Zieladresse höchstens drei Registrierungen', async () => {
    await leereZaehler();
    const an = `ziel_${P}@example.org`;
    const status = [];
    // Verschiedene Namen, damit nur die Adresse gemeinsam ist.
    for (let i = 0; i < 4; i++) status.push((await registriere(`ziel${i}_${P}`, an)).status);
    assert.deepEqual(status, [200, 200, 200, 429]);
    assert.equal(
      (await registriere(`andere_${P}`, `andere_${P}@example.org`)).status,
      200,
      'eine andere Adresse von derselben IP bleibt offen',
    );
    await leereZaehler();
  });

  await t.test('der vierte Rücksetzlink an dieselbe Adresse bleibt aus', async () => {
    const an = `vergessen_${P}@example.org`;
    await db.run(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
      VALUES ($1, $2, 'x', true, true)`,
      [`vergessen_${P}`, an],
    );
    const gesetzt = [];
    for (let i = 0; i < 4; i++) {
      const r = await rufe('POST', '/forgot-password', { email: an });
      assert.equal(r.status, 200);
      const z = await db.get('SELECT reset_token FROM users WHERE email = $1', [an]);
      gesetzt.push(!!z.reset_token);
      await db.run('UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE email = $1', [an]);
    }
    assert.deepEqual(gesetzt, [true, true, true, false]);
    const m = await warteAufMail(an);
    assert.ok(m && !m.text.includes(`vergessen_${P}`), 'die Rücksetzmail grüsst ohne Benutzernamen');
  });

  await t.test('die Konsole zeigt den echten Link', async () => {
    await db.run("DELETE FROM global_settings WHERE key = 'smtp_host'");
    const zeilen = [];
    const alt = console.log;
    console.log = (...a) => {
      zeilen.push(a.join(' '));
    };
    try {
      await mailer.sendMail({
        to: `k_${P}@example.org`,
        subject: 'x',
        text: 'Hallo https://boese.example/gewinn\nhttps://lego.example.org/verify?token=abc123',
        link: 'https://lego.example.org/verify?token=abc123',
      });
    } finally {
      console.log = alt;
    }
    const link = zeilen.find(z => z.includes('Link:'));
    assert.ok(link, zeilen.join('\n'));
    assert.match(link, /https:\/\/lego\.example\.org\/verify\?token=…/);
    assert.ok(!link.includes('boese'), link);
  });
});
