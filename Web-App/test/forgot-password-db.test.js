/**
 * Passwort-vergessen gegen echte Datenbank: E-Mail-Vergleich ohne Beachtung
 * der Gross-/Kleinschreibung.
 *
 * ── Warum es diese Datei gibt ───────────────────────────────────────────────
 * Login, Registrierung und Profil vergleichen E-Mails seit jeher mit
 * LOWER(...) auf beiden Seiten. forgot-password war der EINZIGE Weg mit einem
 * case-sensitiven Vergleich (`WHERE email = $1`). Wer sich als
 * "Marco@Example.CH" registriert hatte und im Formular "marco@example.ch"
 * tippte, bekam die (bewusst neutrale) Erfolgsmeldung — aber nie eine Mail:
 * kein Treffer, kein Token, kein Versand. Von aussen war das nicht von Erfolg
 * zu unterscheiden; der Nutzer ist ohne erkennbaren Grund ausgesperrt.
 *
 * Das ist das wiederkehrende Muster "eine Regel fehlt an einem ZWEITEN Weg" —
 * und wie immer braucht sie einen VERHALTENStest: Eine Quelltext-Prüfung auf
 * LOWER( im richtigen Statement wäre dieselbe Sorte Test, die Lücken auch
 * festschreiben kann. Hier läuft die echte Route gegen die echte Tabelle, und
 * geprüft wird, ob der reset_token GESETZT wurde.
 *
 * Gegenprobe (durchgeführt): LOWER($1) in routes/auth.ts wieder auf $1
 * zurückgedreht → genau der erste Teilschritt hier wird rot.
 *
 * Zweiter Test: Ohne APP_BASE_URL geht kein Reset-Link raus, auch nicht mit NODE_ENV=development.
 * Gegenproben (25.10., gemessen):
 *   A  resetLinkMoeglich() liefert immer true → rot: „Reset-Code an den Host aus dem Header"
 *   B  Prüfung erst nach der Nutzersuche, mit 200 für Unbekannte → rot: „verrät die E-Mail"
 *   C  (01.11., gemessen) Sperre in forgot-password wieder nur bei NODE_ENV=production → rot: „Reset-Code
 *      an den Host aus dem Header"
 * Dritter Test, Gegenproben (01.11., gemessen): Pausenbedingung im UPDATE entfernt → rot
 *   „zweiter Link innerhalb der Pause“; Mindestdauer entfernt → rot „die Dauer verrät die Adresse“
 *
 * Voraussetzung: Test-DB (Inhalt wird verändert!) via TEST_DATABASE_URL.
 * Ohne DB: skip.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
// Links in Mails gibt es nur mit fester Adresse (routes/auth.ts, getBaseUrl).
process.env.APP_BASE_URL = 'http://localhost';
process.env.SESSION_SECRET = 'test-secret-lang-genug-fuer-die-pruefung';

const _req = require('./helpers/sources').buildAndRequire();
// Adresse aus server.ts lesen — siehe einhaengung() in helpers/sources.js.
const AUTH = require('./helpers/sources').einhaengung('auth');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));
const bcrypt  = require(path.join(ROOT, 'node_modules', 'bcryptjs'));

// Pool schliessen, sonst hält er den Prozess am Leben und die Datei läuft in
// den Timeout des Runners.
test.after(() => db.pool.end().catch(() => {}));

test('forgot-password findet die E-Mail unabhängig von der Schreibweise',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const USERNAME = 'forgotcasetest';
  await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  // Die ipThrottle des Endpunkts (5/h) zählt in rate_limit_attempts und
  // ÜBERLEBT Prozesse — dieser Test macht vier Aufrufe von derselben Adresse,
  // ein zweiter Lauf innerhalb der Stunde liefe sonst in 429.
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-password|%'`).catch(() => {});
  const hash = await bcrypt.hash('passwort123', 4);
  // Registriert mit gemischter Schreibweise — genau so speichert die
  // Registrierung die Adresse (unverändert, wie eingegeben).
  await db.run(
    `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
     VALUES ($1, 'Forgot.Case@Example.CH', $2, false, true, true)`,
    [USERNAME, hash]
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = {}; next(); });
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  const port = srv.address().port;

  const forgot = async (email) => {
    const r = await fetch(`http://localhost:${port}${AUTH}/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.success, true, 'die Antwort ist IMMER success:true (Anti-Enumeration)');
    // Die Wahrheit steht nicht in der Antwort, sondern in der Tabelle.
    const row = await db.get(`SELECT reset_token FROM users WHERE username = $1`, [USERNAME]);
    const gesetzt = !!row.reset_token;
    await db.run(`UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE username = $1`, [USERNAME]);
    return gesetzt;
  };

  try {
    assert.equal(await forgot('forgot.case@example.ch'), true,
      'Kleinschreibung muss die gemischt geschriebene Adresse finden');
    assert.equal(await forgot('FORGOT.CASE@EXAMPLE.CH'), true,
      'Grossschreibung muss die gemischt geschriebene Adresse finden');
    assert.equal(await forgot('Forgot.Case@Example.CH'), true,
      'die exakte Schreibweise funktioniert weiterhin');
    assert.equal(await forgot('gibt.es.nicht@example.ch'), false,
      'eine unbekannte Adresse setzt weiterhin KEINEN Token');
  } finally {
    await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await new Promise(r => srv.close(r));
  }
});

test('Reset-Link nur mit APP_BASE_URL, nie aus dem Host-Header — auch ausserhalb des Betriebs',
  { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const USERNAME = 'forgothosttest';
  await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-password|%'`).catch(() => {});
  await db.run(
    `INSERT INTO users (username, email, password_hash, is_admin, is_active, email_verified)
     VALUES ($1, 'forgot.host@example.ch', 'x', false, true, true)`, [USERNAME]);

  const alt = { NODE_ENV: process.env.NODE_ENV, APP_BASE_URL: process.env.APP_BASE_URL, SMTP_HOST: process.env.SMTP_HOST };
  process.env.NODE_ENV = 'development';
  delete process.env.SMTP_HOST;
  const ausgabe = [];
  const altLog = console.log, altWarn = console.warn;
  console.log = (...a) => { ausgabe.push(a.join(' ')); };
  console.warn = (...a) => { ausgabe.push(a.join(' ')); };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = {}; next(); });
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  const port = srv.address().port;
  const forgot = async (email) => {
    const r = await fetch(`http://localhost:${port}${AUTH}/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-host': 'boese.example', host: 'boese.example' },
      body: JSON.stringify({ email }),
    });
    const row = await db.get(`SELECT reset_token FROM users WHERE username = $1`, [USERNAME]);
    await db.run(`UPDATE users SET reset_token = NULL WHERE username = $1`, [USERNAME]);
    return { status: r.status, body: await r.json(), token: !!row.reset_token };
  };
  const warteAufLink = async () => {
    for (let i = 0; i < 50 && !ausgabe.some(z => z.includes('Link:')); i++) await new Promise(r => setTimeout(r, 50));
    return ausgabe.find(z => z.includes('Link:')) || '';
  };

  try {
    delete process.env.APP_BASE_URL;
    const bekannt = await forgot('forgot.host@example.ch');
    const unbekannt = await forgot('gibt.es.nicht@example.ch');
    assert.equal(bekannt.token, false, 'Reset-Code an den Host aus dem Header — ohne APP_BASE_URL darf keiner entstehen');
    assert.equal(bekannt.status, 503);
    assert.equal(bekannt.body.code, 'passwort_reset_nicht_eingerichtet');
    assert.deepEqual(unbekannt, bekannt, 'Die Antwort verrät die E-Mail: bekannt und unbekannt unterscheiden sich');

    process.env.APP_BASE_URL = 'https://lego.example.org/';
    ausgabe.length = 0;
    const mit = await forgot('forgot.host@example.ch');
    assert.equal(mit.status, 200);
    assert.equal(mit.token, true);
    const link = await warteAufLink();
    assert.match(link, /https:\/\/lego\.example\.org\/reset-password\?token=/);
    assert.doesNotMatch(link, /boese/);
  } finally {
    console.log = altLog; console.warn = altWarn;
    for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await new Promise(r => srv.close(r));
  }
});

test('höchstens ein Link je Konto in 15 Minuten, und jede Antwort braucht gleich lange', { concurrency: 1 }, async (t) => {
  const USERNAME = `forgotpause_${process.pid}`;
  await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
  await db.run(`DELETE FROM rate_limit_attempts WHERE key LIKE 'forgot-password|%'`);
  await db.run(`INSERT INTO users (username, email, password_hash, is_active, email_verified)
                VALUES ($1, $2, 'x', true, true)`, [USERNAME, `${USERNAME}@example.ch`]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = {}; next(); });
  app.use(AUTH, _req('routes/auth.js'));
  const srv = app.listen(0);
  t.after(async () => {
    await db.run(`DELETE FROM users WHERE username = $1`, [USERNAME]);
    await new Promise(r => srv.close(r));
  });
  const forgot = async (email) => {
    const beginn = Date.now();
    const r = await fetch(`http://localhost:${srv.address().port}${AUTH}/forgot-password`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
    const dauer = Date.now() - beginn;
    const z = await db.get(`SELECT reset_token FROM users WHERE username = $1`, [USERNAME]);
    return { status: r.status, body: await r.json(), dauer, token: z.reset_token };
  };
  const erste = await forgot(`${USERNAME}@example.ch`);
  assert.ok(erste.token);
  const zweite = await forgot(`${USERNAME}@example.ch`);
  assert.equal(zweite.token, erste.token, 'zweiter Link innerhalb der Pause — das Postfach lässt sich fluten');
  assert.deepEqual(zweite.body, erste.body, 'die Antwort verrät die Pause');
  // Nach der Pause (Ablauf liegt weniger als 45 Minuten vorn) gibt es wieder einen.
  await db.run(`UPDATE users SET reset_token_expires = NOW() + INTERVAL '44 minutes' WHERE username = $1`, [USERNAME]);
  assert.notEqual((await forgot(`${USERNAME}@example.ch`)).token, erste.token, 'nach der Pause kein neuer Link');
  const unbekannt = await forgot(`gibt.es.nicht.${process.pid}@example.ch`);
  for (const r of [erste, zweite, unbekannt]) assert.ok(r.dauer >= 390, `Antwort nach ${r.dauer} ms — die Dauer verrät die Adresse`);
});
