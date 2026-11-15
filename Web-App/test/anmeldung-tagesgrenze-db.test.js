/**
 * Tagesgrenze je Konto: Eine bekannte Adresse umgeht die Bremse je Konto; nach 50
 * Fehlversuchen in 24 Stunden gilt das Passwort deshalb nur noch zusammen mit dem Code des
 * zweiten Faktors. Unbekannte Adressen zählen gemeinsam, jede bekannte für sich: Ein Fremder
 * sperrt den Inhaber so nicht an dessen Geräten aus. Der Inhaber mit Faktor kommt weiter
 * hinein, ohne Faktor über „Passwort vergessen“ (das leert die Zähler); er bekommt eine Mail.
 *
 * Gegenproben (14.11.2026 gemessen, je einzeln):
 *   A  in pruefeAnmeldedaten() die Abfrage tagesgrenzeErreicht() abgeschaltet → rot: „über der
 *      Grenze: Passwort allein reicht nicht …“ (200 statt 429) und „… mit Code geht es weiter“
 *   B  in anmeldungGescheitert() den Tageszähler nicht erhöht → rot: „der 50. Fehlversuch
 *      erreicht die Grenze …“ und „über der Grenze …“
 *   C  die Ausnahme für Code und aktiven Faktor gestrichen → rot: „… mit Code geht es weiter“
 *   D  loescheTagesgrenze() in setzePasswortZurueck() gestrichen → rot: „nach Passwort
 *      vergessen geht das Passwort wieder“
 *
 * Gegenproben zur Trennung bekannter Adressen (15.11.2026 gemessen):
 *   E  in _tagKey() stets `login-tag|${kennung}` geliefert → rot: „der 50. Fehlversuch …“
 *      (der gemeinsame Zähler stieg), die beiden folgenden und „50 Fehlversuche eines
 *      Fremden …“ (429 statt 200)
 *   F  in loescheTagesgrenze() das Löschen mit Präfix gestrichen → rot: „nach Passwort
 *      vergessen …“ (Zähler der bekannten Adresse blieb)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { umgebung, testDaten, buildAndRequire } = require('./helpers/sources');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
umgebung({ SESSION_SECRET: 'test-secret-lang-genug-fuer-die-pruefung' });

const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { mailAttrappe, mailserverEintragen } = require('./helpers/mail-attrappe');
const { bis } = require('./helpers/zeit');
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = testDaten();
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

test.after(() => db.pool.end().catch(() => {}));

test('Tagesgrenze der Anmeldung je Konto', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const gesendet = mailAttrappe();
  t.after(await mailserverEintragen(db));
  const zf = _req('src/konto/zweiterFaktor.js');
  const { verschluessele } = _req('src/infra/geheimnis.js');
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
  const geheimnis = zf.base32(crypto.randomBytes(20));
  await db.run('INSERT INTO zweiter_faktor (user_id, geheimnis, aktiv) VALUES ($1, $2, true)', [
    id[MIT],
    verschluessele(geheimnis, zf.faktorKontext(id[MIT])),
  ]);
  /** Ein frischer Code: Derselbe Schritt gilt nur einmal, deshalb vorher zurücksetzen. */
  const code = async () => {
    await db.run('UPDATE zweiter_faktor SET letzter_schritt = 0 WHERE user_id = $1', [id[MIT]]);
    return zf.hotp(zf.ausBase32(geheimnis), zf.zeitschritt());
  };
  const { base } = testServer(_req, { t });
  const anmelden = async (name, passwort, mitCode) => {
    const r = await fetch(`${base}${AUTH}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: name,
        password: passwort,
        ohne_token: true,
        ...(mitCode ? { code: mitCode } : {}),
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
  const tageszaehler = async (name, hier) =>
    (await db.get('SELECT count FROM rate_limit_attempts WHERE key = $1', [await tagKey(name, hier)]))?.count ?? 0;
  const setzeZaehler = async (name, n, hier) =>
    db.run(
      `INSERT INTO rate_limit_attempts (key, count, first_at, last_at) VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE SET count = $2, first_at = NOW(), last_at = NOW()`,
      [await tagKey(name, hier), n],
    );

  // Beide Konten melden sich einmal von hier an: Die Adresse ist ab jetzt bekannt.
  assert.equal((await anmelden(OHNE, PASS)).status, 200);
  assert.equal((await anmelden(MIT, PASS, await code())).status, 200);

  await t.test('der 50. Fehlversuch erreicht die Grenze, der Inhaber bekommt eine Mail', async () => {
    await setzeZaehler(OHNE, 48, true);
    assert.equal((await anmelden(OHNE, 'falsch-geraten-1')).status, 401);
    assert.equal(await tageszaehler(OHNE, true), 49, 'ein Fehlversuch von einer bekannten Adresse zählt');
    assert.equal(await tageszaehler(OHNE), 0, '… bei dieser Adresse, nicht im gemeinsamen Zähler');
    assert.equal((await anmelden(OHNE, 'falsch-geraten-2')).status, 401);
    assert.equal(await tageszaehler(OHNE, true), 50);
    assert.ok(
      await bis(() => gesendet.some(m => m.to === `${OHNE}@example.org` && /50 fehlgeschlagene/.test(m.text)), 10_000),
      'keine Mail an den Inhaber',
    );
  });

  await t.test('über der Grenze: Passwort allein reicht nicht, auch von der bekannten Adresse', async () => {
    const r = await anmelden(OHNE, PASS);
    assert.equal(r.status, 429, JSON.stringify(r.body));
    assert.equal(r.body.code, 'konto_tagesgrenze');
    assert.equal(r.body.zweiter_faktor, true, 'die Oberfläche bietet das Codefeld an');
    // Ohne Faktor hilft auch ein Code nicht; die Antwort verrät das Passwort nicht.
    assert.equal((await anmelden(OHNE, PASS, '123456')).body.code, 'konto_tagesgrenze');
    assert.equal((await anmelden(OHNE, 'falsch', '123456')).body.code, 'konto_tagesgrenze');
  });

  await t.test('… mit Code geht es weiter, ohne nicht', async () => {
    await setzeZaehler(MIT, 50, true);
    assert.equal((await anmelden(MIT, PASS)).body?.code, 'konto_tagesgrenze');
    const r = await anmelden(MIT, PASS, await code());
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await anmelden(MIT, 'falsch-geraten', await code())).status, 401);
  });

  await t.test('nach Passwort vergessen geht das Passwort wieder', async () => {
    const link = `tg-link-${P}`;
    await db.run(`UPDATE users SET reset_token = $1, reset_token_expires = NOW() + INTERVAL '1 hour' WHERE id = $2`, [
      _req('src/konto/geraeteToken.js').tokenAbdruck(link),
      id[OHNE],
    ]);
    const neu = 'neues-Passwort-nach-Link-17';
    const r = await fetch(`${base}${AUTH}/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: link, password: neu }),
    });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual([await tageszaehler(OHNE), await tageszaehler(OHNE, true)], [0, 0]);
    assert.equal((await anmelden(OHNE, neu)).status, 200);
  });

  await t.test('50 Fehlversuche eines Fremden sperren die bekannte Adresse nicht, eine unbekannte schon', async () => {
    const neu = 'neues-Passwort-nach-Link-17';
    await setzeZaehler(OHNE, 50);
    const r = await anmelden(OHNE, neu);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // Ohne Bekannt-Zeile ist dieselbe Adresse fremd: Dort gilt der gemeinsame Zähler.
    await db.run('DELETE FROM rate_limit_attempts WHERE key LIKE $1', [`login-bekannt|%|konto:${id[OHNE]}`]);
    assert.equal((await anmelden(OHNE, neu)).body?.code, 'konto_tagesgrenze');
  });
});
