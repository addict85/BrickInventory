/**
 * Eine neue E-Mail-Adresse verlangt das aktuelle Passwort, und die alte Adresse
 * erfährt davon. Über die neue Adresse liesse sich sonst das Passwort
 * zurücksetzen: Eine kurz offene fremde Sitzung genügte zur Übernahme.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  die Passwortprüfung im E-Mail-Zweig von PUT /profile entfernt → rot:
 *      „ohne Passwort", „falsches Passwort", „mit Passwort" (die Adresse war
 *      schon im ersten Teiltest gewechselt)
 *   B  den Hinweis an die alte Adresse entfernt → rot: „mit Passwort"
 *      (keine Mail an die alte Adresse)
 *   C  `password` in PUT /profile wieder angenommen → rot: „Passwort nur über
 *      change-password"
 *   D  getBaseUrl() fällt in Produktion wieder auf den Host-Kopf zurück → rot:
 *      „in Produktion ohne APP_BASE_URL kein Link aus dem Host-Kopf"
 *
 * Gegenproben zur Kontenaufzählung (03.11.2026 gemessen):
 *   E  emailVergeben() wieder vor der Passwortprüfung → rot: „eine belegte
 *      Adresse verrät sich nur mit Passwort“
 *   F  kontoGedrosselt() in PUT /profile entfernt → rot: „Vergabeprüfungen
 *      sind gebremst“
 *   G  Passwortpflicht wieder nur bei neuer Adresse → rot: „auch ohne neue
 *      Adresse nur mit Passwort“ und „ein belegter Benutzername verrät sich
 *      nur mit Passwort“
 * Gegenprobe Runde 17 (05.11.2026 gemessen):
 *   H  die Vorprüfung `emailVergeben → 400 email_vergeben` wieder eingebaut →
 *      rot: „eine belegte Adresse antwortet wie eine freie“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const { umgebung, testDaten } = require('./helpers/sources');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
umgebung({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

// Versandte Hinweise mitschreiben, bevor routes/auth die Mail-Funktionen bindet.
const gesendet = [];
const bestaetigt = [];
const versuche = [];
require('./helpers/sources').ersetzeDienste('mail', {
  sendEmailGeaendertMail: async (an, name, neu) => {
    gesendet.push({ an, name, neu });
    return { success: true };
  },
  sendVerificationMail: async (an, _token, basis) => {
    bestaetigt.push(basis);
    versuche.push({ an, art: 'link' });
    return { success: true };
  },
  sendRegistrierungsVersuchMail: async (an, _sprache, anlass) => {
    versuche.push({ an, art: anlass });
    return { success: true };
  },
});

const db = testDaten();
const bcrypt = require(path.join(ROOT, 'node_modules', 'bcryptjs'));
const NAME = `mailneu_${process.pid}`,
  PASS = 'Passwort12345';

test('E-Mail ändern', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;

  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}_b`]]);
  const anderes = (
    await db.get(`INSERT INTO users (username, email, password_hash) VALUES ($1, $2, 'x') RETURNING id`, [
      `${NAME}_b`,
      `${NAME}@belegt.example`,
    ])
  ).id;
  const uid = (
    await db.get(
      `INSERT INTO users (username, email, password_hash, is_active, email_verified)
     VALUES ($1, $2, $3, true, true) RETURNING id`,
      [NAME, `${NAME}@alt.example`, await bcrypt.hash(PASS, 4)],
    )
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, anderes]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME }, t });
  const profil = async body => {
    const r = await fetch(`${base}/api/v1/auth/profile`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: NAME, ...body }),
    });
    return { status: r.status, body: await r.json() };
  };
  const adresse = async () => (await db.get('SELECT email FROM users WHERE id = $1', [uid])).email;

  await t.test('ohne Passwort', async () => {
    const r = await profil({ email: `${NAME}@neu.example` });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'aktuelles_passwort_erforderlich');
    assert.equal(await adresse(), `${NAME}@alt.example`);
  });

  await t.test('falsches Passwort', async () => {
    const r = await profil({ email: `${NAME}@neu.example`, password_current: 'falsch-falsch' });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'aktuelles_passwort_falsch');
    assert.equal(await adresse(), `${NAME}@alt.example`);
  });

  await t.test('mit Passwort', async () => {
    const r = await profil({ email: `${NAME}@neu.example`, password_current: PASS });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.emailChanged, true);
    assert.equal(await adresse(), `${NAME}@alt.example`, 'die neue gilt erst nach dem Link (email-neu-db)');
    assert.deepEqual(
      gesendet,
      [{ an: `${NAME}@alt.example`, name: NAME, neu: `${NAME}@neu.example` }],
      'Die bisherige Adresse muss erfahren, dass das Konto eine neue hat',
    );
  });

  await t.test('auch ohne neue Adresse nur mit Passwort', async () => {
    const ohne = await profil({ email: `${NAME}@neu.example`, first_name: 'Neu' });
    assert.deepEqual([ohne.status, ohne.body.code], [400, 'aktuelles_passwort_erforderlich']);
    assert.equal(
      (await profil({ first_name: 'Neu', password_current: 'falsch-falsch' })).body.code,
      'aktuelles_passwort_falsch',
    );
    const mit = await profil({ email: `${NAME}@neu.example`, first_name: 'Neu', password_current: PASS });
    assert.equal(mit.status, 200, JSON.stringify(mit.body));
    assert.equal((await db.get('SELECT first_name FROM users WHERE id = $1', [uid])).first_name, 'Neu');
  });

  await t.test('ein belegter Benutzername verrät sich nur mit Passwort', async () => {
    assert.equal((await profil({ username: `${NAME}_b` })).body.code, 'aktuelles_passwort_erforderlich');
    assert.equal(
      (await profil({ username: `${NAME}_b`, password_current: 'falsch-falsch' })).body.code,
      'aktuelles_passwort_falsch',
    );
  });

  await t.test('in Produktion ohne APP_BASE_URL kein Link aus dem Host-Kopf', async () => {
    const vorher = { env: process.env.NODE_ENV, basis: process.env.APP_BASE_URL };
    umgebung({ NODE_ENV: 'production' });
    umgebung({ APP_BASE_URL: undefined });
    try {
      bestaetigt.length = 0;
      const r = await profil({ email: `${NAME}@drei.example`, password_current: PASS });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.emailSent, false);
      assert.deepEqual(bestaetigt, [], 'ohne feste Adresse darf kein Link verschickt werden');
      umgebung({ APP_BASE_URL: 'https://lego.example.org/' });
      await profil({ email: `${NAME}@vier.example`, password_current: PASS });
      assert.deepEqual(bestaetigt, ['https://lego.example.org']);
    } finally {
      umgebung({ NODE_ENV: vorher.env });
      if (vorher.basis === undefined) umgebung({ APP_BASE_URL: undefined });
      else umgebung({ APP_BASE_URL: vorher.basis });
    }
  });

  await t.test('eine belegte Adresse antwortet wie eine freie', async () => {
    const belegt = `${NAME}@belegt.example`;
    assert.equal((await profil({ email: belegt })).body.code, 'aktuelles_passwort_erforderlich');
    assert.equal(
      (await profil({ email: belegt, password_current: 'falsch-falsch' })).body.code,
      'aktuelles_passwort_falsch',
    );
    umgebung({ APP_BASE_URL: 'https://lego.example.org' });
    try {
      versuche.length = 0;
      const frei = await profil({ email: `${NAME}@frei.example`, password_current: PASS });
      const vergeben = await profil({ email: belegt.toUpperCase(), password_current: PASS });
      assert.deepEqual(vergeben, frei, 'Status und Felder gleich');
      assert.deepEqual(frei, { status: 200, body: { success: true, emailChanged: true, emailSent: true } });
      // Der Inhaber der belegten Adresse bekommt einen Hinweis statt eines Links.
      assert.deepEqual(versuche, [
        { an: `${NAME}@frei.example`, art: 'link' },
        { an: belegt, art: 'adresse' },
      ]);
      assert.equal(await adresse(), `${NAME}@alt.example`);
    } finally {
      umgebung({ APP_BASE_URL: undefined });
    }
  });

  await t.test('Vergabeprüfungen sind gebremst', async () => {
    const codes = [];
    for (let i = 0; i < 12; i++)
      codes.push((await profil({ username: `${NAME}_b`, password_current: PASS })).body.code);
    assert.equal(codes[0], 'benutzername_vergeben');
    const ab = codes.indexOf('zu_viele_anfragen');
    assert.ok(ab > 0, codes.join(', '));
    assert.ok(
      codes.slice(ab).every(c => c === 'zu_viele_anfragen'),
      codes.join(', '),
    );
  });

  await t.test('Passwort nur über change-password', async () => {
    const vorher = (await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash;
    const r = await profil({ password: 'GanzNeuesPasswort1', password_current: PASS });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'passwort_ueber_change_password');
    assert.equal((await db.get('SELECT password_hash FROM users WHERE id = $1', [uid])).password_hash, vorher);
  });
});
