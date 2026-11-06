/**
 * Fehlgeschlagene Anmeldungen, Sperren und falsche Codes hinterlassen je eine
 * Warnzeile (JSON auf stderr und in app_logs), ohne Passwort, Code oder den
 * eingegebenen Namen. Erreicht ein Konto die Sperre, bekommt der Inhaber
 * höchstens einmal am Tag eine Mail.
 *
 * Gegenproben (04.11.2026 gemessen, je einzeln):
 *   A  meldeAnmeldeereignis() in fehlversuch() entfernt → rot: „ein unbekannter
 *      Name …“, „falsches Passwort …“, „ein falscher Code …“
 *   B  die Zeile bei checkLoginAllowed() entfernt → rot: „die Sperre steht im Protokoll“
 *   C  meldeAnmeldeereignis() in gebremst() (passwortBestaetigung) entfernt →
 *      rot: „eine falsche Bestätigung …“, „die Zeile landet in app_logs“
 *   D  in fehlversuch() die Mail entfernt → rot: „falsches Passwort …“ (keine
 *      Mail), „die Mail höchstens einmal am Tag“
 *   E  kontoGedrosselt() vor der Mail entfernt → rot: „die Mail höchstens einmal am Tag“
 *   F  in meldeAnmeldeereignis() `name` mitgegeben → rot: „ein unbekannter Name …“
 * Gegenproben Runde 17 (05.11.2026 gemessen, je einzeln):
 *   G  kontoKennung() gibt für unbekannte Namen wieder den Klartext zurück →
 *      rot: „ein unbekannter Name steht nur als HMAC …“ (Teil 1)
 *   H  meldeAnmeldung() in pruefeAnmeldedaten() entfernt → rot: „eine
 *      gelungene Anmeldung …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { testServer } = require('./helpers/server');

const mails = [];
const echterMailer = _req('src/mail/mailer.js');
require.cache[require.resolve(path.join(S.DIST, 'src/mail/mailer.js'))].exports = Object.assign({}, echterMailer, {
  mailEingerichtet: async () => true,
  sendKontoHinweisMail: async (an, _name, art) => { mails.push({ an, art }); return { success: true }; },
});

const db = _req('db/database.js');
const zf = _req('src/konto/zweiterFaktor.js');
const protokoll = _req('src/infra/protokoll.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));
const P = process.pid, PASS = 'Protokoll-Passwort-1', FALSCH = 'Geheim-Falsch-987';

test('Anmeldeereignisse im Protokoll', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw new Error(`REQUIRE_DB=1, aber keine Test-DB: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  const NAME = `prot_${P}`, FAKTOR = `prot_zf_${P}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, FAKTOR]]);
  const konto = async (n) => (await db.get(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
    VALUES ($1, $2, $3, true, true) RETURNING id`, [n, `${n}@example.org`, await bcrypt.hash(PASS, 4)])).id;
  const uid = await konto(NAME), zfId = await konto(FAKTOR);
  const g = await zf.beginneEinrichtung(zfId);
  assert.ok(await zf.bestaetigeEinrichtung(zfId, zf.hotp(zf.ausBase32(g), zf.zeitschritt())), 'Vorbedingung: Faktor aktiv');
  const leereZaehler = () => db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%' OR key LIKE 'sperr-hinweis%' OR key LIKE $1`, [`%-bestaetigen|${uid}|%`]);
  await leereZaehler();

  const zeilen = [], infos = [];
  const zurueck = protokoll.installiereProtokoll({ out: (z) => infos.push(z), err: (z) => zeilen.push(z), jetzt: () => Date.now() });
  protokoll.protokollInDieDatenbank(db.pool);
  t.after(async () => {
    zurueck();
    await leereZaehler();
    await db.run(`DELETE FROM app_logs WHERE message LIKE $1 OR (message LIKE '%[anmeldung]%' AND message ~ $2)`,
      [`%prot-test-${P}%`, `"konto":(${uid}|${zfId})\\M`]).catch(() => {});
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, FAKTOR]]).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME }, t, routen: { '/api/v1/auth': 'routes/auth.js' } });
  const ruf = (weg, body) => fetch(`${base}/api/v1/auth${weg}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
  const anmelden = (username, password, code) => ruf('/login', { username, password, ohne_token: true, ...(code ? { code } : {}) });
  /** Die Warnzeilen eines Ereignisses als geparstes JSON. */
  const ereignisse = (art) => zeilen.map(z => JSON.parse(z)).filter(z => z.kontext?.ereignis === art);
  const warteAufMails = async (n) => { for (let i = 0; i < 60 && mails.length < n; i++) await new Promise(r => setTimeout(r, 25)); };

  await t.test('ein unbekannter Name: Zeile ohne Name und Passwort', async () => {
    assert.equal(await anmelden(`niemand_${P}`, FALSCH), 401);
    const [z] = ereignisse('anmeldung_fehlgeschlagen');
    assert.equal(z?.stufe, 'warn', 'keine Warnzeile');
    // localhost ist je nach Rechner 127.0.0.1 oder ::1 (gekürzt auf das /64).
    assert.match(z.kontext.adresse, /^(127\.0\.0\.1|0:0:0:0::\/64)$/);
    assert.equal(z.kontext.konto, 'unbekannt');
    assert.ok(!zeilen.join('\n').includes(`niemand_${P}`) && !zeilen.join('\n').includes(FALSCH), 'Name oder Passwort im Protokoll');
  });

  await t.test('ein unbekannter Name steht nur als HMAC in rate_limit_attempts', async () => {
    const X = `Vertippt-Geheim-${P}-Passwort`;
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%'`);
    assert.equal(await anmelden(X, FALSCH), 401);
    assert.equal(await anmelden(X, FALSCH), 401);
    const klar = await db.get(`SELECT count(*)::int n FROM rate_limit_attempts WHERE key ILIKE '%' || lower($1) || '%'`, [X]);
    assert.equal(klar.n, 0, 'der eingegebene Name steht im Klartext in der Tabelle');
    const je = await db.get(`SELECT count FROM rate_limit_attempts WHERE key LIKE 'login-name|name:%'`);
    assert.equal(Number(je?.count), 2, 'zwei Versuche mit demselben Namen zählen auf denselben Schlüssel');
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%'`);
  });

  await t.test('eine gelungene Anmeldung: genau eine Infozeile mit Konto und Adresse', async () => {
    infos.length = 0;
    assert.equal(await anmelden(NAME, PASS), 200);
    const erfolg = infos.map(z => JSON.parse(z)).filter(z => /^\[anmeldung\] anmeldung_erfolgreich/.test(z.nachricht));
    assert.equal(erfolg.length, 1, infos.join('\n'));
    assert.equal(erfolg[0].kontext.konto, uid);
    assert.match(erfolg[0].kontext.adresse, /^(127\.0\.0\.1|0:0:0:0::\/64)$/);
    assert.equal(erfolg[0].kontext.zugang, 'passwort');
    assert.ok(![...infos, ...zeilen].join('\n').includes(NAME) && !infos.join('\n').includes(PASS), 'Name oder Passwort im Protokoll');
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%'`);
  });

  await t.test('falsches Passwort: Zeile mit Konto, beim Erreichen der Sperre eine Mail', async () => {
    zeilen.length = 0;
    for (let i = 0; i < 5; i++) assert.equal(await anmelden(NAME, FALSCH), 401);
    assert.deepEqual(ereignisse('anmeldung_fehlgeschlagen').map(z => z.kontext.konto), [uid, uid, uid, uid, uid]);
    await warteAufMails(1);
    assert.deepEqual(mails, [{ an: `${NAME}@example.org`, art: 'anmeldung_gebremst' }]);
  });

  await t.test('die Sperre steht im Protokoll', async () => {
    zeilen.length = 0;
    assert.equal(await anmelden(NAME, PASS), 429);
    assert.deepEqual(ereignisse('anmeldung_gesperrt').map(z => z.kontext.konto), [uid]);
  });

  await t.test('die Mail höchstens einmal am Tag', async () => {
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%'`);
    for (let i = 0; i < 5; i++) await anmelden(NAME, FALSCH);
    await warteAufMails(2); // eine zweite Mail käme hier an
    assert.equal(mails.length, 1, JSON.stringify(mails));
  });

  await t.test('ein falscher Code', async () => {
    await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'login%'`);
    zeilen.length = 0;
    const richtig = zf.hotp(zf.ausBase32(g), zf.zeitschritt());
    assert.equal(await anmelden(FAKTOR, PASS, richtig === '000000' ? '000001' : '000000'), 401);
    assert.deepEqual(ereignisse('zweiter_faktor_falsch').map(z => z.kontext.konto), [zfId]);
  });

  await t.test('eine falsche Bestätigung', async () => {
    zeilen.length = 0;
    assert.equal(await ruf('/change-password', { current: FALSCH, newPassword: 'Neues-Passwort-77' }), 400);
    const [z] = ereignisse('bestaetigung_fehlgeschlagen');
    assert.deepEqual([z?.kontext.konto, z?.kontext.art], [uid, 'passwort']);
    assert.ok(!zeilen.join('\n').includes(FALSCH));
  });

  await t.test('die Zeile landet in app_logs', async () => {
    console.warn(`prot-test-${P}`);
    await protokoll.leereProtokoll();
    const r = await db.all(`SELECT level, message FROM app_logs WHERE message LIKE '%bestaetigung_fehlgeschlagen%' AND message LIKE $1`,
      [`%"konto":${uid}%`]);
    assert.ok(r.length >= 1 && r[0].level === 'warn', JSON.stringify(r));
  });
});
