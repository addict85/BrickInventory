/**
 * Tagesgrenze je Konto: Eine bekannte Adresse umgeht die Bremse je Konto; nach 50
 * Fehlversuchen in 24 Stunden gilt das Passwort deshalb nur noch zusammen mit dem Code des
 * zweiten Faktors. Unbekannte Adressen zählen gemeinsam, jede bekannte für sich: Ein Fremder
 * sperrt den Inhaber so nicht an dessen Geräten aus. Der Inhaber mit Faktor kommt weiter
 * hinein, ohne Faktor über „Passwort vergessen“ (das leert die Zähler); er bekommt eine Mail.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln):
 *   A  in checkCredentials() die Abfrage dailyLimitReached() abgeschaltet → rot: „über der
 *      Grenze: Passwort allein reicht nicht …“ (200 statt 429) und „… mit Code geht es weiter“
 *   B  in loginFailed() den Tageszähler nicht erhöht → rot: „der 50. Fehlversuch
 *      erreicht die Grenze …“ und „über der Grenze …“
 *   C  die Ausnahme für Code und aktiven Faktor gestrichen → rot: „… mit Code geht es weiter“
 *   D  deleteDailyLimit() in setPasswordBack() gestrichen → rot: „nach Passwort
 *      vergessen geht das Passwort wieder“
 *
 * Gegenproben zur Trennung bekannter Adressen (15.11.2026 gemessen):
 *   E  in _tagKey() stets `login-tag|${kennung}` geliefert → rot: „der 50. Fehlversuch …“
 *      (der gemeinsame Zähler stieg), die beiden folgenden und „50 Fehlversuche eines
 *      Fremden …“ (429 statt 200)
 *   F  in deleteDailyLimit() das Löschen mit Präfix gestrichen → rot: „nach Passwort
 *      vergessen …“ (Zähler der bekannten Adresse blieb)
 *
 * Gegenproben zum Freigabelink (16.11.2026 gemessen, je einzeln):
 *   G  in onlyStillWithFactor() offerRelease() gestrichen → rot: „an einer unbekannten
 *      Adresse kommt ein Freigabelink …“ (keine Mail)
 *   H  in _tagKey() die Freigabe nicht beachtet → rot: dieselbe Prüfung (429 nach dem Link)
 *   I  in anmeldungFreigeben() die Einmal-Prüfung gestrichen → rot: dieselbe Prüfung (der Link
 *      galt zweimal)
 *   J  in anmeldungFreigeben() die Signatur nicht geprüft → rot: dieselbe Prüfung (ein Link für
 *      ein anderes Konto galt)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { environment, testData, buildAndRequire } = require('./helpers/sources');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
environment({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung', APP_BASE_URL: 'http://localhost' });

const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { mailAttrappe, enterMailServer } = require('./helpers/mail-fake');
const { bis } = require('./helpers/time');
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = testData();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test.after(() => db.pool.end().catch(() => {}));

test('daily login limit per account', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const gesendet = mailAttrappe();
  t.after(await enterMailServer(db));
  const zf = _req('src/factors/secondFactor.js');
  const { encrypt } = _req('src/infra/secret.js');
  const P = process.pid;
  const OHNE = `tg_ohne_${P}`,
    MIT = `tg_mit_${P}`,
    PASS = 'richtiges-Passwort-17';
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[OHNE, MIT]]);
  t.after(() => db.run('DELETE FROM users WHERE username = ANY($1)', [[OHNE, MIT]]).catch(() => {}));
  const id = {};
  for (const n of [OHNE, MIT])
    id[n] = (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
         VALUES ($1, $2, $3, true, true) RETURNING id`,
        [n, `${n}@example.org`, await bcrypt.hash(PASS, 4)],
      )
    ).id;
  const secret = zf.base32(crypto.randomBytes(20));
  await db.run('INSERT INTO second_factor (user_id, secret, active) VALUES ($1, $2, true)', [
    id[MIT],
    encrypt(secret, zf.secondFactorContext(id[MIT])),
  ]);
  /** Ein frischer Code: Derselbe Schritt gilt nur einmal, deshalb vorher zurücksetzen. */
  const code = async () => {
    await db.run('UPDATE second_factor SET last_step = 0 WHERE user_id = $1', [id[MIT]]);
    return zf.hotp(zf.fromBase32(secret), zf.timeStep());
  };
  const { base } = testServer(_req, { t });
  const anmelden = async (name, passwort, withCode) => {
    const r = await fetch(`${base}${AUTH}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: name,
        password: passwort,
        ohne_token: true,
        ...(withCode ? { code: withCode } : {}),
      }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  /** Der gemeinsame Zähler unbekannter Adressen, oder mit `hier` der dieser bekannten Adresse. */
  const tagKey = async (name, hier) => {
    if (!hier) return `login-tag|konto:${id[name]}`;
    const b = await db.get('SELECT key FROM rate_limit_attempts WHERE key LIKE $1', [
      `login-bekannt|%|konto:${id[name]}`,
    ]);
    return `login-tag|konto:${id[name]}|${b.key.split('|')[1]}`;
  };
  const dailyCounter = async (name, hier) =>
    (await db.get('SELECT count FROM rate_limit_attempts WHERE key = $1', [await tagKey(name, hier)]))?.count ?? 0;
  const setCounter = async (name, n, hier) =>
    db.run(
      `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE SET count = $2, first_at = NOW(), last_at = NOW()`,
      [await tagKey(name, hier), n],
    );

  // Beide Konten melden sich einmal von hier an: Die Adresse ist ab jetzt bekannt.
  assert.equal((await anmelden(OHNE, PASS)).status, 200);
  assert.equal((await anmelden(MIT, PASS, await code())).status, 200);

  await t.test('the 50th failed attempt reaches the limit, the owner gets a mail', async () => {
    await setCounter(OHNE, 48, true);
    assert.equal((await anmelden(OHNE, 'falsch-geraten-1')).status, 401);
    assert.equal(await dailyCounter(OHNE, true), 49, 'ein Fehlversuch von einer bekannten Adresse zählt');
    assert.equal(await dailyCounter(OHNE), 0, '… bei dieser Adresse, nicht im gemeinsamen Zähler');
    assert.equal((await anmelden(OHNE, 'falsch-geraten-2')).status, 401);
    assert.equal(await dailyCounter(OHNE, true), 50);
    assert.ok(
      await bis(() => gesendet.some(m => m.to === `${OHNE}@example.org` && /50 fehlgeschlagene/.test(m.text)), 10_000),
      'keine Mail an den Inhaber',
    );
  });

  await t.test('above the limit: the password alone is not enough, even from the known address', async () => {
    const r = await anmelden(OHNE, PASS);
    assert.equal(r.status, 429, JSON.stringify(r.body));
    assert.equal(r.body.code, 'konto_tagesgrenze');
    assert.equal(r.body.zweiter_faktor, true, 'die Oberfläche bietet das Codefeld an');
    // Ohne Faktor hilft auch ein Code nicht; die Antwort verrät das Passwort nicht.
    assert.equal((await anmelden(OHNE, PASS, '123456')).body.code, 'konto_tagesgrenze');
    assert.equal((await anmelden(OHNE, 'falsch', '123456')).body.code, 'konto_tagesgrenze');
  });

  await t.test('… with code it continues, without not', async () => {
    await setCounter(MIT, 50, true);
    assert.equal((await anmelden(MIT, PASS)).body?.code, 'konto_tagesgrenze');
    const r = await anmelden(MIT, PASS, await code());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await anmelden(MIT, 'falsch-geraten', await code())).status, 401);
  });

  await t.test('after forgot password the password works again', async () => {
    const link = `tg-link-${P}`;
    await db.run(`UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2`, [
      _req('src/account/deviceToken.js').tokenDigest(link),
      id[OHNE],
    ]);
    const neu = 'neues-Passwort-nach-Link-17';
    const r = await fetch(`${base}${AUTH}/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: link, password: neu }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual([await dailyCounter(OHNE), await dailyCounter(OHNE, true)], [0, 0]);
    assert.equal((await anmelden(OHNE, neu)).status, 200);
  });

  await t.test('50 failed attempts by a stranger do not lock the known address, an unknown one is locked', async () => {
    const neu = 'neues-Passwort-nach-Link-17';
    await setCounter(OHNE, 50);
    const r = await anmelden(OHNE, neu);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Ohne Bekannt-Zeile ist dieselbe Adresse fremd: Dort gilt der gemeinsame Zähler.
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`login-bekannt|%|konto:${id[OHNE]}`]);
    assert.equal((await anmelden(OHNE, neu)).body?.code, 'konto_tagesgrenze');
  });

  await t.test('at an unknown address an unlock link comes; it unlocks it, once', async () => {
    const neu = 'neues-Passwort-nach-Link-17';
    const links = () =>
      gesendet
        .filter(m => m.to === `${OHNE}@example.org`)
        .map(m => /\/anmeldung-freigeben#token=(\S+)/.exec(m.text)?.[1])
        .filter(Boolean);
    assert.ok(await bis(() => links().length > 0, 10_000), 'kein Freigabelink an den Inhaber');
    assert.equal((await anmelden(OHNE, 'falsch-noch-einmal')).body?.code, 'konto_tagesgrenze');
    assert.equal(await bis(() => links().length > 1, 300), false, 'je Adresse und Stunde nur eine Mail');
    const freigeben = token =>
      fetch(`${base}${AUTH}/anmeldung-freigeben`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      }).then(async r => ({ status: r.status, body: await r.json() }));
    const [token] = links();
    const [uid, ...rest] = token.split('.');
    const forged = [String(id[MIT]), ...rest].join('.');
    assert.equal((await freigeben(forged)).body.code, 'freigabe_link_ungueltig', 'Signatur');
    assert.equal(Number(uid), id[OHNE]);
    const r = await freigeben(token);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await freigeben(token)).body.code, 'freigabe_link_ungueltig', 'nur einmal');
    const a = await anmelden(OHNE, neu);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(await dailyCounter(OHNE), 50, 'der gemeinsame Zähler bleibt für andere Adressen');
  });
});
